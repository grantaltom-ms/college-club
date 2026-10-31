import { describe, expect, it } from "vitest";
import { ATTENDANCE_RULES } from "../settings/attendance-rules";
import { CLASS_RULES } from "../settings/class-rules";
import { DAMAGE_RULES } from "../settings/damage-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { INCIDENT_RULES } from "../settings/incident-rules";
import { cancelBooking, takeOutOfService } from "./bookings";
import { createClass, scheduleSessions, signUp } from "./classes";
import { dismissDamageReport, fileDamageReport } from "./damage";
import { createEvent, rsvp } from "./events";
import { closeIncident, fileIncident } from "./incidents";
import { officeSummary } from "./office";
import { NOW, STORE_KINDS, at, bookAs, buildFixtureSettling, memberCtx, staffCtx } from "./testkit";

/** The staff home page's board, on both stores. Today is Wed Oct 28, 1 pm Pacific. */
describe.each(STORE_KINDS)("the staff board on the %s store", (kind) => {
  it("counts what is on today, leaves out what was cancelled, and lists what is out of service", async () => {
    const clock = { now: NOW };
    const f = await buildFixtureSettling(kind, () => clock.now);
    await f.store.transaction(async (s, newId) => {
      const id = newId();
      s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
      f.i["Boathouse gym"] = id;
    });
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
    await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(0, 17) });
    await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 9) });
    await bookAs(f, "Ada", "Heron", at(0, 15), at(0, 16));
    const cancelled = await bookAs(f, "Dee", "Osprey", at(0, 15), at(0, 16));
    await cancelBooking(f.store, f.book, memberCtx(f.m.Dee), cancelled.booking.id);
    await bookAs(f, "Eli", "Kingfisher", at(1, 7), at(1, 8));
    await createEvent(f.store, staffCtx(), { title: "Barbecue", startsAt: at(0, 18), endsAt: at(0, 20) });
    await takeOutOfService(f.store, staffCtx(), f.i.Loon, { reason: "Cracked rigger", expectedReturn: "2026-11-05" });

    const summary = officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES);
    expect(summary.today).toEqual({ bookings: 1, classes: 1, events: 1 });
    expect(summary.outOfService).toEqual([{ itemId: f.i.Loon, name: "Loon", reason: "Cracked rigger", expectedReturn: "2026-11-05", since: NOW.toISOString() }]);
    expect(summary.waiting).toEqual([]);
    expect(summary.needsLook).toEqual([]);
  });

  it("lists classes and events in the next week that have people waiting, soonest first, and nothing else", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    await f.store.transaction(async (s, newId) => {
      const id = newId();
      s.items.push({ id, name: "Boathouse gym", classCode: "gym-space", ruleOverrides: {} });
      f.i["Boathouse gym"] = id;
    });
    const yoga = await createClass(f.store, f.book, CLASS_RULES, staffCtx(), { name: "Yoga", defaultCapacity: 1, defaultMinutes: 60, roomItemId: f.i["Boathouse gym"] });
    const [full] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(2, 9) });
    const [spare] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(3, 9) });
    const [faraway] = await scheduleSessions(f.store, f.book, staffCtx(), { classId: yoga.id, startsAt: at(10, 9) });
    const join = (who: string, sessionId: string) => signUp(f.store, f.book, CLASS_RULES, memberCtx(f.m[who], who), { sessionId, memberId: f.m[who] });
    await join("Ada", full.id);
    await join("Ben", full.id);
    await join("Dee", spare.id);
    await join("Ada", faraway.id);
    await join("Ben", faraway.id);
    const dinner = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(1, 18), endsAt: at(1, 21), capacity: 2 });
    const go = (who: string, guests = 0) => rsvp(f.store, { ...EVENT_RULES, defaults: { ...EVENT_RULES.defaults, waitlistHoldMinutes: 0 } }, memberCtx(f.m[who], who), { eventId: dinner.id, memberId: f.m[who], guests });
    await go("Ada", 1);
    await go("Dee");
    await go("Eli");

    const waiting = officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES).waiting;
    expect(waiting.map((w) => [w.kind, w.title, w.fullness, w.waiting])).toEqual([
      ["event", "Dinner", "2 of 2 spots", 2],
      ["class", "Yoga", "1 of 1 chairs", 1],
    ]);
  });

  it("brings the automatic no-shows that need a look onto the board", async () => {
    const clock = { now: NOW };
    const f = await buildFixtureSettling(kind, () => clock.now);
    const { booking } = await bookAs(f, "Ada", "Heron", at(1, 7), at(1, 8));
    clock.now = at(1, 9);
    const summary = officeSummary(await f.store.read(), clock.now, ATTENDANCE_RULES);
    expect(summary.needsLook.map((r) => r.id)).toEqual([booking.id]);
  });
  it("puts the damage board on the staff page: what is open, what is major, and the most pressing reports first", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    expect(officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES).damage).toEqual({ open: 0, major: 0, majorInService: 0, top: [] });
    const minor = await fileDamageReport(f.store, memberCtx(f.m.Ada, "Ada Quill"), DAMAGE_RULES, { itemId: f.i.Heron, description: "Seat sticks.", major: false });
    const major = await fileDamageReport(f.store, memberCtx(f.m.Ben, "Ben Quill"), DAMAGE_RULES, { itemId: f.i.Osprey, description: "Rigger bent.", major: true });
    const closed = await fileDamageReport(f.store, memberCtx(f.m.Cy, "Cy Quill"), DAMAGE_RULES, { itemId: f.i.Loon, description: "Scratch.", major: true });
    await dismissDamageReport(f.store, staffCtx(), DAMAGE_RULES, { reportId: closed.id, reason: "Duplicate." });
    const damage = officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES).damage;
    expect(damage).toMatchObject({ open: 2, major: 1, majorInService: 1 });
    expect(damage.top.map((r) => r.reportId)).toEqual([major.id, minor.id]);
  });
  it("puts the incident board on the staff page: what is open, how many have someone hurt or an emergency call, and the most pressing first", async () => {
    const f = await buildFixtureSettling(kind, () => NOW);
    const file = (change: { whatHappened: string; people?: { name: string; injured: boolean }[]; emergencyCalled?: boolean }) =>
      fileIncident(f.store, staffCtx(), INCIDENT_RULES, { occurredAt: NOW, onTheWater: true, firstAidGiven: false, emergencyCalled: false, ...change });
    expect(officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES).incidents).toEqual({ open: 0, hurt: 0, emergency: 0, top: [] });
    const plain = await file({ whatHappened: "Near miss." });
    const hurt = await file({ whatHappened: "Capsize.", people: [{ name: "Jordan Example", injured: true }], emergencyCalled: true });
    const closed = await file({ whatHappened: "Old one.", people: [{ name: "Pat Example", injured: true }] });
    await closeIncident(f.store, staffCtx(), INCIDENT_RULES, { incidentId: closed.id, outcome: "Done." });
    const incidents = officeSummary(await f.store.read(), NOW, ATTENDANCE_RULES).incidents;
    expect(incidents).toMatchObject({ open: 2, hurt: 1, emergency: 1 });
    expect(incidents.top.map((r) => r.incidentId)).toEqual([hurt.id, plain.id]);
  });
});
