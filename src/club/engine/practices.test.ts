import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { CLASS_RULES } from "../settings/class-rules";
import { PRACTICE_RULES } from "../settings/practice-rules";
import { pacificDayStart, addDays } from "../time";
import type { PracticeRules } from "../types";
import { addBoatOwner } from "./boat-access";
import { createBooking, takeOutOfService, cancelBooking } from "./bookings";
import { createClass, scheduleSessions, signUp, checkSignUp } from "./classes";
import { removeMember } from "./households";
import { clubLedger } from "./ledger";
import {
  PracticeRefused,
  activeCoach,
  addPracticeBoat,
  canEditPractice,
  canRunPractices,
  cancelPractice,
  checkSeat,
  clearSeat,
  createPractice,
  findRowers,
  myPractices,
  practiceClashes,
  practiceDetail,
  practiceList,
  practiceNoticeFor,
  removePracticeBoat,
  seatMember,
  setCoach,
  sideWords,
  type PracticeInput,
} from "./practices";
import { NOW, STORE_KINDS, TODAY, at, bookAs, fixtureFor, memberCtx, refusalMessages, refusedFor, request, staffCtx, type Fixture } from "./testkit";

/**
 * Practices and lineups: who may run one, what a practice reserves, who may sit where, and what each person may see. Every test
 * runs on both stores, so the in-memory copy and Postgres must agree. Today is Wed Oct 28, 2026, 1 pm Pacific. The fixture's
 * members: Ada (sculling 3), Ben (sculling 2), Cy (none), Dee (sculling 1), Eli (sculling 3).
 */

const rulesWith = (change: Partial<PracticeRules["defaults"]>): PracticeRules => ({ ...PRACTICE_RULES, defaults: { ...PRACTICE_RULES.defaults, ...change } });
const asMember = (f: Fixture, who: string, now: Date = NOW) => memberCtx(f.m[who], who, now);
const state = (f: Fixture) => f.store.read();

/** The reasons a practice, boat or seat change was refused with ([] when it went through). Anything else is rethrown. */
const reasonsOf = async (attempt: Promise<unknown>): Promise<string[]> => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof PracticeRefused) return e.reasons;
    throw e;
  }
};
const errorOf = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return null;
  } catch (e) {
    if (e instanceof ClubError) return { code: e.code, message: e.message };
    throw e;
  }
};

const makeCoach = (f: Fixture, who = "Ben") => setCoach(f.store, staffCtx(), f.m[who], true);
const make = (f: Fixture, change: Partial<PracticeInput> = {}, ctx = staffCtx(), rules: PracticeRules = PRACTICE_RULES) =>
  createPractice(f.store, f.book, rules, ctx, { name: "Morning session", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Albatross], ...change });
const seat = (f: Fixture, practiceId: string, boat: string, n: number, who: string, side: "port" | "starboard" | null = null, ctx = staffCtx()) =>
  seatMember(f.store, f.book, ctx, { practiceId, itemId: f.i[boat], seat: n, side, memberId: f.m[who] });
const detailFor = async (f: Fixture, practiceId: string, viewer: Parameters<typeof practiceDetail>[3], now: Date = NOW) => practiceDetail(await state(f), f.book, practiceId, viewer, now);
const staffViewer = { kind: "staff", label: "Test staff" } as const;
const memberViewer = (f: Fixture, who: string) => ({ kind: "member", memberId: f.m[who], label: who }) as const;

async function privateBoat(f: Fixture, name: string, owner: string): Promise<void> {
  await f.store.transaction(async (s, newId) => {
    s.items.push({ id: newId(), name, classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
  });
  f.i[name] = (await state(f)).items.find((i) => i.name === name)!.id;
  await addBoatOwner(f.store, staffCtx(), { itemId: f.i[name], memberId: f.m[owner] });
}

for (const kind of STORE_KINDS) {
  describe(`practices and lineups on the ${kind} store`, () => {
    const fixture = fixtureFor(kind);

    describe("coaches", () => {
      it("staff mark a member as a coach, and the household's file says so", async () => {
        const f = await fixture();
        await makeCoach(f);
        const s = await state(f);
        expect(s.members.find((m) => m.id === f.m.Ben)?.isCoach).toBe(true);
        expect(s.members.find((m) => m.id === f.m.Ada)?.isCoach).toBeUndefined();
        const line = s.history.filter((h) => h.kind === "coach_changed");
        expect(line).toHaveLength(1);
        expect(line[0]).toMatchObject({ householdId: f.h.Quill, summary: "Ben Quill was marked as a coach by Test staff.", details: { memberId: f.m.Ben, coach: "yes" } });
        expect(activeCoach(s, f.m.Ben)?.id).toBe(f.m.Ben);
        expect(activeCoach(s, f.m.Ada)).toBeUndefined();
      });

      it("staff can take the mark off again, and the file says so", async () => {
        const f = await fixture();
        await makeCoach(f);
        await setCoach(f.store, staffCtx(), f.m.Ben, false);
        const s = await state(f);
        expect(s.members.find((m) => m.id === f.m.Ben)?.isCoach).toBeUndefined();
        expect(s.history.filter((h) => h.kind === "coach_changed").map((h) => h.summary)).toEqual([
          "Ben Quill was marked as a coach by Test staff.",
          "Ben Quill is no longer marked as a coach (by Test staff).",
        ]);
        expect(activeCoach(s, f.m.Ben)).toBeUndefined();
      });

      it("only staff can mark a coach: not a member, not even a coach, not the system", async () => {
        const f = await fixture();
        await makeCoach(f);
        const message = "Only club staff can mark someone as a coach.";
        expect(await errorOf(setCoach(f.store, asMember(f, "Ada"), f.m.Dee, true))).toEqual({ code: "forbidden", message });
        expect(await errorOf(setCoach(f.store, asMember(f, "Ben"), f.m.Dee, true))).toEqual({ code: "forbidden", message });
        expect(await errorOf(setCoach(f.store, asMember(f, "Ben"), f.m.Ben, false))).toEqual({ code: "forbidden", message });
        expect(await errorOf(setCoach(f.store, { actor: { kind: "system", label: "System" }, now: NOW }, f.m.Dee, true))).toEqual({ code: "forbidden", message });
        expect((await state(f)).members.find((m) => m.id === f.m.Dee)?.isCoach).toBeUndefined();
      });

      it("marking twice, unmarking someone who is not a coach, an unknown member, and a member who left are each refused in words", async () => {
        const f = await fixture();
        await makeCoach(f);
        expect(await errorOf(setCoach(f.store, staffCtx(), f.m.Ben, true))).toEqual({ code: "conflict", message: "Ben Quill is already a coach." });
        expect(await errorOf(setCoach(f.store, staffCtx(), f.m.Ada, false))).toEqual({ code: "conflict", message: "Ada Quill is not marked as a coach." });
        expect(await errorOf(setCoach(f.store, staffCtx(), "00000000-0000-4000-8000-0000000fffff", true))).toEqual({ code: "not_found", message: "That member no longer exists." });
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
        expect(await errorOf(setCoach(f.store, staffCtx(), f.m.Cy, true))).toEqual({ code: "conflict", message: "Cy Quill is not an active member, so they cannot be made a coach." });
        // Nothing was written for any refusal.
        expect((await state(f)).history.filter((h) => h.kind === "coach_changed")).toHaveLength(1);
      });

      it("staff and active coaches can run practices; other members, the system, and a coach who left cannot", async () => {
        const f = await fixture();
        await makeCoach(f);
        let s = await state(f);
        expect(canRunPractices(s, { kind: "staff", label: "S" })).toBe(true);
        expect(canRunPractices(s, { kind: "member", memberId: f.m.Ben, label: "Ben" })).toBe(true);
        expect(canRunPractices(s, { kind: "member", memberId: f.m.Ada, label: "Ada" })).toBe(false);
        expect(canRunPractices(s, { kind: "system", label: "System" })).toBe(false);
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
        s = await state(f);
        expect(canRunPractices(s, { kind: "member", memberId: f.m.Ben, label: "Ben" })).toBe(false);
      });

      it("a coach changes only the practices they run; staff change any", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        const s = await state(f);
        const ben = { kind: "member", memberId: f.m.Ben, label: "Ben" } as const;
        const eli = { kind: "member", memberId: f.m.Eli, label: "Eli" } as const;
        expect(canEditPractice(s, ben, s.practices[0])).toBe(true);
        expect(canEditPractice(s, eli, s.practices[0])).toBe(false);
        expect(canEditPractice(s, { kind: "staff", label: "S" }, s.practices[0])).toBe(true);
        expect(canEditPractice(s, { kind: "member", memberId: f.m.Ada, label: "Ada" }, s.practices[0])).toBe(false);
        expect(practice.coachId).toBe(f.m.Ben);
      });
    });

    describe("setting a practice up", () => {
      it("staff set one up: it is saved with its boats, run by staff, and nothing else is touched", async () => {
        const f = await fixture();
        const { practice, clashes } = await make(f, { name: "  Saturday   sweep ", notes: "Bring water.", itemIds: [f.i.Albatross, f.i.Pelican] });
        expect(clashes).toEqual([]);
        expect(practice).toMatchObject({
          name: "Saturday sweep",
          notes: "Bring water.",
          startsAt: at(2, 7).toISOString(),
          endsAt: at(2, 9).toISOString(),
          status: "scheduled",
          coachId: null,
          createdAt: NOW.toISOString(),
          createdBy: { kind: "staff", label: "Test staff" },
          cancelledBy: null,
          cancelReason: null,
        });
        const s = await state(f);
        expect(s.practices).toHaveLength(1);
        expect(s.practiceBoats.filter((b) => b.endedAt === null).map((b) => b.itemId).sort()).toEqual([f.i.Albatross, f.i.Pelican].sort());
        expect(s.practiceSeats).toEqual([]);
        expect(s.bookings).toEqual([]);
      });

      it("a coach sets one up and runs it themselves; staff can name a coach", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const mine = await make(f, {}, asMember(f, "Ben"));
        expect(mine.practice).toMatchObject({ coachId: f.m.Ben, createdBy: { kind: "member", memberId: f.m.Ben } });
        const named = await make(f, { coachId: f.m.Ben, itemIds: [f.i.Pelican] });
        expect(named.practice).toMatchObject({ coachId: f.m.Ben, createdBy: { kind: "staff" } });
        const none = await make(f, { coachId: null, itemIds: [f.i.Loon] });
        expect(none.practice.coachId).toBeNull();
      });

      it("refuses anyone who is not a coach or staff, and a coach naming someone else", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        const message = "Only a coach or club staff can set up a practice.";
        expect(await errorOf(make(f, {}, asMember(f, "Ada")))).toEqual({ code: "forbidden", message });
        expect(await errorOf(make(f, {}, { actor: { kind: "system", label: "System" }, now: NOW }))).toEqual({ code: "forbidden", message });
        expect(await reasonsOf(make(f, { coachId: f.m.Eli }, asMember(f, "Ben")))).toEqual(["A coach can only set up a practice they run themselves."]);
        expect((await state(f)).practices).toEqual([]);
      });

      it("staff must name a real coach: an ordinary member, or a coach who left, is refused", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const words = "Choose a coach: a member staff have marked as one.";
        expect(await reasonsOf(make(f, { coachId: f.m.Ada }))).toEqual([words]);
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
        expect(await reasonsOf(make(f, { coachId: f.m.Ben }))).toEqual([words]);
      });

      it("cleans the name and note, and keeps line breaks only in the note", async () => {
        const f = await fixture();
        const { practice } = await make(f, { name: "Row\u0007 \n  hard", notes: "Line one\r\nLine two\u0001 end" });
        expect(practice.name).toBe("Row hard");
        expect(practice.notes).toBe("Line one\nLine two  end");
      });

      it("holds the name and note to their limits, exactly at them and one over", async () => {
        const f = await fixture();
        const rules = rulesWith({ nameMax: 10, notesMax: 20 });
        expect((await make(f, { name: "x".repeat(10), notes: "y".repeat(20), itemIds: [] }, staffCtx(), rules)).practice.name).toHaveLength(10);
        expect(await reasonsOf(make(f, { name: "x".repeat(11), itemIds: [] }, staffCtx(), rules))).toEqual(["The name can be up to 10 characters."]);
        expect(await reasonsOf(make(f, { name: "Row", notes: "y".repeat(21), itemIds: [] }, staffCtx(), rules))).toEqual(["The note can be up to 20 characters."]);
        expect(await reasonsOf(make(f, { name: " \n ", itemIds: [] }))).toEqual(["Give the practice a name."]);
      });

      it("checks the times: end after start, not in the past, not too long, not too far ahead", async () => {
        const f = await fixture();
        expect(await reasonsOf(make(f, { startsAt: at(2, 9), endsAt: at(2, 9) }))).toEqual(["The practice must end after it starts."]);
        expect(await reasonsOf(make(f, { startsAt: at(2, 10), endsAt: at(2, 9) }))).toEqual(["The practice must end after it starts."]);
        expect(await reasonsOf(make(f, { startsAt: new Date(NaN), endsAt: at(2, 9) }))).toEqual(["Give the practice a start and an end time."]);
        // Starting this very moment is already in the past; a minute later is fine.
        expect(await reasonsOf(make(f, { startsAt: NOW, endsAt: new Date(NOW.getTime() + 3600000), itemIds: [] }))).toEqual(["That practice starts in the past. Choose a later time."]);
        expect((await make(f, { startsAt: new Date(NOW.getTime() + 60000), endsAt: new Date(NOW.getTime() + 3660000), itemIds: [] })).practice.status).toBe("scheduled");
        // Six hours is the longest.
        expect((await make(f, { startsAt: at(3, 6), endsAt: at(3, 12), itemIds: [] })).practice.status).toBe("scheduled");
        expect(await reasonsOf(make(f, { startsAt: at(4, 6), endsAt: new Date(at(4, 12).getTime() + 60000), itemIds: [] }))).toEqual(["A practice can run up to 6 hours."]);
      });

      it("allows a practice up to 120 days ahead, counted on the Pacific calendar, and not a moment later", async () => {
        const f = await fixture();
        const lastDay = addDays(TODAY, 120);
        const lastMoment = new Date(pacificDayStart(addDays(lastDay, 1)).getTime() - 60000);
        const firstTooLate = pacificDayStart(addDays(lastDay, 1));
        expect((await make(f, { startsAt: new Date(lastMoment.getTime() - 3600000), endsAt: lastMoment, itemIds: [] })).practice.status).toBe("scheduled");
        expect(await reasonsOf(make(f, { startsAt: firstTooLate, endsAt: new Date(firstTooLate.getTime() + 3600000), itemIds: [] }))).toEqual(["A practice can be set up up to 120 days ahead."]);
      });

      it("reserves only boats: not a private boat, a dock space, a pool, or a boat out of service, and not one twice", async () => {
        const f = await fixture();
        await privateBoat(f, "Wren", "Ada");
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Dock berths", classCode: "dock-space", ruleOverrides: {}, places: 4 });
        });
        f.i["Dock berths"] = (await state(f)).items.find((i) => i.name === "Dock berths")!.id;
        await takeOutOfService(f.store, staffCtx(), f.i.Heron, { reason: "Rigger repair" });
        expect(await reasonsOf(make(f, { itemIds: [f.i.Wren] }))).toEqual(["Wren is a private boat. Its owners decide who uses it, so it cannot go on a practice."]);
        expect(await reasonsOf(make(f, { itemIds: [f.i["Dock slip A"]] }))).toEqual(["Dock slip A is not a boat, so it cannot go on a practice."]);
        expect(await reasonsOf(make(f, { itemIds: [f.i["Dock berths"]] }))).toEqual(["Dock berths is not a boat, so it cannot go on a practice."]);
        expect(await reasonsOf(make(f, { itemIds: [f.i.Heron] }))).toEqual(["Heron is out of service (Rigger repair)."]);
        expect(await reasonsOf(make(f, { itemIds: [f.i.Loon, f.i.Loon] }))).toEqual(["The same boat is listed twice."]);
        expect(await reasonsOf(make(f, { itemIds: ["00000000-0000-4000-8000-0000000fffff"] }))).toEqual(["That boat no longer exists."]);
        expect((await state(f)).practices).toEqual([]);
      });

      it("reserves kayaks and paddle boards too, and counts the boats against the most one practice may reserve", async () => {
        const f = await fixture();
        expect((await make(f, { itemIds: [f.i.Otter, f.i.Skimmer] })).practice.status).toBe("scheduled");
        const rules = rulesWith({ maxBoats: 2 });
        expect(await reasonsOf(make(f, { startsAt: at(3, 7), endsAt: at(3, 9), itemIds: [f.i.Heron, f.i.Osprey, f.i.Loon] }, staffCtx(), rules))).toEqual(["A practice can reserve up to 2 boats."]);
        expect((await make(f, { startsAt: at(3, 7), endsAt: at(3, 9), itemIds: [f.i.Heron, f.i.Osprey] }, staffCtx(), rules)).practice.status).toBe("scheduled");
      });

      it("reports every problem at once", async () => {
        const f = await fixture();
        await privateBoat(f, "Wren", "Ada");
        const reasons = await reasonsOf(make(f, { name: "", startsAt: at(-1, 7), endsAt: at(-1, 9), itemIds: [f.i.Wren, f.i["Dock slip A"]] }));
        expect(reasons).toEqual([
          "Give the practice a name.",
          "That practice starts in the past. Choose a later time.",
          "Wren is a private boat. Its owners decide who uses it, so it cannot go on a practice.",
          "Dock slip A is not a boat, so it cannot go on a practice.",
        ]);
      });

      it("will not reserve a boat that another practice has at an overlapping time, but back to back is fine", async () => {
        const f = await fixture();
        const first = await make(f, { name: "Early row" });
        expect(await reasonsOf(make(f, { name: "Second", startsAt: at(2, 8), endsAt: at(2, 10) }))).toEqual(["Albatross is already reserved for Early row from 7:00 to 9:00 am."]);
        expect(await reasonsOf(make(f, { name: "Second", startsAt: at(2, 6), endsAt: at(2, 8) }))).toEqual(["Albatross is already reserved for Early row from 7:00 to 9:00 am."]);
        expect((await make(f, { name: "After", startsAt: at(2, 9), endsAt: at(2, 11) })).practice.status).toBe("scheduled");
        expect((await make(f, { name: "Before", startsAt: at(2, 5), endsAt: at(2, 7) })).practice.status).toBe("scheduled");
        // A cancelled practice lets go of its boat.
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), first.practice.id);
        expect((await make(f, { name: "Replacement" })).practice.status).toBe("scheduled");
      });

      it("does not cancel bookings already made on its boats: it flags them", async () => {
        const f = await fixture();
        const booking = await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        const other = await bookAs(f, "Ben", "Pelican", at(2, 8), at(2, 9));
        const clearOf = await bookAs(f, "Eli", "Albatross", at(2, 9), at(2, 10));
        const { clashes } = await make(f, { itemIds: [f.i.Albatross] });
        expect(clashes).toEqual([
          { bookingId: booking.booking.id, itemId: f.i.Albatross, itemName: "Albatross", bookerId: f.m.Ada, bookerName: "Ada Quill", startsAt: at(2, 8).toISOString(), endsAt: at(2, 9).toISOString() },
        ]);
        const s = await state(f);
        for (const id of [booking.booking.id, other.booking.id, clearOf.booking.id]) expect(s.bookings.find((b) => b.id === id)?.status).toBe("upcoming");
      });

      it("flags a booking that overlaps by only part of the time, not one that ends as the practice starts", async () => {
        const f = await fixture();
        await bookAs(f, "Ada", "Heron", at(2, 6), at(2, 7));
        const early = await bookAs(f, "Dee", "Osprey", at(2, 6, 30), at(2, 7, 30));
        const late = await bookAs(f, "Eli", "Kingfisher", at(2, 8, 30), at(2, 9, 30));
        const { clashes } = await make(f, { itemIds: [f.i.Heron, f.i.Osprey, f.i.Kingfisher] });
        expect(clashes.map((c) => c.bookingId).sort()).toEqual([early.booking.id, late.booking.id].sort());
      });

      it("ignores bookings that were cancelled", async () => {
        const f = await fixture();
        const b = await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        await cancelBooking(f.store, f.book, asMember(f, "Ada"), b.booking.id);
        expect((await make(f, { itemIds: [f.i.Albatross] })).clashes).toEqual([]);
      });
    });

    describe("what a practice does to bookings", () => {
      it("a booking on a reserved boat during the practice is refused, for anyone, even staff booking past the rules", async () => {
        const f = await fixture();
        await make(f);
        const words = "Albatross is reserved for Morning session from 7:00 to 9:00 am.";
        expect(await refusalMessages(bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9)))).toContain(words);
        expect(await refusedFor(bookAs(f, "Ada", "Albatross", at(2, 6, 30), at(2, 7, 30)))).toContain("boat_in_practice");
        const asStaff = createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Albatross", at(2, 8), at(2, 9)), { override: { reason: "A lesson" } });
        expect(await refusedFor(asStaff)).toContain("boat_in_practice");
      });

      it("back to back with the practice is fine, and so is another boat", async () => {
        const f = await fixture();
        await make(f);
        expect(await refusedFor(bookAs(f, "Ada", "Albatross", at(2, 9), at(2, 10)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Eli", "Albatross", at(2, 6), at(2, 7)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Ben", "Pelican", at(2, 8), at(2, 9)))).toEqual([]);
      });

      it("a cancelled practice, or a boat taken off one, lets the boat be booked again", async () => {
        const f = await fixture();
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican] });
        expect(await refusedFor(bookAs(f, "Ada", "Pelican", at(2, 8), at(2, 9)))).toContain("boat_in_practice");
        await removePracticeBoat(f.store, staffCtx(), practice.id, f.i.Pelican);
        expect(await refusedFor(bookAs(f, "Ada", "Pelican", at(2, 8), at(2, 9)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Eli", "Albatross", at(2, 8), at(2, 9)))).toContain("boat_in_practice");
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(await refusedFor(bookAs(f, "Eli", "Albatross", at(2, 8), at(2, 9)))).toEqual([]);
      });

      it("someone seated in a lineup cannot book another boat (as booker or as crew) while it runs", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ben");
        expect(await refusalMessages(bookAs(f, "Ben", "Heron", at(2, 8), at(2, 9)))).toContain("You are in the lineup for Morning session from 7:00 to 9:00 am.");
        expect(await refusedFor(bookAs(f, "Ben", "Otter", at(2, 8), at(2, 9)))).toContain("in_practice");
        const asCrew = await refusalMessages(bookAs(f, "Ada", "Loon", at(2, 8), at(2, 9), ["Ben"]));
        expect(asCrew).toContain("Ben Quill is in the lineup for Morning session from 7:00 to 9:00 am.");
        // Before, after and a space that is not on the water are all fine; so is someone who is not seated.
        expect(await refusedFor(bookAs(f, "Ben", "Heron", at(2, 9), at(2, 10)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Ben", "Otter", at(2, 6), at(2, 7)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Ben", "Dock slip A", at(2, 8), at(2, 9)))).toEqual([]);
        expect(await refusedFor(bookAs(f, "Dee", "Heron", at(2, 8), at(2, 9)))).toEqual([]);
      });

      it("a cancelled practice frees its rowers to book", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ben");
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(await refusedFor(bookAs(f, "Ben", "Heron", at(2, 8), at(2, 9)))).toEqual([]);
      });

      it("someone seated in a lineup cannot sign up for a class at that time, and the words say why", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
        });
        const gym = (await state(f)).items.find((i) => i.name === "Boathouse gym")!.id;
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: gym });
        const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 8) });
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ben");
        const ctx = asMember(f, "Ben");
        const reasons = checkSignUp(await state(f), f.book, CLASS_RULES, ctx, { sessionId: session.id, memberId: f.m.Ben });
        expect(reasons.map((r) => r.message)).toContain("You are in the lineup for Morning session from 7:00 to 9:00 am.");
        await expect(signUp(f.store, f.book, CLASS_RULES, ctx, { sessionId: session.id, memberId: f.m.Ben })).rejects.toThrow(/lineup for Morning session/);
        // Someone not seated is fine.
        expect((await signUp(f.store, f.book, CLASS_RULES, asMember(f, "Dee"), { sessionId: session.id, memberId: f.m.Dee })).outcome).toBe("enrolled");
      });

      it("a booking made before the practice carries a notice on its own page, and a cancelled practice takes it away", async () => {
        const f = await fixture();
        const b = await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        const { practice } = await make(f);
        const booking = (await state(f)).bookings.find((x) => x.id === b.booking.id)!;
        expect(practiceNoticeFor(await state(f), booking)).toBe("Albatross is also reserved for Morning session from 7:00 to 9:00 am. Please check with club staff before you go.");
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(practiceNoticeFor(await state(f), booking)).toBeNull();
      });

      it("gives no notice for a booking on another boat, a cancelled booking, or one that only touches the practice", async () => {
        const f = await fixture();
        const other = await bookAs(f, "Ben", "Pelican", at(2, 8), at(2, 9));
        const touching = await bookAs(f, "Eli", "Albatross", at(2, 9), at(2, 10));
        const gone = await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        await cancelBooking(f.store, f.book, asMember(f, "Ada"), gone.booking.id);
        await make(f);
        const s = await state(f);
        for (const id of [other.booking.id, touching.booking.id, gone.booking.id]) expect(practiceNoticeFor(s, s.bookings.find((x) => x.id === id)!)).toBeNull();
      });
    });

    describe("seating people", () => {
      it("a coach seats people in a practice they run, with the side they row on", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        const a = await seat(f, practice.id, "Albatross", 1, "Ada", "port", asMember(f, "Ben"));
        const b = await seat(f, practice.id, "Albatross", 2, "Dee", "starboard", asMember(f, "Ben"));
        const c = await seat(f, practice.id, "Albatross", 3, "Eli", null, asMember(f, "Ben"));
        expect(a).toMatchObject({ practiceId: practice.id, itemId: f.i.Albatross, seat: 1, side: "port", memberId: f.m.Ada, addedBy: { kind: "member", memberId: f.m.Ben }, endedAt: null });
        expect([b.side, c.side]).toEqual(["starboard", null]);
        const detail = await detailFor(f, practice.id, memberViewer(f, "Ben"));
        expect(detail!.boats[0].seats.map((x) => [x.seat, x.name, x.side])).toEqual([
          [1, "Ada Quill", "port"],
          [2, "Dee Reed", "starboard"],
          [3, "Eli Reed", null],
          [4, null, null],
        ]);
      });

      it("there is no skill check: someone with no qualification can sit in the quad", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        const seated = await seat(f, practice.id, "Albatross", 1, "Cy");
        expect(seated.memberId).toBe(f.m.Cy);
        expect(await refusedFor(bookAs(f, "Cy", "Albatross", at(3, 8), at(3, 9)))).toContain("not_qualified");
      });

      it("a coach cannot seat people in a practice another coach runs, or one staff run; an ordinary member cannot seat anyone", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        const bens = await make(f, {}, asMember(f, "Ben"));
        const staffs = await make(f, { startsAt: at(3, 7), endsAt: at(3, 9) });
        const own = "Only the coach who runs this practice, or club staff, can change it.";
        expect(await errorOf(seat(f, bens.practice.id, "Albatross", 1, "Ada", null, asMember(f, "Eli")))).toEqual({ code: "forbidden", message: own });
        expect(await errorOf(seat(f, staffs.practice.id, "Albatross", 1, "Ada", null, asMember(f, "Ben")))).toEqual({ code: "forbidden", message: own });
        expect(await errorOf(seat(f, bens.practice.id, "Albatross", 1, "Ada", null, asMember(f, "Ada")))).toEqual({ code: "forbidden", message: "Only a coach or club staff can change a practice." });
        expect(await errorOf(seat(f, bens.practice.id, "Albatross", 1, "Ada", null, { actor: { kind: "system", label: "System" }, now: NOW }))).toEqual({ code: "forbidden", message: "Only a coach or club staff can change a practice." });
        expect((await state(f)).practiceSeats).toEqual([]);
      });

      it("staff seat people in any practice", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        const seated = await seat(f, practice.id, "Albatross", 1, "Ada");
        expect(seated.addedBy).toEqual({ kind: "staff", label: "Test staff" });
      });

      it("a coach who has been unmarked can no longer change the practice they ran, but staff still can", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        await setCoach(f.store, staffCtx(), f.m.Ben, false);
        expect(await errorOf(seat(f, practice.id, "Albatross", 1, "Ada", null, asMember(f, "Ben")))).toMatchObject({ code: "forbidden" });
        expect((await seat(f, practice.id, "Albatross", 1, "Ada")).memberId).toBe(f.m.Ada);
        const detail = await detailFor(f, practice.id, staffViewer);
        expect(detail).toMatchObject({ coachName: "Ben Quill", coachActive: false });
      });

      it("refuses a seat the boat does not have, a seat already taken, and a side that is not a side", async () => {
        const f = await fixture();
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Heron] });
        await seat(f, practice.id, "Albatross", 1, "Ada");
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 5, "Dee"))).toEqual(["Albatross has 4 seats, so there is no seat 5."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 0, "Dee"))).toEqual(["Albatross has 4 seats, so there is no seat 0."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1.5, "Dee"))).toEqual(["Albatross has 4 seats, so there is no seat like that."]);
        expect(await reasonsOf(seat(f, practice.id, "Heron", 2, "Dee"))).toEqual(["Heron has 1 seat, so there is no seat 2."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Dee"))).toEqual(["Seat 1 in Albatross is already taken by Ada Quill."]);
        expect(await reasonsOf(seatMember(f.store, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 2, side: "left" as never, memberId: f.m.Dee }))).toEqual(["The side must be port, starboard or left empty."]);
        expect((await state(f)).practiceSeats).toHaveLength(1);
      });

      it("refuses a boat that is not on the practice", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        expect(await reasonsOf(seat(f, practice.id, "Pelican", 1, "Dee"))).toEqual(["That boat is not on this practice."]);
      });

      it("refuses someone who has left the club, naming why", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
        const reasons = await reasonsOf(seat(f, practice.id, "Albatross", 1, "Cy"));
        expect(reasons).toHaveLength(1);
        expect(reasons[0]).toMatch(/^Cy Quill cannot be seated: .*they cannot be seated\.$/);
        expect(await reasonsOf(seatMember(f.store, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, side: null, memberId: "00000000-0000-4000-8000-0000000fffff" }))).toEqual(["That member no longer exists."]);
      });

      it("a person can sit in only one seat of a practice", async () => {
        const f = await fixture();
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican] });
        await seat(f, practice.id, "Albatross", 2, "Ben");
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 3, "Ben"))).toEqual(["Ben Quill is already in this practice: Albatross, seat 2. Take them out of that seat first."]);
        expect(await reasonsOf(seat(f, practice.id, "Pelican", 1, "Ben"))).toEqual(["Ben Quill is already in this practice: Albatross, seat 2. Take them out of that seat first."]);
      });

      it("nobody is in two places at once: a boat booked or crewed, a class, or another practice", async () => {
        const f = await fixture();
        await f.store.transaction(async (s, newId) => {
          s.items.push({ id: newId(), name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
        });
        const gym = (await state(f)).items.find((i) => i.name === "Boathouse gym")!.id;
        const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: gym });
        const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 7) });
        await signUp(f.store, f.book, CLASS_RULES, asMember(f, "Dee"), { sessionId: session.id, memberId: f.m.Dee });
        await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8));
        await bookAs(f, "Eli", "Loon", at(2, 8), at(2, 9), ["Ben"]);
        const other = await make(f, { name: "Other session", itemIds: [f.i.Pelican] });
        await seat(f, other.practice.id, "Pelican", 1, "Cy");
        const { practice } = await make(f);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Ada"))).toEqual(["Ada Quill has Heron booked from 7:00 to 8:00 am."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Ben"))).toEqual(["Ben Quill has Loon booked from 8:00 to 9:00 am."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Dee"))).toEqual(["Dee Reed is signed up for Yoga from 7:00 to 8:00 am."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Cy"))).toEqual(["Cy Quill is in the lineup for Other session from 7:00 to 9:00 am."]);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Eli"))).toEqual(["Eli Reed has Loon booked from 8:00 to 9:00 am."]);
      });

      it("a cancelled booking does not keep someone out of a seat", async () => {
        const f = await fixture();
        const b = await bookAs(f, "Ada", "Heron", at(2, 7), at(2, 8));
        await cancelBooking(f.store, f.book, asMember(f, "Ada"), b.booking.id);
        const { practice } = await make(f);
        expect((await seat(f, practice.id, "Albatross", 1, "Ada")).memberId).toBe(f.m.Ada);
      });

      it("a booking on a different day, or touching the practice at its edge, does not keep someone out", async () => {
        const f = await fixture();
        await bookAs(f, "Ada", "Heron", at(3, 7), at(3, 8));
        await bookAs(f, "Dee", "Heron", at(2, 9), at(2, 10));
        await bookAs(f, "Eli", "Osprey", at(2, 6), at(2, 7));
        const { practice } = await make(f);
        for (const [n, who] of [[1, "Ada"], [2, "Dee"], [3, "Eli"]] as const) expect((await seat(f, practice.id, "Albatross", n, who)).memberId).toBe(f.m[who]);
      });

      it("reports every reason at once", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ada");
        await bookAs(f, "Dee", "Heron", at(2, 7), at(2, 8));
        const reasons = await reasonsOf(seat(f, practice.id, "Albatross", 1, "Dee"));
        expect(reasons).toEqual(["Seat 1 in Albatross is already taken by Ada Quill.", "Dee Reed has Heron booked from 7:00 to 8:00 am."]);
      });

      it("checking a seat changes nothing", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        const before = await state(f);
        expect(checkSeat(before, f.book, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, side: null, memberId: f.m.Ada })).toEqual([]);
        expect(await state(f)).toEqual(before);
      });

      it("a cancelled practice, or one that is over, has no lineup to change", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        const later = new Date(at(2, 9).getTime() + 60000);
        expect(await reasonsOf(seatMember(f.store, f.book, staffCtx(later), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, side: null, memberId: f.m.Ada }))).toEqual(["That practice is over, so it cannot be changed."]);
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Ada"))).toEqual(["That practice was cancelled, so it cannot be changed."]);
      });

      it("seating works while the practice is under way", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        const during = new Date(at(2, 8).getTime());
        expect((await seatMember(f.store, f.book, staffCtx(during), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, side: null, memberId: f.m.Ada })).memberId).toBe(f.m.Ada);
      });
    });

    describe("changing the lineup", () => {
      it("takes someone out of a seat: the line is kept with who did it, and the seat is free again", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ada", "port");
        await clearSeat(f.store, PRACTICE_RULES, staffCtx(new Date(NOW.getTime() + 60000)), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, reason: "  Changed   plan " });
        let s = await state(f);
        expect(s.practiceSeats).toHaveLength(1);
        expect(s.practiceSeats[0]).toMatchObject({ endedAt: new Date(NOW.getTime() + 60000).toISOString(), endedBy: { kind: "staff", label: "Test staff" }, endedReason: "Taken out by Test staff: Changed plan" });
        expect(await seat(f, practice.id, "Albatross", 1, "Dee", "starboard").then((x) => x.memberId)).toBe(f.m.Dee);
        s = await state(f);
        expect(s.practiceSeats).toHaveLength(2);
        expect(s.practiceSeats.filter((x) => x.endedAt === null).map((x) => x.memberId)).toEqual([f.m.Dee]);
        // The person taken out is free to be seated somewhere else, and to book that time.
        expect(await refusedFor(bookAs(f, "Ada", "Heron", at(2, 8), at(2, 9)))).toEqual([]);
      });

      it("without a reason the line says only who took them out", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ada");
        await clearSeat(f.store, PRACTICE_RULES, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1 });
        expect((await state(f)).practiceSeats[0].endedReason).toBe("Taken out by Test staff");
      });

      it("refuses an empty seat, a reason that is too long, a coach who does not run it, and a practice that is over", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        await seat(f, practice.id, "Albatross", 1, "Ada", null, asMember(f, "Ben"));
        expect(await errorOf(clearSeat(f.store, PRACTICE_RULES, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 2 }))).toEqual({ code: "conflict", message: "Nobody is in that seat." });
        expect(await errorOf(clearSeat(f.store, PRACTICE_RULES, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, reason: "x".repeat(201) }))).toEqual({ code: "invalid", message: "The reason can be up to 200 characters." });
        expect(await errorOf(clearSeat(f.store, PRACTICE_RULES, asMember(f, "Eli"), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1 }))).toMatchObject({ code: "forbidden" });
        expect(await reasonsOf(clearSeat(f.store, PRACTICE_RULES, staffCtx(new Date(at(2, 9).getTime() + 1)), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1 }))).toEqual(["That practice is over, so it cannot be changed."]);
        expect((await state(f)).practiceSeats.filter((x) => x.endedAt === null)).toHaveLength(1);
        // A reason exactly at the limit is accepted.
        await clearSeat(f.store, PRACTICE_RULES, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1, reason: "x".repeat(200) });
        expect((await state(f)).practiceSeats[0].endedAt).not.toBeNull();
      });

      it("adds another boat later, and says which bookings it overlaps", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        const b = await bookAs(f, "Ben", "Pelican", at(2, 8), at(2, 9));
        const { clashes } = await addPracticeBoat(f.store, f.book, PRACTICE_RULES, staffCtx(), practice.id, f.i.Pelican);
        expect(clashes.map((c) => c.bookingId)).toEqual([b.booking.id]);
        expect((await state(f)).practiceBoats.filter((x) => x.endedAt === null)).toHaveLength(2);
      });

      it("refuses a boat already on the practice, one that is not a boat, one reserved elsewhere, a full practice, a closed practice and a stranger", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        await make(f, { name: "Rival", itemIds: [f.i.Pelican] });
        const add = (id: string, ctx = staffCtx(), rules = PRACTICE_RULES) => addPracticeBoat(f.store, f.book, rules, ctx, practice.id, id);
        expect(await reasonsOf(add(f.i.Albatross))).toEqual(["Albatross is already on this practice."]);
        expect(await reasonsOf(add(f.i["Dock slip A"]))).toEqual(["Dock slip A is not a boat, so it cannot go on a practice."]);
        expect(await reasonsOf(add(f.i.Pelican))).toEqual(["Pelican is already reserved for Rival from 7:00 to 9:00 am."]);
        expect(await reasonsOf(add(f.i.Heron, staffCtx(), rulesWith({ maxBoats: 1 })))).toEqual(["A practice can reserve up to 1 boat."]);
        expect(await errorOf(add(f.i.Heron, asMember(f, "Ada")))).toMatchObject({ code: "forbidden" });
        expect(await reasonsOf(add(f.i.Heron, staffCtx(new Date(at(2, 9).getTime() + 1))))).toEqual(["That practice is over, so it cannot be changed."]);
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(await reasonsOf(add(f.i.Heron))).toEqual(["That practice was cancelled, so it cannot be changed."]);
      });

      it("a boat taken off a practice takes its seats with it, says so on each line, and is free again", async () => {
        const f = await fixture();
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican] });
        await seat(f, practice.id, "Albatross", 1, "Ada");
        await seat(f, practice.id, "Albatross", 2, "Dee");
        await seat(f, practice.id, "Pelican", 1, "Eli");
        const result = await removePracticeBoat(f.store, staffCtx(), practice.id, f.i.Albatross);
        expect(result).toEqual({ unseated: 2 });
        const s = await state(f);
        const active = s.practiceSeats.filter((x) => x.endedAt === null);
        expect(active.map((x) => x.memberId)).toEqual([f.m.Eli]);
        expect(s.practiceSeats.filter((x) => x.endedAt !== null).map((x) => x.endedReason)).toEqual(["Albatross came off the practice", "Albatross came off the practice"]);
        expect(s.practiceBoats.find((b) => b.itemId === f.i.Albatross)?.endedAt).toBe(NOW.toISOString());
        // The people who were in it can book again; the boat can be put back, and seats start empty.
        expect(await refusedFor(bookAs(f, "Dee", "Heron", at(2, 8), at(2, 9)))).toEqual([]);
        await addPracticeBoat(f.store, f.book, PRACTICE_RULES, staffCtx(), practice.id, f.i.Albatross);
        expect((await seat(f, practice.id, "Albatross", 1, "Ada")).memberId).toBe(f.m.Ada);
      });

      it("refuses taking off a boat that is not on the practice", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        expect(await errorOf(removePracticeBoat(f.store, staffCtx(), practice.id, f.i.Pelican))).toEqual({ code: "not_found", message: "That boat is not on this practice." });
      });

      it("cancels before the start, frees everything, keeps every line, and only by the coach who runs it or staff", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        await seat(f, practice.id, "Albatross", 1, "Ada");
        expect(await errorOf(cancelPractice(f.store, PRACTICE_RULES, asMember(f, "Eli"), practice.id))).toMatchObject({ code: "forbidden" });
        expect(await errorOf(cancelPractice(f.store, PRACTICE_RULES, asMember(f, "Ada"), practice.id))).toMatchObject({ code: "forbidden" });
        const done = await cancelPractice(f.store, PRACTICE_RULES, asMember(f, "Ben", new Date(NOW.getTime() + 1000)), practice.id, "  Too   windy ");
        expect(done).toMatchObject({ status: "cancelled", statusChangedAt: new Date(NOW.getTime() + 1000).toISOString(), cancelledBy: { kind: "member", memberId: f.m.Ben }, cancelReason: "Too windy" });
        const s = await state(f);
        expect(s.practices[0].status).toBe("cancelled");
        expect(s.practiceBoats).toHaveLength(1);
        expect(s.practiceSeats).toHaveLength(1);
        expect(await errorOf(cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id))).toEqual({ code: "conflict", message: "That practice is already cancelled." });
      });

      it("cannot be cancelled once it has started, and the reason has a limit", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        expect(await errorOf(cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id, "x".repeat(201)))).toEqual({ code: "invalid", message: "The reason can be up to 200 characters." });
        expect(await errorOf(cancelPractice(f.store, PRACTICE_RULES, staffCtx(at(2, 7)), practice.id))).toEqual({ code: "conflict", message: "That practice has already started, so it cannot be cancelled." });
        expect((await state(f)).practices[0].status).toBe("scheduled");
        const justBefore = new Date(at(2, 7).getTime() - 1);
        expect((await cancelPractice(f.store, PRACTICE_RULES, staffCtx(justBefore), practice.id, "x".repeat(200))).status).toBe("cancelled");
      });

      it("a person who left the club keeps a seat line that no longer counts as active, can be taken out, and cannot be put back", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Cy");
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
        const detail = await detailFor(f, practice.id, staffViewer);
        expect(detail!.boats[0].seats[0]).toMatchObject({ name: "Cy Quill", active: false });
        await clearSeat(f.store, PRACTICE_RULES, staffCtx(), { practiceId: practice.id, itemId: f.i.Albatross, seat: 1 });
        expect(await reasonsOf(seat(f, practice.id, "Albatross", 1, "Cy"))).toHaveLength(1);
      });
    });

    describe("what people see", () => {
      it("staff see everything, including how to reach a booker whose booking the practice overlaps", async () => {
        const f = await fixture();
        await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        const { practice } = await make(f, { notes: "Bring water.", itemIds: [f.i.Albatross, f.i.Pelican] });
        await seat(f, practice.id, "Albatross", 1, "Ben", "port");
        const d = (await detailFor(f, practice.id, staffViewer, NOW))!;
        expect(d).toMatchObject({ name: "Morning session", notes: "Bring water.", status: "scheduled", coachName: "Staff", coachActive: true, started: false, ended: false, canEdit: true, mine: null });
        expect(d.boats.map((b) => b.name)).toEqual(["Albatross", "Pelican"]);
        expect(d.boats[0].className).toBeTruthy();
        expect(d.boats[0].seats).toHaveLength(4);
        expect(d.boats[1].seats).toHaveLength(2);
        expect(d.clashes).toHaveLength(1);
        expect(d.clashes[0]).toMatchObject({ itemName: "Albatross", bookerName: "Ada Quill", contact: { email: "ada@example.com", phone: expect.any(String) } });
      });

      it("a coach sees the clashes but not how to reach the bookers", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        const d = (await detailFor(f, practice.id, memberViewer(f, "Ben")))!;
        expect(d.canEdit).toBe(true);
        expect(d.clashes).toHaveLength(1);
        expect(d.clashes[0].contact).toBeNull();
        expect(d.coachName).toBe("Ben Quill");
      });

      it("a coach who does not run it sees the practice and cannot change it, and sees no clash list", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        await makeCoach(f, "Eli");
        await bookAs(f, "Ada", "Albatross", at(2, 8), at(2, 9));
        const { practice } = await make(f, {}, asMember(f, "Ben"));
        const d = (await detailFor(f, practice.id, memberViewer(f, "Eli")))!;
        expect(d.canEdit).toBe(false);
        expect(d.clashes).toEqual([]);
        expect(d.boats).toHaveLength(1);
      });

      it("a seated member sees the practice and only their own boat with its crew, never the other boats or the clashes", async () => {
        const f = await fixture();
        await bookAs(f, "Dee", "Heron", at(2, 8), at(2, 9));
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican, f.i.Heron] });
        await seat(f, practice.id, "Pelican", 1, "Ada", "port");
        await seat(f, practice.id, "Pelican", 2, "Ben", "starboard");
        await seat(f, practice.id, "Albatross", 1, "Eli");
        const d = (await detailFor(f, practice.id, memberViewer(f, "Ada")))!;
        expect(d.mine).toEqual({ boat: "Pelican", seat: 1, side: "port" });
        expect(d.canEdit).toBe(false);
        expect(d.clashes).toEqual([]);
        expect(d.boats.map((b) => b.name)).toEqual(["Pelican"]);
        expect(d.boats[0].seats.map((x) => x.name)).toEqual(["Ada Quill", "Ben Quill"]);
      });

      it("a member who is not in it, the system, and a member whose practice was cancelled see nothing", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ada");
        expect(await detailFor(f, practice.id, memberViewer(f, "Dee"))).toBeNull();
        expect(await detailFor(f, practice.id, { kind: "system", label: "System" })).toBeNull();
        expect(await detailFor(f, "00000000-0000-4000-8000-0000000fffff", staffViewer)).toBeNull();
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id, "Wind");
        expect(await detailFor(f, practice.id, memberViewer(f, "Ada"))).toBeNull();
        expect((await detailFor(f, practice.id, staffViewer))!).toMatchObject({ status: "cancelled", cancelReason: "Wind", canEdit: false });
      });

      it("says whether it has started or ended, and stops offering changes once it is over", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        expect(await detailFor(f, practice.id, staffViewer, at(2, 7))).toMatchObject({ started: true, ended: false, canEdit: true });
        expect(await detailFor(f, practice.id, staffViewer, new Date(at(2, 7).getTime() - 1))).toMatchObject({ started: false, ended: false });
        expect(await detailFor(f, practice.id, staffViewer, at(2, 9))).toMatchObject({ started: true, ended: true, canEdit: false });
      });

      it("lists practices still to come soonest first and past or cancelled ones newest first, for staff and coaches only", async () => {
        const f = await fixture();
        await makeCoach(f, "Ben");
        // Ben booked Pelican before the practice reserved it, so the practice overlaps his booking.
        await bookAs(f, "Ben", "Pelican", at(1, 8), at(1, 9));
        const later = await make(f, { name: "Later", startsAt: at(3, 7), endsAt: at(3, 9), itemIds: [f.i.Heron] });
        const sooner = await make(f, { name: "Sooner", startsAt: at(1, 7), endsAt: at(1, 9), itemIds: [f.i.Albatross, f.i.Pelican] }, asMember(f, "Ben"));
        const gone = await make(f, { name: "Cancelled", startsAt: at(2, 7), endsAt: at(2, 9), itemIds: [f.i.Osprey] });
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), gone.practice.id);
        await seat(f, sooner.practice.id, "Albatross", 1, "Ada");
        const s = await state(f);
        const rows = practiceList(s, f.book, staffViewer, NOW, "upcoming");
        expect(rows.map((r) => r.name)).toEqual(["Sooner", "Later"]);
        expect(rows[0]).toMatchObject({ id: sooner.practice.id, coachName: "Ben Quill", boats: 2, seated: 1, seatsTotal: 6, clashes: 1, canEdit: true, status: "scheduled" });
        expect(rows[1]).toMatchObject({ id: later.practice.id, coachName: "Staff", boats: 1, seated: 0, seatsTotal: 1, clashes: 0 });
        expect(practiceList(s, f.book, staffViewer, NOW, "past").map((r) => r.name)).toEqual(["Cancelled"]);
        // After the first has ended it moves to the past list, newest first.
        const afterSooner = new Date(at(1, 9).getTime() + 1);
        expect(practiceList(s, f.book, staffViewer, afterSooner, "upcoming").map((r) => r.name)).toEqual(["Later"]);
        expect(practiceList(s, f.book, staffViewer, afterSooner, "past").map((r) => r.name)).toEqual(["Cancelled", "Sooner"]);
        // A coach sees the list but can only change the one they run.
        const ben = practiceList(s, f.book, memberViewer(f, "Ben"), NOW, "upcoming");
        expect(ben.map((r) => [r.name, r.canEdit])).toEqual([["Sooner", true], ["Later", false]]);
        expect(practiceList(s, f.book, memberViewer(f, "Ada"), NOW, "upcoming")).toEqual([]);
        expect(practiceList(s, f.book, { kind: "system", label: "System" }, NOW, "upcoming")).toEqual([]);
      });

      it("shows a member the practices they are seated in, soonest first, with their crew, and nothing past or cancelled", async () => {
        const f = await fixture();
        const a = await make(f, { name: "Second", startsAt: at(3, 7), endsAt: at(3, 9), itemIds: [f.i.Pelican] });
        const b = await make(f, { name: "First", startsAt: at(1, 7), endsAt: at(1, 9), itemIds: [f.i.Albatross] });
        const c = await make(f, { name: "Cancelled", startsAt: at(4, 7), endsAt: at(4, 9), itemIds: [f.i.Heron] });
        await seat(f, a.practice.id, "Pelican", 2, "Ada", "starboard");
        await seat(f, a.practice.id, "Pelican", 1, "Dee", "port");
        await seat(f, b.practice.id, "Albatross", 3, "Ada", "port");
        await seat(f, c.practice.id, "Heron", 1, "Ada");
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), c.practice.id);
        const s = await state(f);
        const mine = myPractices(s, f.m.Ada, NOW);
        expect(mine.map((x) => [x.name, x.boat, x.seat, x.side, x.crew, x.coachName])).toEqual([
          ["First", "Albatross", 3, "port", [], "Staff"],
          ["Second", "Pelican", 2, "starboard", ["Dee Reed"], "Staff"],
        ]);
        expect(myPractices(s, f.m.Ada, new Date(at(1, 9).getTime() + 1)).map((x) => x.name)).toEqual(["Second"]);
        expect(myPractices(s, f.m.Eli, NOW)).toEqual([]);
        expect(sideWords("port")).toBe("Port");
        expect(sideWords("starboard")).toBe("Starboard");
        expect(sideWords(null)).toBe("No side");
      });

      it("does not show a seat on a boat that came off the practice", async () => {
        const f = await fixture();
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican] });
        await seat(f, practice.id, "Pelican", 1, "Ada");
        await removePracticeBoat(f.store, staffCtx(), practice.id, f.i.Pelican);
        expect(myPractices(await state(f), f.m.Ada, NOW)).toEqual([]);
      });

      it("lists the bookings a practice overlaps in time order, and none once it is cancelled", async () => {
        const f = await fixture();
        const second = await bookAs(f, "Ada", "Pelican", at(2, 8, 30), at(2, 9));
        const first = await bookAs(f, "Eli", "Albatross", at(2, 7), at(2, 8));
        const { practice } = await make(f, { itemIds: [f.i.Albatross, f.i.Pelican] });
        expect(practiceClashes(await state(f), practice.id).map((c) => c.bookingId)).toEqual([first.booking.id, second.booking.id]);
        await cancelPractice(f.store, PRACTICE_RULES, staffCtx(), practice.id);
        expect(practiceClashes(await state(f), practice.id)).toEqual([]);
      });
    });

    describe("finding a rower", () => {
      it("shows nothing until three letters are typed, never more than six names, and no one already in the practice or who has left", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await seat(f, practice.id, "Albatross", 1, "Ada");
        await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
        const s = await state(f);
        expect(findRowers(s, practice.id, "qu")).toEqual({ tooShort: true, people: [], more: false });
        expect(findRowers(s, practice.id, "  ").tooShort).toBe(true);
        const quills = findRowers(s, practice.id, "quill");
        expect(quills.people.map((p) => p.name)).toEqual(["Ben Quill"]);
        expect(quills.more).toBe(false);
        expect(findRowers(s, practice.id, "reed").people.map((p) => p.name)).toEqual(["Dee Reed", "Eli Reed"]);
        expect(Object.keys(findRowers(s, practice.id, "reed").people[0]).sort()).toEqual(["household", "memberId", "name"]);
      });

      it("tells two people with one name apart by household, and says when there are more than six", async () => {
        const f = await fixture();
        const { practice } = await make(f);
        await f.store.transaction(async (s, newId) => {
          const dup = { ...s.members.find((m) => m.id === f.m.Dee)!, id: newId(), householdId: f.h.Quill, email: "dee2@example.com", role: "additional" as const };
          s.members.push(dup);
          for (let i = 0; i < 7; i++) s.members.push({ ...s.members[0], id: newId(), firstName: `Zed${i}`, lastName: "Nobody", email: `zed${i}@example.com`, role: "additional" });
        });
        const s = await state(f);
        const dees = findRowers(s, practice.id, "dee reed");
        expect(dees.people).toHaveLength(2);
        expect(dees.people.map((p) => p.household).sort()).toEqual(["The Quill household", "The Reed household"]);
        const many = findRowers(s, practice.id, "nobody");
        expect(many.people).toHaveLength(6);
        expect(many.more).toBe(true);
        expect(many.people.every((p) => p.household === null)).toBe(true);
      });
    });
  });
}
