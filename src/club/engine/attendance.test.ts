import { describe, expect, it } from "vitest";
import { CLASS_RULES } from "../settings/class-rules";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { MemoryClubStore } from "../store/memory";
import type { AttendanceRules, ClubState } from "../types";
import { aroundNow, attendanceSettler, checkInNeeded, describeAttendanceRules, needsALook, recordAttendance, reservationsFor, rowFor, settleAttendance } from "./attendance";
import { cancelBooking } from "./bookings";
import { createClass, scheduleSessions, signUp } from "./classes";
import { createEvent, rsvp } from "./events";
import { NOW, STORE_KINDS, at, bookAs, buildFixtureSettling, databaseUrls, mark, memberCtx, openAnother, staffCtx, type Fixture } from "./testkit";

/**
 * Check-ins and the automatic no-show, on both stores. Today is Wed Oct 28, 1 pm Pacific. With the placeholder rules,
 * check-in opens 30 minutes before the start and a booking or chair nobody checked in for becomes a no-show the moment it ends.
 */

const rulesWith = (change: Partial<AttendanceRules["defaults"]>): AttendanceRules => ({ placeholder: true, defaults: { ...ATTENDANCE_RULES.defaults, ...change } });

/** The club with a moving clock: `clock.now` is "now" for the store's automatic no-show. */
async function club(kind: (typeof STORE_KINDS)[number]) {
  const clock = { now: NOW };
  const f = await buildFixtureSettling(kind, () => clock.now);
  await f.store.transaction(async (s, newId) => {
    const id = newId();
    s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
    f.i["Boathouse gym"] = id;
  });
  const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 3, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
  return { f, clock, yoga };
}

const booking = (f: Fixture, who: string, item: string, day: number, from: number, to: number, crew: string[] = []) => bookAs(f, who, item, at(day, from), at(day, to), crew);
const joinClass = (f: Fixture, who: string, sessionId: string, now: Date = NOW) => signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who, now), { sessionId, memberId: f.m[who] });
const statusOfBooking = async (f: Fixture, id: string) => (await f.store.read()).bookings.find((b) => b.id === id)!.status;

describe.each(STORE_KINDS)("check-ins and the automatic no-show on the %s store", (kind) => {
  describe("a boat or space booking nobody checked in for", () => {
    it("becomes a no-show the moment it ends, written as the system, with the moment it came due", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      clock.now = at(1, 7, 59);
      expect(await statusOfBooking(f, b.id)).toBe("upcoming");
      clock.now = at(1, 8);
      const state = await f.store.read();
      expect(state.bookings.find((x) => x.id === b.id)).toMatchObject({ status: "no_show", statusChangedAt: at(1, 8).toISOString() });
      expect(state.attendance).toHaveLength(1);
      expect(state.attendance[0]).toMatchObject({ kind: "booking", recordId: b.id, memberId: f.m.Ada, at: at(1, 8).toISOString(), outcome: "no_show", previous: null, via: "automatic", by: { kind: "system" }, note: null });
    });

    it("is only shown by looking, and saved by the next change; a change that fails saves nothing", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      // Looking at 9 am shows the no-show but saves nothing: back at 7 am it is still upcoming.
      clock.now = at(1, 9);
      expect(await statusOfBooking(f, b.id)).toBe("no_show");
      clock.now = at(1, 7, 30);
      expect(await statusOfBooking(f, b.id)).toBe("upcoming");
      // A change that fails is undone, including the no-show that came with it.
      clock.now = at(1, 9);
      await expect(f.store.transaction(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
      clock.now = at(1, 7, 30);
      expect(await statusOfBooking(f, b.id)).toBe("upcoming");
      // A change that works saves it: with the clock set back, the no-show is still there, once.
      clock.now = at(1, 9);
      await f.store.transaction(async () => undefined);
      clock.now = at(1, 7, 30);
      const state = await f.store.read();
      expect(state.bookings.find((x) => x.id === b.id)!.status).toBe("no_show");
      expect(state.attendance).toHaveLength(1);
      // And it is not written a second time by later changes.
      clock.now = at(2, 9);
      await f.store.transaction(async () => undefined);
      await f.store.transaction(async () => undefined);
      expect((await f.store.read()).attendance).toHaveLength(1);
    });

    it("is not marked when it was checked in, cancelled, or is still running", async () => {
      const { f, clock } = await club(kind);
      const came = (await booking(f, "Ada", "Heron", 1, 7, 8)).booking;
      const gone = (await booking(f, "Dee", "Osprey", 1, 7, 8)).booking;
      const running = (await booking(f, "Eli", "Kingfisher", 1, 7, 9)).booking;
      await cancelBooking(f.store, f.book, memberCtx(f.m.Dee), gone.id);
      await mark(f.store, staffCtx(at(1, 7, 10)), "booking", came.id, "attended");
      clock.now = at(1, 8, 30);
      const state = await f.store.read();
      const status = Object.fromEntries(state.bookings.map((b) => [b.id, b.status]));
      expect(status).toEqual({ [came.id]: "completed", [gone.id]: "cancelled", [running.id]: "upcoming" });
      expect(state.attendance.map((l) => [l.recordId, l.via])).toEqual([[came.id, "staff"]]);
    });

    it("applies to every kind of booking, not just boats", async () => {
      const { f, clock } = await club(kind);
      const dock = (await booking(f, "Ada", "Dock slip A", 1, 7, 8)).booking;
      const kayak = (await booking(f, "Dee", "Otter", 1, 7, 8)).booking;
      clock.now = at(1, 8);
      const state = await f.store.read();
      expect(state.bookings.filter((b) => [dock.id, kayak.id].includes(b.id)).map((b) => b.status)).toEqual(["no_show", "no_show"]);
    });
  });

  describe("a kind of booking that needs no check-in", () => {
    it("is never marked a no-show, is refused a check-in, and stays off every staff list", async () => {
      const { f, clock } = await club(kind);
      await f.store.transaction(async (s, newId) => {
        const id = newId();
        s.items.push({ id, name: "Clubhouse room", classCode: "room-space", ruleOverrides: {} });
        f.i["Clubhouse room"] = id;
      });
      const room = (await booking(f, "Ada", "Clubhouse room", 1, 9, 10)).booking;
      const boat = (await booking(f, "Dee", "Heron", 1, 9, 10)).booking;
      clock.now = at(1, 12);
      const state = await f.store.read();
      // The boat nobody checked in for is a no-show; the room booking is simply over.
      expect(state.bookings.find((b) => b.id === boat.id)!.status).toBe("no_show");
      expect(state.bookings.find((b) => b.id === room.id)).toMatchObject({ status: "upcoming", statusChangedAt: room.statusChangedAt });
      expect(state.attendance.map((l) => l.recordId)).toEqual([boat.id]);
      expect(checkInNeeded(state, room, ATTENDANCE_RULES)).toBe(false);
      expect(checkInNeeded(state, boat, ATTENDANCE_RULES)).toBe(true);
      // Staff cannot check it in or mark it, and it is on none of their lists.
      await expect(mark(f.store, staffCtx(clock.now), "booking", room.id, "attended")).rejects.toThrow("Room Space reservations do not need a check-in.");
      await expect(mark(f.store, staffCtx(clock.now), "booking", room.id, "no_show")).rejects.toThrow("do not need a check-in");
      expect(rowFor(state, "booking", room.id, clock.now, ATTENDANCE_RULES)).toBeNull();
      expect(needsALook(state, clock.now, ATTENDANCE_RULES).map((r) => r.id)).toEqual([boat.id]);
      expect(reservationsFor(state, f.m.Ada, clock.now, ATTENDANCE_RULES, { hoursBack: 48 })).toEqual([]);
      expect(aroundNow(state, clock.now, ATTENDANCE_RULES, 6).map((r) => r.id)).toEqual([boat.id]);
    });
  });

  describe("a class chair nobody checked in for", () => {
    it("becomes a no-show when the class ends; a waiting place and a cancelled class are left alone", async () => {
      const { f, clock, yoga } = await club(kind);
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9), capacity: 1 });
      const [cancelled] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 9), capacity: 1 });
      const chair = (await joinClass(f, "Ada", session.id)).signUp;
      const waiting = (await joinClass(f, "Ben", session.id)).signUp;
      await joinClass(f, "Cy", cancelled.id);
      const { cancelSession } = await import("./classes");
      await cancelSession(f.store, staffCtx(), cancelled.id, { reason: "Instructor ill" });
      clock.now = at(1, 9, 59);
      expect((await f.store.read()).signups.find((g) => g.id === chair.id)!.status).toBe("enrolled");
      clock.now = at(1, 10);
      const state = await f.store.read();
      expect(state.signups.find((g) => g.id === chair.id)).toMatchObject({ status: "no_show", statusChangedAt: at(1, 10).toISOString() });
      expect(state.signups.find((g) => g.id === waiting.id)!.status).toBe("waitlisted");
      expect(state.signups.filter((g) => g.sessionId === cancelled.id).every((g) => g.status === "cancelled")).toBe(true);
      expect(state.attendance.map((l) => [l.kind, l.recordId, l.via])).toEqual([["class", chair.id, "automatic"]]);
    });
  });

  describe("an event", () => {
    it("is never marked automatically: staff mark who came", async () => {
      const { f, clock } = await club(kind);
      const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(1, 18), endsAt: at(1, 21) });
      const { rsvp: line } = await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: event.id, memberId: f.m.Ada, guests: 0 });
      clock.now = at(3, 9);
      const state = await f.store.read();
      expect(state.rsvps.find((r) => r.id === line.id)!.status).toBe("going");
      expect(state.attendance).toEqual([]);
      expect(await mark(f.store, staffCtx(at(3, 9)), "event", line.id, "attended")).toMatchObject({ kind: "event", outcome: "attended" });
    });
  });

  describe("staff putting it right", () => {
    it("turns an automatic no-show into checked in, and keeps both lines", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      clock.now = at(1, 9);
      expect(needsALook(await f.store.read(), clock.now, ATTENDANCE_RULES)).toHaveLength(1);
      const fix = await mark(f.store, staffCtx(clock.now), "booking", b.id, "attended", { note: "iPad was down" });
      expect(fix).toMatchObject({ outcome: "attended", previous: "no_show", via: "staff", by: { kind: "staff" }, note: "iPad was down" });
      const state = await f.store.read();
      expect(state.bookings.find((x) => x.id === b.id)).toMatchObject({ status: "completed", statusChangedAt: at(1, 9).toISOString() });
      expect(state.attendance.map((l) => [l.outcome, l.previous, l.via])).toEqual([["no_show", null, "automatic"], ["attended", "no_show", "staff"]]);
      expect(needsALook(state, clock.now, ATTENDANCE_RULES)).toEqual([]);
    });

    it("confirms an automatic no-show was right, which takes it off the to-do list; confirming twice is refused", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      clock.now = at(1, 9);
      const sure = await mark(f.store, staffCtx(clock.now), "booking", b.id, "no_show");
      expect(sure).toMatchObject({ outcome: "no_show", previous: "no_show", via: "staff" });
      const state = await f.store.read();
      expect(state.bookings.find((x) => x.id === b.id)!.status).toBe("no_show");
      expect(needsALook(state, clock.now, ATTENDANCE_RULES)).toEqual([]);
      await expect(mark(f.store, staffCtx(clock.now), "booking", b.id, "no_show")).rejects.toThrow("already recorded as a no-show");
    });

    it("works on a class chair the same way", async () => {
      const { f, clock, yoga } = await club(kind);
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 9) });
      const chair = (await joinClass(f, "Ada", session.id)).signUp;
      clock.now = at(1, 11);
      expect((await f.store.read()).signups.find((g) => g.id === chair.id)!.status).toBe("no_show");
      await mark(f.store, staffCtx(clock.now), "class", chair.id, "attended");
      expect((await f.store.read()).signups.find((g) => g.id === chair.id)!.status).toBe("attended");
    });

    it("lets staff check in a crew member, and refuses someone who is not on the outing", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Eli", "Loon", 1, 7, 8, ["Ben"]);
      await expect(mark(f.store, staffCtx(at(1, 7)), "booking", b.id, "attended", { memberId: f.m.Cy })).rejects.toThrow("not on this reservation");
      const line = await mark(f.store, staffCtx(at(1, 7)), "booking", b.id, "attended", { memberId: f.m.Ben });
      expect(line.memberId).toBe(f.m.Ben);
      expect(await statusOfBooking(f, b.id)).toBe("completed");
    });

    it("refuses a bad outcome or a note that is too long, in words", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      await expect(recordAttendance(f.store, staffCtx(at(1, 7)), ATTENDANCE_RULES, { kind: "booking", id: b.id, outcome: "late" as never })).rejects.toThrow("Choose checked in or no-show.");
      await expect(mark(f.store, staffCtx(at(1, 7)), "booking", b.id, "attended", { note: "x".repeat(301) })).rejects.toThrow("300 characters or fewer");
    });
  });

  describe("what staff see", () => {
    it("lists automatic no-shows from the last three days that nobody has looked at, newest first", async () => {
      const { f, clock } = await club(kind);
      const old = (await bookAs(f, "Ada", "Heron", at(-5, 7), at(-5, 8), [], undefined, at(-6, 12))).booking;
      const recent1 = (await bookAs(f, "Dee", "Osprey", at(-1, 7), at(-1, 8), [], undefined, at(-2, 12))).booking;
      const recent2 = (await bookAs(f, "Eli", "Kingfisher", at(-2, 9), at(-2, 10), [], undefined, at(-3, 12))).booking;
      const came = (await bookAs(f, "Ben", "Loon", at(-1, 9), at(-1, 10), [], undefined, at(-2, 12))).booking;
      await mark(f.store, staffCtx(at(-1, 9, 10)), "booking", came.id, "attended");
      clock.now = NOW;
      const rows = needsALook(await f.store.read(), NOW, ATTENDANCE_RULES);
      expect(rows.map((r) => r.id)).toEqual([recent1.id, recent2.id]);
      expect(rows.every((r) => r.automatic && r.outcome === "no_show")).toBe(true);
      expect(rows.map((r) => r.id)).not.toContain(old.id);
      expect(needsALook(await f.store.read(), NOW, ATTENDANCE_RULES, 7).map((r) => r.id)).toEqual([recent1.id, recent2.id, old.id]);
    });

    it("lists what one person is down for around now: outings, classes with a chair, events with spots", async () => {
      const { f, yoga } = await club(kind);
      const outing = (await booking(f, "Ada", "Heron", 0, 15, 16)).booking;
      const crewed = (await booking(f, "Eli", "Loon", 0, 17, 18, ["Ada"])).booking;
      const farOff = (await booking(f, "Ada", "Otter", 4, 7, 8)).booking;
      const cancelled = (await booking(f, "Ada", "Skimmer", 0, 19, 20)).booking;
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), cancelled.id);
      const [session] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(1, 8), capacity: 1 });
      await joinClass(f, "Ada", session.id);
      await joinClass(f, "Ben", session.id); // waiting: no chair
      const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(1, 12), endsAt: at(1, 14) });
      await rsvp(f.store, EVENT_RULES, memberCtx(f.m.Ada, "Ada"), { eventId: event.id, memberId: f.m.Ada, guests: 0 });
      const state = await f.store.read();

      const ada = reservationsFor(state, f.m.Ada, NOW, ATTENDANCE_RULES);
      expect(ada.map((r) => [r.kind, r.title])).toEqual([
        ["booking", "Heron"],
        ["booking", "Loon"],
        ["class", "Yoga"],
        ["event", "Dinner"],
      ]);
      expect(ada.find((r) => r.id === outing.id)).toMatchObject({ outcome: null, automatic: false, withNames: [], started: false, checkInOpen: false });
      expect(ada.find((r) => r.id === crewed.id)!.withNames).toEqual(["Eli Reed"]);
      expect(ada.map((r) => r.id)).not.toContain(farOff.id);
      // Ben only waits for a chair: nothing to check in. Cy has nothing at all.
      expect(reservationsFor(state, f.m.Ben, NOW, ATTENDANCE_RULES)).toEqual([]);
      expect(reservationsFor(state, f.m.Cy, NOW, ATTENDANCE_RULES)).toEqual([]);
      // Check-in opens 30 minutes before the start.
      expect(reservationsFor(state, f.m.Ada, at(0, 14, 29), ATTENDANCE_RULES).find((r) => r.id === outing.id)!.checkInOpen).toBe(false);
      expect(reservationsFor(state, f.m.Ada, at(0, 14, 30), ATTENDANCE_RULES).find((r) => r.id === outing.id)).toMatchObject({ checkInOpen: true, started: false });
      expect(reservationsFor(state, f.m.Ada, at(0, 15), ATTENDANCE_RULES).find((r) => r.id === outing.id)).toMatchObject({ checkInOpen: true, started: true });
    });

    it("gives one reservation's row, or nothing when it cannot be checked in", async () => {
      const { f } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      const state = await f.store.read();
      expect(rowFor(state, "booking", b.id, NOW, ATTENDANCE_RULES)).toMatchObject({ title: "Heron", memberId: f.m.Ada });
      expect(rowFor(state, "booking", "nope", NOW, ATTENDANCE_RULES)).toBeNull();
      await cancelBooking(f.store, f.book, memberCtx(f.m.Ada), b.id);
      expect(rowFor(await f.store.read(), "booking", b.id, NOW, ATTENDANCE_RULES)).toBeNull();
    });
  });

  describe("the record", () => {
    it("reads back exactly as written", async () => {
      const { f, clock } = await club(kind);
      const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
      clock.now = at(1, 9);
      await mark(f.store, staffCtx(at(1, 9, 5)), "booking", b.id, "attended", { note: "Forgot to tap" });
      const lines = (await f.store.read()).attendance;
      expect(lines).toEqual([
        { id: expect.any(String), kind: "booking", recordId: b.id, memberId: f.m.Ada, at: at(1, 8).toISOString(), outcome: "no_show", previous: null, by: { kind: "system", label: "Automatic no-show" }, via: "automatic", note: null },
        { id: expect.any(String), kind: "booking", recordId: b.id, memberId: f.m.Ada, at: at(1, 9, 5).toISOString(), outcome: "attended", previous: "no_show", by: { kind: "staff", label: "Test staff" }, via: "staff", note: "Forgot to tap" },
      ]);
    });
  });

  if (kind === "postgres") {
    describe("two app servers on one database", () => {
      it("write the automatic no-show once, not twice, when they notice it at the same moment", async () => {
        const { f, clock } = await club(kind);
        const { booking: b } = await booking(f, "Ada", "Heron", 1, 7, 8);
        const other = openAnother(databaseUrls.get(f.store)!, undefined, attendanceSettler(ATTENDANCE_RULES, () => clock.now));
        clock.now = at(1, 9);
        await Promise.all([f.store.transaction(async () => undefined), other.transaction(async () => undefined), f.store.transaction(async () => undefined), other.transaction(async () => undefined)]);
        const state = await f.store.read();
        expect(state.attendance.filter((l) => l.recordId === b.id)).toHaveLength(1);
        expect(state.bookings.find((x) => x.id === b.id)!.status).toBe("no_show");
      });
    });
  }
});

describe("the automatic no-show as a plain rule", () => {
  const state = async () => {
    const store = new MemoryClubStore();
    const f = await (await import("./testkit")).buildFixtureOn(store);
    await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    return store.read() as Promise<ClubState>;
  };
  const ids = () => {
    let n = 0;
    return () => `line-${++n}`;
  };

  it("waits out the grace minutes, then marks at the moment it came due", async () => {
    const rules = rulesWith({ noShowAfterEndMinutes: 15 });
    const s = await state();
    expect(settleAttendance(s, at(1, 8, 14), rules, ids())).toEqual([]);
    expect(s.bookings.at(-1)!.status).toBe("upcoming");
    const written = settleAttendance(s, at(1, 12), rules, ids());
    expect(written).toHaveLength(1);
    expect(written[0].at).toBe(at(1, 8, 15).toISOString());
    expect(s.bookings.at(-1)).toMatchObject({ status: "no_show", statusChangedAt: at(1, 8, 15).toISOString() });
  });

  it("leaves out whatever kind of booking the rules say needs no check-in, and marks it again if the rules change", async () => {
    const s = await state();
    expect(settleAttendance(structuredClone(s), at(1, 9), rulesWith({ checkInNotNeededFor: ["Shell"] }), ids())).toEqual([]);
    const marked = settleAttendance(s, at(1, 9), rulesWith({ checkInNotNeededFor: [] }), ids());
    expect(marked).toHaveLength(1);
  });

  it("does nothing the second time it runs", async () => {
    const s = await state();
    expect(settleAttendance(s, at(1, 9), ATTENDANCE_RULES, ids())).toHaveLength(1);
    expect(settleAttendance(s, at(1, 9), ATTENDANCE_RULES, ids())).toEqual([]);
    expect(s.attendance).toHaveLength(1);
  });

  it("is a store setting: a store without one never marks anything", async () => {
    const f = await (await import("./testkit")).buildFixtureOn(new MemoryClubStore());
    await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    expect((await f.store.read()).bookings.at(-1)!.status).toBe("upcoming");
  });

  it("describes itself in plain words for the staff screens", () => {
    expect(describeAttendanceRules(ATTENDANCE_RULES)).toEqual([
      "Check-in opens 30 minutes before the start.",
      "A boat or space booking, or a class chair, that nobody checked in for becomes a no-show the moment it ends.",
      "Room Space and Work Space reservations do not need a check-in: they are never marked a no-show.",
      "Members can check themselves in on the front-desk iPad or on their own phone while check-in is open; the record shows which. Events are not checked in by members.",
      "Events are not marked automatically; staff mark who came.",
      "Staff can correct any of these afterwards. The correction is added to the record; nothing is erased.",
    ]);
    // With nothing exempt, the line is left out; with three kinds it reads as a list.
    expect(describeAttendanceRules(rulesWith({ checkInNotNeededFor: [] })).join(" ")).not.toContain("do not need a check-in");
    expect(describeAttendanceRules(rulesWith({ checkInNotNeededFor: ["Room Space", "Work Space", "Dock Space"] }))[2]).toBe("Room Space, Work Space and Dock Space reservations do not need a check-in: they are never marked a no-show.");
    expect(describeAttendanceRules(rulesWith({ checkInOpensMinutesBefore: 0, noShowAfterEndMinutes: 90 })).slice(0, 2)).toEqual([
      "Check-in opens at the start.",
      "A boat or space booking, or a class chair, that nobody checked in for becomes a no-show 1 hour 30 minutes after it ends.",
    ]);
  });
});
