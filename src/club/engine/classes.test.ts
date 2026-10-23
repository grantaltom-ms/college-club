import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { CLASS_RULES } from "../settings/class-rules";
import { pacificMinutes } from "../time";
import { createBooking, takeOutOfService, BookingRefused } from "./bookings";
import {
  SignUpRefused,
  cancelSession,
  checkSignUp,
  createClass,
  leaveClass,
  scheduleSessions,
  sessionView,
  setCapacity,
  signUp,
  type NewSessions,
} from "./classes";
import { endHousehold, removeMember } from "./households";
import { clubLedger } from "./ledger";
import { historyOf } from "./queries";
import { NOW, STORE_KINDS, addMembers, at, bookAs, fixtureFor, memberCtx, refusalMessages, refusedFor, request, staffCtx, mark, type Fixture } from "./testkit";

/** The invented club from the booking tests, plus a gym, a room and one class ("Yoga", 3 chairs, 60 minutes, in the gym). */
async function classClub(kind: (typeof STORE_KINDS)[number]) {
  const f = await fixtureFor(kind)();
  await f.store.transaction(async (s, newId) => {
    for (const [name, classCode] of [
      ["Boathouse gym", "gym-space"],
      ["Clubhouse room", "room-space"],
    ] as const) {
      const id = newId();
      s.items.push({ id, name, classCode, ruleOverrides: {} });
      f.i[name] = id;
    }
  });
  const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
  return { f, yoga };
}

const schedule = (f: Fixture, input: NewSessions, now: Date = NOW) => scheduleSessions(f.store, f.book, staffCtx(now), input);
const idOf = (f: Fixture, who: string) => f.m[who] ?? who;
const join = (f: Fixture, who: string, sessionId: string, now: Date = NOW) => signUp(f.store, f.book, CLASS_RULES, memberCtx(idOf(f, who), who, now), { sessionId, memberId: idOf(f, who) });
const leave = (f: Fixture, who: string, signUpId: string, now: Date = NOW) => leaveClass(f.store, CLASS_RULES, memberCtx(idOf(f, who), who, now), signUpId);
const refusedCodes = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof SignUpRefused) return e.reasons.map((r) => r.code);
    throw e;
  }
};
const refusedWords = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return [];
  } catch (e) {
    if (e instanceof SignUpRefused) return e.reasons.map((r) => r.message);
    throw e;
  }
};
const lineOf = async (f: Fixture, who: string, sessionId: string) => (await f.store.read()).signups.filter((g) => g.sessionId === sessionId && g.memberId === idOf(f, who));
const statuses = async (f: Fixture, sessionId: string) => Object.fromEntries((await f.store.read()).signups.filter((g) => g.sessionId === sessionId).map((g) => [g.memberId, g.status]));

describe.each(STORE_KINDS)("classes on the %s store", (kind) => {
  describe("staff set up classes and sessions", () => {
    it("lets staff create a class and schedule a session that holds the gym", async () => {
      const { f, yoga } = await classClub(kind);
      expect(yoga).toMatchObject({ name: "Yoga", defaultCapacity: 3, roomItemId: f.i["Boathouse gym"] });
      const [session] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      expect(session).toMatchObject({ classId: yoga.id, roomItemId: f.i["Boathouse gym"], capacity: 3, status: "scheduled", startsAt: at(1, 9).toISOString(), endsAt: at(1, 10).toISOString() });
      expect((await f.store.read()).sessions).toHaveLength(1);
    });

    it("lets only staff do it", async () => {
      const { f, yoga } = await classClub(kind);
      const asMember = memberCtx(f.m.Ada, "Ada");
      await expect(scheduleSessions(f.store, f.book, asMember, { classId: yoga.id, startsAt: at(1, 9) })).rejects.toMatchObject({ code: "forbidden" });
      await expect(createClass(f.store, f.book, CLASS_RULES, asMember, { name: "Spin", defaultCapacity: 5, defaultMinutes: 45 })).rejects.toMatchObject({ code: "forbidden" });
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      await expect(setCapacity(f.store, CLASS_RULES, asMember, s.id, 10)).rejects.toMatchObject({ code: "forbidden" });
      await expect(cancelSession(f.store, asMember, s.id, { reason: "x" })).rejects.toMatchObject({ code: "forbidden" });
    });

    it("refuses a duplicate class name, a class room that is not a gym or room, and bad numbers, in words", async () => {
      const { f } = await classClub(kind);
      await expect(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "yoga", defaultCapacity: 3, defaultMinutes: 60 })).rejects.toThrow('There is already a class called "yoga".');
      await expect(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Row", defaultCapacity: 3, defaultMinutes: 60, roomItemId: f.i.Heron })).rejects.toThrow("Heron is not a gym or room, so a class cannot use it.");
      await expect(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Row", defaultCapacity: 0, defaultMinutes: 60 })).rejects.toThrow("Chairs must be a whole number from 1 to 200.");
      await expect(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Row", defaultCapacity: 5, defaultMinutes: 5 })).rejects.toThrow("Length in minutes must be a whole number from 15 to 480.");
      await expect(createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Row", defaultCapacity: 5, defaultMinutes: 60, rules: { waitlistMax: -1 } })).rejects.toBeInstanceOf(ClubError);
    });

    it("refuses to schedule in the past", async () => {
      const { f, yoga } = await classClub(kind);
      await expect(schedule(f, { classId: yoga.id, startsAt: at(0, 12) })).rejects.toThrow(/has already started/);
      expect((await f.store.read()).sessions).toHaveLength(0);
    });

    it("keeps a weekly class at the same time on the clock across the clock change, and the same length", async () => {
      const { f, yoga } = await classClub(kind);
      // Thu Oct 29 7:00 am (summer time), then Nov 5 and Nov 12 (winter time).
      const sessions = await schedule(f, { classId: yoga.id, startsAt: at(1, 7), weeks: 3 });
      expect(sessions.map((s) => pacificMinutes(new Date(s.startsAt)))).toEqual([420, 420, 420]);
      expect(sessions.map((s) => new Date(s.startsAt).getUTCHours())).toEqual([14, 15, 15]);
      expect(sessions.map((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt))).toEqual([3600000, 3600000, 3600000]);
    });

    it("refuses a room another class already holds, and schedules nothing at all", async () => {
      const { f, yoga } = await classClub(kind);
      await schedule(f, { classId: yoga.id, startsAt: at(8, 9) });
      // A weekly series whose second week lands on the Nov 5 class: all or nothing.
      const stretch = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Stretch", defaultCapacity: 8, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
      await expect(schedule(f, { classId: stretch.id, startsAt: at(1, 9), weeks: 3 })).rejects.toThrow(/Nothing was scheduled\. Boathouse gym is already used for Yoga on Thursday, Nov 5, 9:00 to 10:00 am\./);
      expect((await f.store.read()).sessions).toHaveLength(1);
      // Back to back is fine.
      await expect(schedule(f, { classId: stretch.id, startsAt: at(8, 10) })).resolves.toHaveLength(1);
    });

    it("refuses a room a member has booked, naming who, and a room that is out of service", async () => {
      const { f, yoga } = await classClub(kind);
      await bookAs(f, "Ada", "Boathouse gym", at(1, 9), at(1, 9, 30));
      await expect(schedule(f, { classId: yoga.id, startsAt: at(1, 9) })).rejects.toThrow("Boathouse gym is booked by Ada Quill on Thursday, Oct 29, 9:00 to 9:30 am. Cancel that booking first.");
      await takeOutOfService(f.store, staffCtx(), f.i["Boathouse gym"], { from: at(2, 5), until: at(2, 20), reason: "Floor repair" });
      await expect(schedule(f, { classId: yoga.id, startsAt: at(2, 9) })).rejects.toThrow(/Boathouse gym is out of service/);
    });
  });

  describe("signing up", () => {
    it("gives a chair, and members see their own line but no one else's name", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const result = await join(f, "Ada", s.id);
      expect(result).toMatchObject({ outcome: "enrolled", place: null, signUp: { memberId: f.m.Ada, status: "enrolled", sessionId: s.id } });
      await join(f, "Dee", s.id);
      const state = await f.store.read();
      const asAda = sessionView(state, s, { kind: "member", memberId: f.m.Ada });
      expect(asAda).toMatchObject({ enrolled: 2, waiting: 0, full: false, sheet: [], yours: { status: "enrolled", name: null } });
      expect(JSON.stringify(asAda)).not.toContain("Reed");
      const asStaff = sessionView(state, s, { kind: "staff" });
      expect(asStaff.sheet.map((l) => l.name)).toEqual(["Ada Quill", "Dee Reed"]);
    });

    it("lets a member sign up only themselves, and staff sign up anyone", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      await expect(signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m.Ada, "Ada"), { sessionId: s.id, memberId: f.m.Ben })).rejects.toMatchObject({ code: "forbidden" });
      const byStaff = await signUp(f.store, f.book, CLASS_RULES, staffCtx(), { sessionId: s.id, memberId: f.m.Ben });
      expect(byStaff.signUp.createdBy).toEqual({ kind: "staff", label: "Test staff" });
    });

    it("refuses a second sign-up for the same class, saying where the person stands", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      await join(f, "Dee", s.id);
      expect(await refusedWords(join(f, "Ada", s.id))).toEqual(["You are already in this class."]);
      expect(await refusedWords(join(f, "Dee", s.id))).toEqual(["You are already on the waiting list, 1st in line."]);
      expect(await lineOf(f, "Dee", s.id)).toHaveLength(1);
    });

    it("refuses a household that has ended, and a class that was cancelled or has begun", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const [t] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9) });
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      expect(await refusedWords(join(f, "Dee", s.id))).toEqual([expect.stringMatching(/membership ended .* so class sign-ups are closed\.$/)]);
      await cancelSession(f.store, staffCtx(), t.id, { reason: "Instructor is ill" });
      expect(await refusedWords(join(f, "Ada", t.id))).toEqual(["Yoga on Friday, Oct 30 was cancelled."]);
      expect(await refusedCodes(join(f, "Ada", s.id, at(1, 9, 5)))).toEqual(["class_started"]);
    });
  });

  describe("when sign-up opens and closes", () => {
    it("opens a new day exactly at midnight Pacific, 14 days ahead: one minute before is refused", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(15, 9) });
      expect(await refusedWords(join(f, "Ada", s.id))).toEqual(["You can sign up for classes up to 14 days ahead. Thursday, Nov 12 opens Thursday, Oct 29 at midnight."]);
      expect(await refusedCodes(join(f, "Ada", s.id, new Date("2026-10-29T06:59:00Z")))).toEqual(["not_open_yet"]);
      expect(await refusedCodes(join(f, "Ada", s.id, new Date("2026-10-29T07:00:00Z")))).toEqual([]);
    });

    it("closes 30 minutes before the start: one minute earlier is fine, the exact moment is refused", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      expect(await refusedCodes(join(f, "Ada", s.id, at(1, 8, 29)))).toEqual([]);
      expect(await refusedWords(join(f, "Dee", s.id, at(1, 8, 30)))).toEqual(["Sign-up for Yoga closed 30 minutes before it starts."]);
    });
  });

  describe("chairs and the waiting list", () => {
    it("fills the chairs, then the waiting list in order, saying each place", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const extra = await addMembers(f, 4);
      const results = [];
      for (const who of [f.m.Ada, f.m.Ben, f.m.Cy, ...extra]) results.push(await join(f, who, s.id));
      expect(results.map((r) => [r.outcome, r.place])).toEqual([["enrolled", null], ["enrolled", null], ["enrolled", null], ["waitlisted", 1], ["waitlisted", 2], ["waitlisted", 3], ["waitlisted", 4]]);
      expect(sessionView(await f.store.read(), s, { kind: "member", memberId: extra[1] })).toMatchObject({ enrolled: 3, waiting: 4, full: true, yours: { status: "waitlisted", place: 2 } });
    });

    it("refuses when the waiting list is full too, and when there is no waiting list at all", async () => {
      const { f, yoga } = await classClub(kind);
      const noList = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Spin", defaultCapacity: 1, defaultMinutes: 45, roomItemId: f.i["Clubhouse room"], rules: { waitlistMax: 0 } });
      const [s] = await schedule(f, { classId: noList.id, startsAt: at(1, 9) });
      await join(f, "Ada", s.id);
      expect(await refusedWords(join(f, "Dee", s.id))).toEqual(["Spin is full, and it has no waiting list."]);

      const [full] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9), capacity: 1 });
      const people = await addMembers(f, 11);
      await join(f, "Ada", full.id);
      for (const id of people.slice(0, 10)) await join(f, id, full.id);
      expect(await refusedWords(join(f, people[10], full.id))).toEqual(["Yoga is full, and its waiting list is full too (10 people)."]);
    });

    it("moves the first person waiting into a freed chair at once, in order, and tells who moved", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 2 });
      const [ada, ben, cy, dee] = [f.m.Ada, f.m.Ben, f.m.Cy, f.m.Dee];
      const a = await join(f, ada, s.id);
      await join(f, ben, s.id);
      await join(f, cy, s.id);
      await join(f, dee, s.id);
      const left = await leave(f, ada, a.signUp.id);
      expect(left.promoted.map((p) => p.memberId)).toEqual([cy]);
      expect(left.promoted[0]).toMatchObject({ status: "enrolled", promotedAt: NOW.toISOString() });
      expect(await statuses(f, s.id)).toEqual({ [ada]: "cancelled", [ben]: "enrolled", [cy]: "enrolled", [dee]: "waitlisted" });
      // Dee is now first in line.
      expect(sessionView(await f.store.read(), s, { kind: "member", memberId: dee }).yours).toMatchObject({ place: 1 });
    });

    it("leaves the line alone when someone waiting steps out, and moves people behind them up", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      const ben = await join(f, "Ben", s.id);
      await join(f, "Cy", s.id);
      const out = await leave(f, "Ben", ben.signUp.id);
      expect(out.promoted).toEqual([]);
      expect(out.late).toBe(false);
      expect(sessionView(await f.store.read(), s, { kind: "member", memberId: f.m.Cy }).yours).toMatchObject({ status: "waitlisted", place: 1 });
    });

    it("sends someone who leaves and comes back to the end of the line", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      const ben = await join(f, "Ben", s.id);
      await join(f, "Cy", s.id);
      await leave(f, "Ben", ben.signUp.id);
      const again = await join(f, "Ben", s.id);
      expect(again).toMatchObject({ outcome: "waitlisted", place: 2 });
      expect((await lineOf(f, "Ben", s.id)).map((g) => g.status)).toEqual(["cancelled", "waitlisted"]);
    });

    it("stops moving the line up 2 hours before the start; after that a free chair goes to whoever asks first", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const ada = await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      // The move-up ended at 7:00 am, two hours before the 9:00 start. Ada leaves at 7:01.
      const late = await leave(f, "Ada", ada.signUp.id, at(1, 7, 1));
      expect(late.promoted).toEqual([]);
      expect(await statuses(f, s.id)).toEqual({ [f.m.Ada]: "late_cancelled", [f.m.Ben]: "waitlisted" });
      // A newcomer takes the free chair, ahead of Ben.
      const dee = await join(f, "Dee", s.id, at(1, 7, 5));
      expect(dee).toMatchObject({ outcome: "enrolled" });
      expect((await statuses(f, s.id))[f.m.Ben]).toBe("waitlisted");
    });

    it("still moves the line up at 6:59 am, the last minute before the cutoff", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const ada = await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      const left = await leave(f, "Ada", ada.signUp.id, at(1, 6, 59));
      expect(left.promoted.map((p) => p.memberId)).toEqual([f.m.Ben]);
    });

    it("lets someone already waiting take a chair that is free after the cutoff", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const ada = await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      await leave(f, "Ada", ada.signUp.id, at(1, 7, 30));
      expect(await refusedCodes(join(f, "Ben", s.id, at(1, 7, 31)))).toEqual([]);
      expect(await lineOf(f, "Ben", s.id)).toHaveLength(1);
      expect((await lineOf(f, "Ben", s.id))[0]).toMatchObject({ status: "enrolled", promotedAt: at(1, 7, 31).toISOString() });
    });

    it("tells someone waiting that they are already waiting when no chair is free", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      expect(await refusedCodes(join(f, "Ben", s.id, at(1, 7, 31)))).toEqual(["already_signed_up"]);
    });
  });

  describe("leaving late", () => {
    it("records a late cancellation only for someone with a chair who leaves less than 2 hours before the start", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const ada = await join(f, "Ada", s.id);
      const ben = await join(f, "Ben", s.id);
      const cy = await join(f, "Cy", s.id);
      // Exactly at the cutoff is still on time; a minute later is late.
      expect((await leave(f, "Ada", ada.signUp.id, at(1, 7))).late).toBe(false);
      expect((await leave(f, "Ben", ben.signUp.id, at(1, 7, 1))).late).toBe(true);
      const state = await f.store.read();
      expect(state.signups.find((g) => g.id === ada.signUp.id)?.status).toBe("cancelled");
      expect(state.signups.find((g) => g.id === ben.signUp.id)).toMatchObject({ status: "late_cancelled", cancelledBy: { kind: "member" } });
      expect(state.signups.find((g) => g.id === cy.signUp.id)?.status).toBe("enrolled");
    });

    it("never counts leaving a waiting list as late, and never counts staff cancelling as the member's", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      const ben = await join(f, "Ben", s.id);
      expect((await leave(f, "Ben", ben.signUp.id, at(1, 8))).late).toBe(false);
      const ada = (await lineOf(f, "Ada", s.id))[0];
      const byStaff = await leaveClass(f.store, CLASS_RULES, staffCtx(at(1, 8)), ada.id, { reason: "Asked at the desk" });
      expect(byStaff).toMatchObject({ late: false, signUp: { status: "cancelled", cancelReason: "Asked at the desk" } });
    });

    it("keeps people from cancelling someone else's sign-up, a finished one, or one for a class that has begun", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const ada = await join(f, "Ada", s.id);
      await expect(leave(f, "Ben", ada.signUp.id)).rejects.toMatchObject({ code: "forbidden" });
      await expect(leave(f, "Ada", ada.signUp.id, at(1, 9, 1))).rejects.toThrow("That class has already started, so it cannot be cancelled here. Ask club staff.");
      await leave(f, "Ada", ada.signUp.id);
      await expect(leave(f, "Ada", ada.signUp.id)).rejects.toThrow("That sign-up is already cancelled.");
    });
  });

  describe("limits", () => {
    it("allows one class a day: a second the same day is refused, another day is fine", async () => {
      const { f, yoga } = await classClub(kind);
      const [morning] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const [noon] = await schedule(f, { classId: yoga.id, startsAt: at(1, 12) });
      const [nextDay] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9) });
      await join(f, "Ada", morning.id);
      expect(await refusedWords(join(f, "Ada", noon.id))).toEqual(["You can sign up for 1 class a day, and you already have one on Thursday, Oct 29."]);
      expect(await refusedCodes(join(f, "Ada", nextDay.id))).toEqual([]);
      // Someone else is unaffected.
      expect(await refusedCodes(join(f, "Ben", noon.id))).toEqual([]);
    });

    it("counts a waiting-list place toward the limits, and frees it when the person leaves", async () => {
      const { f, yoga } = await classClub(kind);
      const [full] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const [noon] = await schedule(f, { classId: yoga.id, startsAt: at(1, 12) });
      await join(f, "Ada", full.id);
      const ben = await join(f, "Ben", full.id);
      expect(await refusedCodes(join(f, "Ben", noon.id))).toEqual(["over_daily_limit"]);
      await leave(f, "Ben", ben.signUp.id);
      expect(await refusedCodes(join(f, "Ben", noon.id))).toEqual([]);
    });

    it("holds at most 5 upcoming places at once, counted again exactly after each leave, over many rounds", async () => {
      const { f, yoga } = await classClub(kind);
      const days = [];
      for (let d = 1; d <= 7; d++) days.push((await schedule(f, { classId: yoga.id, startsAt: at(d, 9) }))[0]);
      const held = [];
      for (const s of days.slice(0, 5)) held.push(await join(f, "Ada", s.id));
      expect(await refusedWords(join(f, "Ada", days[5].id))).toEqual(["You already hold 5 class places (chairs and waiting-list spots), the most allowed at once. Leave one or wait until a class is done."]);
      for (let round = 0; round < 6; round++) {
        // Leave the oldest place, take a different day, and the limit is exactly full again.
        await leave(f, "Ada", held.shift()!.signUp.id);
        held.push(await join(f, "Ada", days[(round + 5) % 7].id));
        expect(await refusedCodes(join(f, "Ada", days[(round + 6) % 7].id))).toEqual(["over_upcoming_limit"]);
      }
      const live = (await f.store.read()).signups.filter((g) => g.memberId === f.m.Ada && g.status === "enrolled");
      expect(live).toHaveLength(5);
    });

    it("lets one class set its own limits", async () => {
      const { f } = await classClub(kind);
      const camp = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Bootcamp", defaultCapacity: 10, defaultMinutes: 45, roomItemId: f.i["Clubhouse room"], rules: { closeMinutesBefore: 120 } });
      const [s] = await schedule(f, { classId: camp.id, startsAt: at(1, 9) });
      expect(await refusedWords(join(f, "Ada", s.id, at(1, 7, 30)))).toEqual(["Sign-up for Bootcamp closed 2 hours before it starts."]);
      expect(await refusedCodes(join(f, "Ada", s.id, at(1, 6, 59)))).toEqual([]);
    });
  });

  describe("one place at a time", () => {
    // Stretch allows two classes a day, so the only thing that can refuse these sign-ups is the clash itself.
    const stretchIn = (f: Fixture) => createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Stretch", defaultCapacity: 8, defaultMinutes: 60, roomItemId: f.i["Clubhouse room"], rules: { maxPerDayPerMember: 2 } });

    it("keeps a person out of two overlapping classes, whether they hold a chair or only wait", async () => {
      const { f, yoga } = await classClub(kind);
      const stretch = await stretchIn(f);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const [overlap] = await schedule(f, { classId: stretch.id, startsAt: at(1, 9, 30) });
      await join(f, "Ada", y.id);
      await join(f, "Ben", y.id); // only waiting
      expect(await refusedWords(join(f, "Ada", overlap.id))).toEqual(["You are already signed up for Yoga from 9:00 to 10:00 am."]);
      expect(await refusedWords(join(f, "Ben", overlap.id))).toEqual(["You are already on the waiting list for Yoga from 9:00 to 10:00 am."]);
      expect(await refusedCodes(join(f, "Dee", overlap.id))).toEqual([]);
    });

    it("lets classes sit back to back", async () => {
      const { f, yoga } = await classClub(kind);
      const stretch = await stretchIn(f);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const [next] = await schedule(f, { classId: stretch.id, startsAt: at(1, 10) });
      await join(f, "Ada", y.id);
      expect(await refusedCodes(join(f, "Ada", next.id))).toEqual([]);
    });

    it("frees the time when a class is cancelled or the person leaves it", async () => {
      const { f, yoga } = await classClub(kind);
      const stretch = await stretchIn(f);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const [overlap] = await schedule(f, { classId: stretch.id, startsAt: at(1, 9, 30) });
      const ada = await join(f, "Ada", y.id);
      await join(f, "Ben", y.id);
      expect(await refusedCodes(join(f, "Ada", overlap.id))).toEqual(["person_busy"]);
      await leave(f, "Ada", ada.signUp.id);
      expect(await refusedCodes(join(f, "Ada", overlap.id))).toEqual([]);
      expect(await refusedCodes(join(f, "Ben", overlap.id))).toEqual(["person_busy"]);
      await cancelSession(f.store, staffCtx(), y.id, { reason: "Instructor is ill" });
      expect(await refusedCodes(join(f, "Ben", overlap.id))).toEqual([]);
    });

    it("refuses a class to someone whose boat is booked then, as booker or as crew, and a boat to someone in a class", async () => {
      const { f, yoga } = await classClub(kind);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      await bookAs(f, "Ada", "Heron", at(1, 9, 30), at(1, 10, 30));
      await bookAs(f, "Eli", "Loon", at(1, 9, 30), at(1, 10), ["Ben"]);
      expect(await refusedWords(join(f, "Ada", y.id))).toEqual(["You have Heron booked from 9:30 to 10:30 am."]);
      expect(await refusedWords(join(f, "Ben", y.id))).toEqual(["You have Loon booked from 9:30 to 10:00 am."]);
      // Dee takes the class, so her boat is refused for the same hour; a boat after the class is fine.
      await join(f, "Dee", y.id);
      expect(await refusalMessages(bookAs(f, "Dee", "Osprey", at(1, 9, 30), at(1, 10, 30)))).toEqual(["You are signed up for Yoga from 9:00 to 10:00 am."]);
      expect(await refusedFor(bookAs(f, "Dee", "Osprey", at(1, 10), at(1, 11)))).toEqual([]);
    });

    it("keeps a classmate off a boat as crew too, and a waiting place counts as a class", async () => {
      const { f, yoga } = await classClub(kind);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", y.id);
      await join(f, "Ben", y.id); // only waiting
      expect(await refusalMessages(bookAs(f, "Eli", "Loon", at(1, 9), at(1, 10), ["Ben"]))).toEqual(["Ben Quill is on the waiting list for Yoga from 9:00 to 10:00 am."]);
    });

    it("lets a boat be booked again once the person leaves the class", async () => {
      const { f, yoga } = await classClub(kind);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const ada = await join(f, "Ada", y.id);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 9), at(1, 10)))).toEqual(["in_class"]);
      await leave(f, "Ada", ada.signUp.id);
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 9), at(1, 10)))).toEqual([]);
    });
  });

  describe("the room a class holds", () => {
    it("keeps members from booking the gym while a class is in it, even for staff overriding the rules", async () => {
      const { f, yoga } = await classClub(kind);
      const [y] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      expect(await refusalMessages(bookAs(f, "Ada", "Boathouse gym", at(1, 9, 30), at(1, 10)))).toEqual(["Boathouse gym is being used for Yoga from 9:00 to 10:00 am."]);
      await expect(
        createBooking(f.store, f.book, staffCtx(), request(f, "Ada", "Boathouse gym", at(1, 9, 30), at(1, 10)), { override: { reason: "Please" } }),
      ).rejects.toBeInstanceOf(BookingRefused);
      // Before and after are free, and so is another room.
      expect(await refusedFor(bookAs(f, "Ada", "Boathouse gym", at(1, 8, 30), at(1, 9)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Ben", "Boathouse gym", at(1, 10), at(1, 10, 30)))).toEqual([]);
      expect(await refusedFor(bookAs(f, "Cy", "Clubhouse room", at(1, 9, 30), at(1, 10)))).toEqual([]);
      await cancelSession(f.store, staffCtx(), y.id, { reason: "Instructor is ill" });
      expect(await refusedFor(bookAs(f, "Dee", "Boathouse gym", at(1, 9, 30), at(1, 10)))).toEqual([]);
    });
  });

  describe("cancelling a session", () => {
    it("takes everyone off, not as late cancellations, and lists them for staff to contact", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      const { affected, session } = await cancelSession(f.store, staffCtx(at(1, 8)), s.id, { reason: "Instructor is ill" });
      expect(session).toMatchObject({ status: "cancelled", cancelReason: "Instructor is ill", cancelledBy: { kind: "staff" } });
      expect(affected.map((a) => [a.name, a.status, a.email])).toEqual([["Ada Quill", "enrolled", "ada@example.com"], ["Ben Quill", "waitlisted", "ben@example.com"]]);
      expect(await statuses(f, s.id)).toEqual({ [f.m.Ada]: "cancelled", [f.m.Ben]: "cancelled" });
      expect((await f.store.read()).signups.every((g) => g.status === "cancelled" && g.cancelReason === "The class was cancelled: Instructor is ill")).toBe(true);
    });

    it("frees the time for other classes and boats, and cannot be done twice or after the start", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const ada = await join(f, "Ada", s.id);
      await cancelSession(f.store, staffCtx(), s.id, { reason: "Instructor is ill" });
      expect(await refusedFor(bookAs(f, "Ada", "Heron", at(1, 9), at(1, 10)))).toEqual([]);
      await expect(cancelSession(f.store, staffCtx(), s.id, { reason: "again" })).rejects.toThrow("That class is already cancelled.");
      await expect(leave(f, "Ada", ada.signUp.id)).rejects.toThrow(/already cancelled/);
      const [t] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9) });
      await expect(cancelSession(f.store, staffCtx(at(2, 9, 1)), t.id, { reason: "late" })).rejects.toThrow("That class has already started, so it cannot be cancelled.");
      await expect(cancelSession(f.store, staffCtx(), t.id, { reason: "  " })).rejects.toThrow("Say why the class is cancelled; members will see the reason.");
      // The room is free for a new class at the same time.
      await expect(schedule(f, { classId: yoga.id, startsAt: at(1, 9) })).resolves.toHaveLength(1);
    });
  });

  describe("changing the number of chairs", () => {
    it("moves the waiting list up when chairs are added, in order", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      await join(f, "Cy", s.id);
      await join(f, "Dee", s.id);
      const { promoted, session } = await setCapacity(f.store, CLASS_RULES, staffCtx(), s.id, 3);
      expect(session.capacity).toBe(3);
      expect(promoted.map((p) => p.memberId)).toEqual([f.m.Ben, f.m.Cy]);
      expect(await statuses(f, s.id)).toEqual({ [f.m.Ada]: "enrolled", [f.m.Ben]: "enrolled", [f.m.Cy]: "enrolled", [f.m.Dee]: "waitlisted" });
    });

    it("refuses fewer chairs than people in them, and a class that was cancelled or is over", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      await expect(setCapacity(f.store, CLASS_RULES, staffCtx(), s.id, 1)).rejects.toThrow("2 people already have chairs, so chairs cannot go below 2. Cancel some sign-ups first.");
      await expect(setCapacity(f.store, CLASS_RULES, staffCtx(), s.id, 0)).rejects.toThrow("Chairs must be a whole number from 1 to 200.");
      await expect(setCapacity(f.store, CLASS_RULES, staffCtx(at(1, 10, 5)), s.id, 5)).rejects.toThrow("That class is over, so its chairs cannot change.");
      await cancelSession(f.store, staffCtx(), s.id, { reason: "Instructor is ill" });
      await expect(setCapacity(f.store, CLASS_RULES, staffCtx(), s.id, 5)).rejects.toThrow("That class was cancelled, so its chairs cannot change.");
    });
  });

  describe("attendance", () => {
    it("lets staff mark a chair as attended or a no-show once the class has started, and nobody else", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const ada = await join(f, "Ada", s.id);
      const ben = await join(f, "Ben", s.id);
      await expect(mark(f.store, staffCtx(at(1, 8)), "class", ada.signUp.id, "attended")).rejects.toThrow("opens at 8:30 am, 30 minutes before the start");
      await expect(mark(f.store, staffCtx(at(1, 8, 45)), "class", ada.signUp.id, "no_show")).rejects.toThrow("has not started yet, so it cannot be a no-show");
      await expect(mark(f.store, memberCtx(f.m.Ada, "Ada", at(1, 9, 30)), "class", ada.signUp.id, "attended")).rejects.toMatchObject({ code: "forbidden" });
      await expect(mark(f.store, staffCtx(at(1, 9, 30)), "class", ben.signUp.id, "attended")).rejects.toThrow(/waiting list without a chair/);
      expect(await mark(f.store, staffCtx(at(1, 9, 30)), "class", ada.signUp.id, "attended")).toMatchObject({ outcome: "attended", previous: null, via: "staff" });
      expect((await f.store.read()).signups.find((g) => g.id === ada.signUp.id)!.status).toBe("attended");
      // A mistake can be put right, and the correction is a new line, not an erased one.
      expect(await mark(f.store, staffCtx(at(1, 9, 31)), "class", ada.signUp.id, "no_show")).toMatchObject({ outcome: "no_show", previous: "attended" });
      expect((await f.store.read()).signups.find((g) => g.id === ada.signUp.id)!.status).toBe("no_show");
      await expect(mark(f.store, staffCtx(at(1, 9, 32)), "class", ada.signUp.id, "no_show")).rejects.toThrow("already recorded as a no-show");
    });
  });

  describe("when a household leaves", () => {
    it("takes every adult off future classes, chairs and waiting lists, moves the lines up behind them, and logs it", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 2 });
      const [t] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9), capacity: 1 });
      await join(f, "Ada", s.id);
      await join(f, "Ben", s.id);
      await join(f, "Dee", s.id); // waiting
      await join(f, "Eli", s.id); // waiting
      await join(f, "Cy", t.id);
      await join(f, "Dee", t.id); // waiting
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Quill);
      expect(await statuses(f, s.id)).toEqual({ [f.m.Ada]: "cancelled", [f.m.Ben]: "cancelled", [f.m.Dee]: "enrolled", [f.m.Eli]: "enrolled" });
      expect(await statuses(f, t.id)).toEqual({ [f.m.Cy]: "cancelled", [f.m.Dee]: "enrolled" });
      const state = await f.store.read();
      expect(state.signups.filter((g) => g.status === "cancelled").every((g) => g.cancelReason === "The household's membership ended" && g.cancelledBy?.kind === "staff")).toBe(true);
      expect(state.signups.find((g) => g.memberId === f.m.Dee && g.sessionId === s.id)?.promotedAt).toBe(NOW.toISOString());
      expect(historyOf(state, f.h.Quill).find((e) => e.kind === "signups_cancelled")).toMatchObject({ summary: "3 future class sign-ups cancelled because the membership ended.", details: { count: 3 } });
    });

    it("leaves classes already under way and past ones exactly as they were", async () => {
      const { f, yoga } = await classClub(kind);
      const [past] = await schedule(f, { classId: yoga.id, startsAt: at(-2, 9) }, at(-5, 12));
      const [underWay] = await schedule(f, { classId: yoga.id, startsAt: at(0, 12) }, at(-1, 12));
      await join(f, "Ada", past.id, at(-3, 9));
      await join(f, "Ada", underWay.id, at(0, 9));
      await mark(f.store, staffCtx(at(-2, 10)), "class", (await lineOf(f, "Ada", past.id))[0].id, "attended");
      const before = (await f.store.read()).signups;
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Quill);
      expect((await f.store.read()).signups).toEqual(before);
      expect((await f.store.read()).history.some((e) => e.kind === "signups_cancelled")).toBe(false);
    });

    it("does the same for one adult who is removed, and leaves the rest of the household on their classes", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      await join(f, "Ben", s.id);
      await join(f, "Dee", s.id);
      const [u] = await schedule(f, { classId: yoga.id, startsAt: at(2, 9) });
      await join(f, "Ada", u.id);
      await removeMember(f.store, clubLedger, staffCtx(), f.m.Ben);
      expect(await statuses(f, s.id)).toEqual({ [f.m.Ben]: "cancelled", [f.m.Dee]: "enrolled" });
      expect(await statuses(f, u.id)).toEqual({ [f.m.Ada]: "enrolled" });
      expect(historyOf(await f.store.read(), f.h.Quill).find((e) => e.kind === "signups_cancelled")).toMatchObject({ summary: "1 future class sign-up cancelled for Ben Quill." });
    });

    it("changes nothing if anything fails: the household is not half ended", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      await join(f, "Ada", s.id);
      const before = await f.store.read();
      const broken = { ...clubLedger, cancelFutureSignUps: async () => { throw new Error("boom"); } };
      await expect(endHousehold(f.store, broken, staffCtx(), f.h.Quill)).rejects.toThrow("boom");
      expect(await f.store.read()).toEqual(before);
    });
  });

  describe("many people at once", () => {
    it("gives exactly the chairs and the waiting places to 20 members signing up at the same moment, and refuses the rest in words", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9) });
      const people = await addMembers(f, 20);
      const results = await Promise.allSettled(people.map((id) => join(f, id, s.id)));
      const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof join>>> => r.status === "fulfilled").map((r) => r.value);
      expect(ok.filter((r) => r.outcome === "enrolled")).toHaveLength(3);
      expect(ok.filter((r) => r.outcome === "waitlisted")).toHaveLength(10);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
      for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ reasons: [{ code: "waitlist_full" }] });
      expect(ok.filter((r) => r.outcome === "waitlisted").map((r) => r.place).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const state = await f.store.read();
      expect(state.signups.filter((g) => g.status === "enrolled")).toHaveLength(3);
      expect(new Set(state.signups.map((g) => g.memberId)).size).toBe(state.signups.length);
    }, 60000);

    it("keeps the count right through many rounds of everyone joining and leaving", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(1, 9), capacity: 2 });
      const people = await addMembers(f, 6);
      for (let round = 0; round < 4; round++) {
        for (const id of people) await join(f, id, s.id);
        const mid = await f.store.read();
        expect(mid.signups.filter((g) => g.status === "enrolled")).toHaveLength(2);
        expect(mid.signups.filter((g) => g.status === "waitlisted")).toHaveLength(4);
        for (const g of (await f.store.read()).signups.filter((x) => x.status === "enrolled" || x.status === "waitlisted")) await leave(f, g.memberId, g.id);
        expect((await f.store.read()).signups.filter((g) => g.status === "enrolled" || g.status === "waitlisted")).toHaveLength(0);
      }
      // 4 rounds of 6 people, none ever double counted.
      expect((await f.store.read()).signups).toHaveLength(24);
    }, 60000);
  });

  describe("explaining", () => {
    it("checkSignUp lists every reason at once without signing anyone up", async () => {
      const { f, yoga } = await classClub(kind);
      const [s] = await schedule(f, { classId: yoga.id, startsAt: at(15, 9) });
      const state = await f.store.read();
      const reasons = checkSignUp(state, f.book, CLASS_RULES, memberCtx(f.m.Ada, "Ada"), { sessionId: s.id, memberId: f.m.Ada });
      expect(reasons.map((r) => r.code)).toEqual(["not_open_yet"]);
      expect((await f.store.read()).signups).toHaveLength(0);
    });
  });
});
