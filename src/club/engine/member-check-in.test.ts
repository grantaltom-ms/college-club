import { describe, expect, it } from "vitest";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { ClubError } from "../errors";
import type { AttendanceRules } from "../types";
import { checkInChoices, checkInPeople, memberCheckIn, rowFor, selfCheckInPhase } from "./attendance";
import { cancelBooking } from "./bookings";
import { createClass, scheduleSessions, signUp } from "./classes";
import { createEvent, rsvp } from "./events";
import { createHousehold, endHousehold, grantQualification, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { NOW, STORE_KINDS, at, bookAs, buildFixture, buildFixtureSettling, databaseUrls, mark, memberCtx, openAnother, staffCtx, type Fixture, type StoreKind } from "./testkit";

/**
 * Members checking themselves in, on the iPad and on their own phone, on both stores. Today is Wed Oct 28, 1 pm Pacific.
 * With the placeholder rules check-in opens 30 minutes before the start, and a booking or chair nobody checked in for is a
 * no-show the moment it ends.
 */

const rulesWith = (change: Partial<AttendanceRules["defaults"]>): AttendanceRules => ({ placeholder: true, defaults: { ...ATTENDANCE_RULES.defaults, ...change } });

const booking = (f: Fixture, who: string, item: string, day: number, from: number, to: number, crew: string[] = []) => bookAs(f, who, item, at(day, from), at(day, to), crew);
const tap = (f: Fixture, who: string, id: string, now: Date, via: "ipad" | "phone" = "phone", rules: AttendanceRules = ATTENDANCE_RULES, kind: "booking" | "class" | "event" = "booking") =>
  memberCheckIn(f.store, memberCtx(f.m[who], who, now), rules, { kind, id, via });
const statusOf = async (f: Fixture, id: string) => (await f.store.read()).bookings.find((b) => b.id === id)!.status;

/** What the refusal was, as [code, message]. */
async function refusal(attempt: Promise<unknown>): Promise<[string, string]> {
  try {
    await attempt;
  } catch (e) {
    if (e instanceof ClubError) return [e.code, e.message];
    throw e;
  }
  throw new Error("It was not refused.");
}

async function club(kind: StoreKind) {
  const clock = { now: NOW };
  const f = await buildFixtureSettling(kind, () => clock.now);
  await f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    f.i["Boathouse gym"] = id;
    const room = newId();
    s.items.push({ id: room, name: "Clubhouse room", classCode: "room-space", ruleOverrides: {} });
    f.i["Clubhouse room"] = room;
  });
  const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 2, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
  return { f, clock, yoga };
}

describe.each(STORE_KINDS)("members checking themselves in on the %s store", (kind) => {
  describe("a boat or space outing", () => {
    it("opens 30 minutes before the start, and the line says who tapped, when, and how", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      expect(await refusal(tap(f, "Ada", b.id, at(0, 14, 29)))).toEqual(["not_open", "Check-in for Heron opens at 2:30 pm."]);
      expect(await statusOf(f, b.id)).toBe("upcoming");
      const line = await tap(f, "Ada", b.id, at(0, 14, 30), "phone");
      expect(line).toMatchObject({ kind: "booking", recordId: b.id, memberId: f.m.Ada, at: at(0, 14, 30).toISOString(), outcome: "attended", previous: null, via: "phone", by: { kind: "member", memberId: f.m.Ada, label: "Ada" }, note: null });
      expect((await f.store.read()).bookings.find((x) => x.id === b.id)).toMatchObject({ status: "completed", statusChangedAt: at(0, 14, 30).toISOString() });
      expect((await f.store.read()).attendance).toEqual([line]);
    });

    it("records the iPad as the iPad", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      expect(await tap(f, "Ada", b.id, at(0, 15, 5), "ipad")).toMatchObject({ via: "ipad", by: { kind: "member", memberId: f.m.Ada } });
    });

    it("works right up to the last minute, and not after: then it is a no-show and only staff can put it right", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      clock.now = at(0, 15, 59);
      await tap(f, "Ada", b.id, clock.now);
      const { booking: late } = await booking(f, "Dee", "Osprey", 0, 15, 16);
      clock.now = at(0, 16);
      expect(await refusal(tap(f, "Dee", late.id, clock.now))).toEqual(["too_late", "Osprey was marked a no-show. Ask club staff to put it right."]);
      expect(await statusOf(f, late.id)).toBe("no_show");
      // Staff put it right; that is a correction on the record, not a member's tap.
      await mark(f.store, staffCtx(clock.now), "booking", late.id, "attended");
      expect((await f.store.read()).attendance.map((l) => [l.recordId, l.outcome, l.via])).toEqual([
        [b.id, "attended", "phone"],
        [late.id, "no_show", "automatic"],
        [late.id, "attended", "staff"],
      ]);
    });

    it("waits out the grace minutes when the rules have some, and says when time is up", async () => {
      const f = await buildFixture(kind);
      const grace = rulesWith({ noShowAfterEndMinutes: 15 });
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      await tap(f, "Ada", b.id, at(0, 16, 14), "phone", grace);
      const { booking: other } = await booking(f, "Dee", "Osprey", 0, 15, 16);
      expect(await refusal(tap(f, "Dee", other.id, at(0, 16, 15), "phone", grace))).toEqual(["too_late", "The time for Osprey has passed. Ask club staff to put it right."]);
      // With no grace the end is the end, even when nothing has marked the no-show yet.
      const { booking: third } = await booking(f, "Eli", "Kingfisher", 0, 15, 16);
      expect((await refusal(tap(f, "Eli", third.id, at(0, 16)))).at(0)).toBe("too_late");
    });

    it("follows the check-in rule: opens at the start when the rules say so", async () => {
      const f = await buildFixture(kind);
      const strict = rulesWith({ checkInOpensMinutesBefore: 0 });
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      expect((await refusal(tap(f, "Ada", b.id, at(0, 14, 59), "phone", strict))).at(0)).toBe("not_open");
      await tap(f, "Ada", b.id, at(0, 15), "phone", strict);
    });

    it("is for people on the outing only: the booker and the crew, nobody else, and not staff", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Eli", "Loon", 0, 15, 16, ["Ben"]);
      expect(await refusal(tap(f, "Cy", b.id, at(0, 15)))).toEqual(["forbidden", "That is not your reservation."]);
      expect(await refusal(memberCheckIn(f.store, staffCtx(at(0, 15)), ATTENDANCE_RULES, { kind: "booking", id: b.id, via: "phone" }))).toEqual(["forbidden", "Only a member can check themselves in."]);
      expect(await statusOf(f, b.id)).toBe("upcoming");
      expect((await f.store.read()).attendance).toEqual([]);
    });

    it("is one outcome per outing: a crew member can tap for the boat, the line says who, and the booker is then already in", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Eli", "Loon", 0, 15, 16, ["Ben"]);
      const line = await tap(f, "Ben", b.id, at(0, 15), "ipad");
      expect(line).toMatchObject({ memberId: f.m.Ben, by: { memberId: f.m.Ben }, via: "ipad" });
      expect(await statusOf(f, b.id)).toBe("completed");
      expect(await refusal(tap(f, "Eli", b.id, at(0, 15, 1)))).toEqual(["already_recorded", "Loon is already checked in."]);
      expect((await f.store.read()).attendance).toHaveLength(1);
      // Staff see it was the crew member, and how.
      expect(rowFor(await f.store.read(), "booking", b.id, at(0, 15, 1), ATTENDANCE_RULES)).toMatchObject({ outcome: "attended", via: "ipad", recordedBy: "Ben" });
    });

    it("is refused for crew who have left the club, though the booking stays", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Eli", "Loon", 0, 15, 16, ["Ben"]);
      await removeMember(f.store, clubLedger, staffCtx(NOW), f.m.Ben);
      expect((await f.store.read()).bookings.find((x) => x.id === b.id)!.crew).toEqual([]);
      expect(await refusal(tap(f, "Ben", b.id, at(0, 15)))).toEqual(["forbidden", "Only active members can check in."]);
      await tap(f, "Eli", b.id, at(0, 15)); // the booker is still in the boat
    });

    it("cannot be done twice, and cannot undo what staff recorded", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      await tap(f, "Ada", b.id, at(0, 15));
      expect(await refusal(tap(f, "Ada", b.id, at(0, 15, 1), "ipad"))).toEqual(["already_recorded", "Heron is already checked in."]);
      // Staff mark it a no-show: the member cannot tap their way back in.
      await mark(f.store, staffCtx(at(0, 15, 5)), "booking", b.id, "no_show");
      expect((await refusal(tap(f, "Ada", b.id, at(0, 15, 6)))).at(0)).toBe("too_late");
      expect(await statusOf(f, b.id)).toBe("no_show");
    });

    it("is refused for a cancelled booking, for the club room (no check-in at all), and for something that does not exist", async () => {
      const { f } = await club(kind);
      const gone = (await booking(f, "Ada", "Heron", 0, 15, 16)).booking;
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), gone.id);
      expect(await refusal(tap(f, "Ada", gone.id, at(0, 15)))).toEqual(["conflict", "That booking was cancelled, so there is nothing to check in."]);
      const room = (await booking(f, "Ada", "Clubhouse room", 0, 15, 16)).booking;
      expect(await refusal(tap(f, "Ada", room.id, at(0, 15)))).toEqual(["conflict", "Room Space reservations do not need a check-in."]);
      expect((await refusal(tap(f, "Ada", "00000000-0000-4000-8000-000000000000", at(0, 15)))).at(0)).toBe("not_found");
      expect(await statusOf(f, room.id)).toBe("upcoming");
    });

    it("is refused for someone who has left the club while their outing was under way", async () => {
      const { f } = await club(kind);
      const { booking: b } = await bookAs(f, "Ada", "Heron", at(0, 12), at(0, 14), [], undefined, at(-1, 12));
      await endHousehold(f.store, clubLedger, staffCtx(NOW), f.h.Quill);
      expect(await statusOf(f, b.id)).toBe("upcoming"); // under way: left alone
      expect(await refusal(tap(f, "Ada", b.id, NOW))).toEqual(["forbidden", "Only active members can check in."]);
    });

    it("refuses a way that is not the iPad or the phone, and events, in words", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      expect(await refusal(tap(f, "Ada", b.id, at(0, 15), "staff" as never))).toEqual(["invalid", "Choose the iPad or the phone."]);
      const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(0, 15), endsAt: at(0, 17) });
      const { rsvp: line } = await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: event.id, memberId: f.m.Ada, guests: 0 });
      expect(await refusal(tap(f, "Ada", line.id, at(0, 15), "phone", ATTENDANCE_RULES, "event"))).toEqual(["forbidden", "Events are checked off by club staff."]);
    });
  });

  describe("a class chair", () => {
    it("can be checked in by the person holding it, once, from when check-in opens", async () => {
      const { f, yoga } = await club(kind);
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(0, 15), capacity: 1 });
      const chair = (await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Ada, "Ada"), { sessionId: session.id, memberId: f.m.Ada })).signUp;
      const waiting = (await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Ben, "Ben"), { sessionId: session.id, memberId: f.m.Ben })).signUp;
      expect((await refusal(tap(f, "Ada", chair.id, at(0, 14, 29), "ipad", ATTENDANCE_RULES, "class"))).at(0)).toBe("not_open");
      expect(await refusal(tap(f, "Ben", waiting.id, at(0, 15), "phone", ATTENDANCE_RULES, "class"))).toEqual(["conflict", "That person is on the waiting list without a chair, so there is nothing to check in."]);
      expect(await refusal(tap(f, "Cy", chair.id, at(0, 15), "phone", ATTENDANCE_RULES, "class"))).toEqual(["forbidden", "That is not your reservation."]);
      const line = await tap(f, "Ada", chair.id, at(0, 14, 30), "ipad", ATTENDANCE_RULES, "class");
      expect(line).toMatchObject({ kind: "class", recordId: chair.id, memberId: f.m.Ada, via: "ipad", outcome: "attended", previous: null });
      expect((await f.store.read()).signups.find((g) => g.id === chair.id)!.status).toBe("attended");
      expect((await refusal(tap(f, "Ada", chair.id, at(0, 15), "phone", ATTENDANCE_RULES, "class"))).at(0)).toBe("already_recorded");
    });

    it("is too late once the class is over", async () => {
      const { f, clock, yoga } = await club(kind);
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(0, 15) });
      const chair = (await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Ada, "Ada"), { sessionId: session.id, memberId: f.m.Ada })).signUp;
      clock.now = at(0, 16);
      expect((await refusal(tap(f, "Ada", chair.id, clock.now, "phone", ATTENDANCE_RULES, "class"))).at(0)).toBe("too_late");
    });
  });

  describe("what a member can check in for", () => {
    it("lists open, done and coming-up outings and chairs, and leaves out everything else", async () => {
      const { f, yoga } = await club(kind);
      const yesterday = at(-1, 12);
      // Ada: a kayak she has already checked in for (still under way), a single that is open now, a double she is crew on later,
      // a paddle board this evening, and a single tomorrow morning.
      const done = (await bookAs(f, "Ada", "Otter", at(0, 12), at(0, 13, 30), [], undefined, yesterday)).booking;
      await tap(f, "Ada", done.id, NOW);
      const openNow = (await bookAs(f, "Ada", "Heron", at(0, 13, 30), at(0, 15), [], undefined, yesterday)).booking;
      const crewed = (await booking(f, "Eli", "Loon", 0, 15, 16, ["Ada"])).booking;
      const soon = (await booking(f, "Ada", "Skimmer", 0, 17, 18)).booking;
      const tomorrow = (await booking(f, "Ada", "Kingfisher", 1, 7, 8)).booking;
      // Left out for Ada: a cancelled dock booking, the club room (no check-in), someone else's boat, a waiting place, an event.
      const cancelled = (await booking(f, "Ada", "Dock slip A", 0, 14, 15)).booking;
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), cancelled.id);
      const room = (await booking(f, "Ada", "Clubhouse room", 0, 14, 15)).booking;
      const elses = (await booking(f, "Dee", "Osprey", 0, 14, 15)).booking;
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(0, 16), capacity: 1 });
      await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Eli, "Eli"), { sessionId: session.id, memberId: f.m.Eli }).catch(() => undefined);
      const waiting = (await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Ada, "Ada"), { sessionId: session.id, memberId: f.m.Ada })).signUp;
      const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(0, 17), endsAt: at(0, 19) });
      await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: event.id, memberId: f.m.Ada, guests: 0 });

      const state = await f.store.read();
      const mine = checkInChoices(state, f.m.Ada, NOW, ATTENDANCE_RULES);
      expect(mine.map((c) => [c.title, c.state.phase])).toEqual([
        ["Otter", "done"],
        ["Heron", "open"],
        ["Loon", "not_yet"],
        ["Skimmer", "not_yet"],
        ["Kingfisher", "not_yet"],
      ]);
      expect(mine.find((c) => c.id === crewed.id)).toMatchObject({ withNames: ["Eli Reed"], kind: "booking", state: { phase: "not_yet", opensAt: at(0, 14, 30).toISOString() } });
      const ids = mine.map((c) => c.id);
      for (const id of [cancelled.id, room.id, elses.id, waiting.id]) expect(ids).not.toContain(id);
      // "Coming up" looks a day ahead by default; tomorrow's check-in opens at 6:30 am, 17 hours and 30 minutes from now.
      expect(ids).toContain(tomorrow.id);
      expect(checkInChoices(state, f.m.Ada, NOW, ATTENDANCE_RULES, 12).map((c) => c.id)).not.toContain(tomorrow.id);
      expect(selfCheckInPhase(state, "booking", openNow.id, f.m.Ada, NOW, ATTENDANCE_RULES)).toEqual({ phase: "open" });
      expect(selfCheckInPhase(state, "booking", done.id, f.m.Ada, NOW, ATTENDANCE_RULES)).toEqual({ phase: "done" });
      expect(selfCheckInPhase(state, "booking", soon.id, f.m.Ada, NOW, ATTENDANCE_RULES)).toEqual({ phase: "not_yet", opensAt: at(0, 16, 30).toISOString() });
      expect(selfCheckInPhase(state, "booking", elses.id, f.m.Ada, NOW, ATTENDANCE_RULES)).toBeNull();
      expect(selfCheckInPhase(state, "booking", room.id, f.m.Ada, NOW, ATTENDANCE_RULES)).toBeNull();
      expect(selfCheckInPhase(state, "booking", "nope", f.m.Ada, NOW, ATTENDANCE_RULES)).toBeNull();
      expect(selfCheckInPhase(state, "event", "nope", f.m.Ada, NOW, ATTENDANCE_RULES)).toBeNull();
    });

    it("stops listing an outing once it is over, and a no-show is never offered", async () => {
      const { f, clock } = await club(kind);
      const yesterday = at(-1, 12);
      const { booking: b } = await bookAs(f, "Ada", "Heron", at(0, 13), at(0, 14), [], undefined, yesterday);
      const { booking: d } = await bookAs(f, "Dee", "Osprey", at(0, 13), at(0, 14), [], undefined, yesterday);
      await tap(f, "Dee", d.id, NOW);
      expect(checkInChoices(await f.store.read(), f.m.Ada, NOW, ATTENDANCE_RULES).map((c) => c.id)).toEqual([b.id]);
      clock.now = at(0, 14);
      const state = await f.store.read();
      expect(checkInChoices(state, f.m.Ada, clock.now, ATTENDANCE_RULES)).toEqual([]); // now a no-show
      expect(checkInChoices(state, f.m.Dee, clock.now, ATTENDANCE_RULES)).toEqual([]); // checked in, and over
    });
  });

  describe("who the iPad lists", () => {
    it("lists only people with something open right now, by last name, and drops them once they have checked in", async () => {
      const { f, yoga } = await club(kind);
      const yesterday = at(-1, 12);
      await bookAs(f, "Eli", "Loon", at(0, 13), at(0, 15), ["Ben"], undefined, yesterday); // Eli and Ben: open
      await booking(f, "Ada", "Heron", 0, 15, 16); // not open until 2:30
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(0, 13, 20), capacity: 2 });
      await signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Dee, "Dee", at(0, 10)), { sessionId: session.id, memberId: f.m.Dee }); // signed up this morning
      const state = await f.store.read();
      expect(checkInPeople(state, NOW, ATTENDANCE_RULES).map((p) => p.name)).toEqual(["Ben Quill", "Dee Reed", "Eli Reed"]);
      expect(checkInPeople(state, at(0, 14, 30), ATTENDANCE_RULES).map((p) => p.name)).toContain("Ada Quill");
      // Nobody is listed when nothing is open: not even Ada, whose boat is hours away.
      expect(checkInPeople(state, at(0, 6), ATTENDANCE_RULES)).toEqual([]);

      const dee = state.signups.find((g) => g.memberId === f.m.Dee)!;
      await tap(f, "Dee", dee.id, NOW, "ipad", ATTENDANCE_RULES, "class");
      const outing = state.bookings.find((b) => b.itemId === f.i.Loon)!;
      await tap(f, "Ben", outing.id, NOW, "ipad");
      // The outing is checked in as one, so neither Ben nor Eli has anything left to do.
      expect(checkInPeople(await f.store.read(), NOW, ATTENDANCE_RULES)).toEqual([]);
    });

    it("tells two people with the same name apart by their household, and only then", async () => {
      const { f } = await club(kind);
      const yesterday = at(-1, 12);
      const twin = await createHousehold(f.store, staffCtx(), { displayName: "The Other Quill household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Ada", lastName: "Quill", email: "ada.other@example.com" } });
      await grantQualification(f.store, staffCtx(), twin.members[0].id, "scull-1");
      await bookAs(f, "Ada", "Heron", at(0, 13), at(0, 14), [], undefined, yesterday);
      await bookAs(f, twin.members[0].id, "Kingfisher", at(0, 13), at(0, 14), [], undefined, yesterday);
      await bookAs(f, "Dee", "Osprey", at(0, 13), at(0, 14), [], undefined, yesterday);
      const people = checkInPeople(await f.store.read(), NOW, ATTENDANCE_RULES);
      expect(people.filter((p) => p.name === "Ada Quill").map((p) => p.household).sort()).toEqual(["The Other Quill household", "The Quill household"]);
      expect(people.find((p) => p.name === "Dee Reed")!.household).toBeNull();
    });
  });

  describe("what staff see afterwards", () => {
    it("shows how a check-in was made, and staff can still correct it", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
      await tap(f, "Ada", b.id, at(0, 15), "phone");
      expect(rowFor(await f.store.read(), "booking", b.id, at(0, 15), ATTENDANCE_RULES)).toMatchObject({ outcome: "attended", via: "phone", recordedBy: null, automatic: false });
      await mark(f.store, staffCtx(at(0, 15, 10)), "booking", b.id, "no_show", { note: "Boat never left the dock" });
      const lines = (await f.store.read()).attendance;
      expect(lines.map((l) => [l.outcome, l.previous, l.via])).toEqual([["attended", null, "phone"], ["no_show", "attended", "staff"]]);
      expect(rowFor(await f.store.read(), "booking", b.id, at(0, 15, 10), ATTENDANCE_RULES)).toMatchObject({ outcome: "no_show", via: "staff" });
    });
  });

  describe("tapping at the same moment", () => {
    it("gives exactly one check-in when the booker and the crew both tap at once", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Eli", "Loon", 0, 15, 16, ["Ben"]);
      const results = await Promise.allSettled(["Eli", "Ben", "Eli", "Ben", "Eli", "Ben"].map((who, i) => tap(f, who, b.id, at(0, 15, 1), i % 2 === 0 ? "phone" : "ipad")));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "already_recorded" });
      const state = await f.store.read();
      expect(state.attendance).toHaveLength(1);
      expect(state.bookings.find((x) => x.id === b.id)!.status).toBe("completed");
    });

    if (kind === "postgres") {
      it("gives exactly one check-in when two app servers get taps at once", async () => {
        const { f } = await club(kind);
        const other = openAnother(databaseUrls.get(f.store)!);
        const { booking: b } = await booking(f, "Ada", "Heron", 0, 15, 16);
        const attempts = [f.store, other, f.store, other].map((store, i) => memberCheckIn(store, memberCtx(f.m.Ada, "Ada", at(0, 15, 1)), ATTENDANCE_RULES, { kind: "booking", id: b.id, via: i % 2 === 0 ? "phone" : "ipad" }));
        const results = await Promise.allSettled(attempts);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect((await f.store.read()).attendance).toHaveLength(1);
      });
    }
  });
});
