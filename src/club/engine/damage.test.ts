import { describe, expect, it } from "vitest";
import { ClubError } from "../errors";
import { DAMAGE_RULES } from "../settings/damage-rules";
import type { DamageRules } from "../types";
import { addBoatOwner } from "./boat-access";
import { bookingLedger, createBooking } from "./bookings";
import {
  addDamageNote,
  assignDamageReport,
  bookingDamageNotices,
  damageDetail,
  damageQueue,
  dismissDamageReport,
  fileDamageReport,
  markDamageRepaired,
  myDamageReports,
  noticeWords,
  officeDamage,
  openDamageNotices,
  reportableItems,
  repairTimeWords,
  setDamagePriority,
  startDamageRepair,
  takeOutOfServiceForReport,
  type DamageInput,
} from "./damage";
import { endHousehold } from "./households";
import { NOW, STORE_KINDS, at, fixtureFor, memberCtx, refusedFor, request, staffCtx, type Fixture } from "./testkit";

/**
 * Damage reports: who may file, what is cleaned and capped, the steps staff take (assign, priority, start, take out of service,
 * repair, dismiss), what each person is allowed to read, and that every step is a line in the log. Every test runs on both stores,
 * so the in-memory copy and Postgres must agree. Today is Wed Oct 28, 2026, 1 pm Pacific.
 */

const HOUR = 3600000;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const rulesWith = (change: Partial<DamageRules["defaults"]>): DamageRules => ({ ...DAMAGE_RULES, defaults: { ...DAMAGE_RULES.defaults, ...change } });

const asMember = (f: Fixture, who: string, now: Date = NOW) => memberCtx(f.m[who], `${who} Quill`, now);
const asStaff = (now: Date = NOW) => staffCtx(now);

const refusedWith = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
    return null;
  } catch (e) {
    if (e instanceof ClubError) return { code: e.code, message: e.message };
    throw e;
  }
};

const input = (f: Fixture, item: string, change: Partial<DamageInput> = {}): DamageInput => ({ itemId: f.i[item], description: "The foot stretcher is loose.", major: false, ...change });
const file = (f: Fixture, who: string, item: string, change: Partial<DamageInput> = {}, now: Date = NOW) => fileDamageReport(f.store, asMember(f, who, now), DAMAGE_RULES, input(f, item, change));
const fileAsStaff = (f: Fixture, item: string, change: Partial<DamageInput> = {}) => fileDamageReport(f.store, asStaff(), DAMAGE_RULES, input(f, item, change));
const state = (f: Fixture) => f.store.read();
const logOf = async (f: Fixture, reportId: string) => (await state(f)).damageLog.filter((l) => l.reportId === reportId);

/** Adds a private boat with the named owners, the way the engine tests for private boats do. */
async function privateBoat(f: Fixture, name: string, owners: string[]): Promise<void> {
  await f.store.transaction(async (s, newId) => {
    s.items.push({ id: newId(), name, classCode: "shell-single", ruleOverrides: {}, isPrivate: true });
  });
  f.i[name] = (await state(f)).items.find((i) => i.name === name)!.id;
  for (const o of owners) await addBoatOwner(f.store, asStaff(), { itemId: f.i[name], memberId: f.m[o] });
}

for (const kind of STORE_KINDS) {
  describe(`damage reports on the ${kind} store`, () => {
    const fixture = fixtureFor(kind);

    describe("filing a report", () => {
      it("saves what the member wrote, starts it open with the priority for minor damage, and writes the filed line", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron", { location: "Stroke seat", howItHappened: "Caught the dock.", major: false });
        expect(report).toMatchObject({
          itemId: f.i.Heron,
          reportedBy: { kind: "member", memberId: f.m.Ada, label: "Ada Quill" },
          reportedAt: NOW.toISOString(),
          description: "The foot stretcher is loose.",
          location: "Stroke seat",
          howItHappened: "Caught the dock.",
          major: false,
          priority: 3,
          status: "open",
          updatedAt: NOW.toISOString(),
          assignedTo: null,
          closedAt: null,
          repairedOn: null,
          repairedBy: null,
          repairMinutes: null,
          costCents: null,
          repairNotes: null,
          dismissedReason: null,
        });
        const s = await state(f);
        expect(s.damageReports).toEqual([report]);
        expect(s.damageLog).toEqual([{ id: expect.any(String), reportId: report.id, at: NOW.toISOString(), kind: "filed", by: { kind: "member", memberId: f.m.Ada, label: "Ada Quill" }, text: "Reported by Ada Quill as minor damage." }]);
      });

      it("starts a major report at the major priority, and says major in the filed line", async () => {
        const f = await fixture();
        const report = await file(f, "Ben", "Loon", { major: true });
        expect(report).toMatchObject({ major: true, priority: 1 });
        expect((await logOf(f, report.id))[0].text).toBe("Reported by Ben Quill as major damage.");
      });

      it("takes the starting priorities from the rules", async () => {
        const f = await fixture();
        const rules = rulesWith({ majorPriority: 2, minorPriority: 4 });
        const major = await fileDamageReport(f.store, asMember(f, "Ada"), rules, input(f, "Heron", { major: true }));
        const minor = await fileDamageReport(f.store, asMember(f, "Ben"), rules, input(f, "Heron", { major: false }));
        expect([major.priority, minor.priority]).toEqual([2, 4]);
      });

      it("lets staff file one too, under their own name", async () => {
        const f = await fixture();
        const report = await fileAsStaff(f, "Osprey", { major: true });
        expect(report.reportedBy).toEqual({ kind: "staff", label: "Test staff" });
        expect((await logOf(f, report.id))[0].text).toBe("Reported by Test staff as major damage.");
      });

      it("will not take a report from the system, or from a member who has left or whose household ended", async () => {
        const f = await fixture();
        expect(await refusedWith(fileDamageReport(f.store, { actor: { kind: "system", label: "Automatic" }, now: NOW }, DAMAGE_RULES, input(f, "Heron")))).toEqual({ code: "forbidden", message: "Only signed-in members and club staff can report damage." });
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        const refused = await refusedWith(file(f, "Dee", "Heron"));
        expect(refused?.code).toBe("forbidden");
        expect(refused?.message).toMatch(/membership ended on Oct 28, 2026, so they can no longer report damage\.$/);
        expect((await state(f)).damageReports).toEqual([]);
      });

      it("refuses a boat that does not exist", async () => {
        const f = await fixture();
        expect(await refusedWith(fileDamageReport(f.store, asMember(f, "Ada"), DAMAGE_RULES, { itemId: "00000000-0000-4000-8000-0000000000ff", description: "Broken.", major: false }))).toEqual({ code: "not_found", message: "That boat or space no longer exists." });
      });

      it("hides a private boat from a member who is not on its list, and lets its owner and staff report on it", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", ["Ada"]);
        expect(await refusedWith(file(f, "Eli", "Kestrel"))).toEqual({ code: "not_found", message: "That boat or space no longer exists." });
        expect((await file(f, "Ada", "Kestrel")).itemId).toBe(f.i.Kestrel);
        expect((await fileAsStaff(f, "Kestrel")).reportedBy.kind).toBe("staff");
        expect((await state(f)).damageReports).toHaveLength(2);
      });
    });

    describe("what is typed", () => {
      it("needs to be told what is wrong, in words", async () => {
        const f = await fixture();
        for (const description of ["", "   ", "\n\t "]) expect(await refusedWith(file(f, "Ada", "Heron", { description })), JSON.stringify(description)).toEqual({ code: "invalid", message: "Say what is wrong with it." });
      });

      it("takes exactly the longest text each box allows and refuses one more, naming the box and the length", async () => {
        const f = await fixture();
        const d = DAMAGE_RULES.defaults;
        const ok = await file(f, "Ada", "Heron", { description: "d".repeat(d.descriptionMax), location: "l".repeat(d.locationMax), howItHappened: "h".repeat(d.howMax) });
        expect([ok.description.length, ok.location.length, ok.howItHappened.length]).toEqual([d.descriptionMax, d.locationMax, d.howMax]);
        expect(await refusedWith(file(f, "Ben", "Heron", { description: "d".repeat(d.descriptionMax + 1) }))).toEqual({ code: "invalid", message: `What is wrong must be ${d.descriptionMax} characters or fewer. It is ${d.descriptionMax + 1}.` });
        expect(await refusedWith(file(f, "Ben", "Heron", { location: "l".repeat(d.locationMax + 1) }))).toEqual({ code: "invalid", message: `Where on the boat must be ${d.locationMax} characters or fewer. It is ${d.locationMax + 1}.` });
        expect(await refusedWith(file(f, "Ben", "Heron", { howItHappened: "h".repeat(d.howMax + 1) }))).toEqual({ code: "invalid", message: `How it happened must be ${d.howMax} characters or fewer. It is ${d.howMax + 1}.` });
        expect((await state(f)).damageReports).toHaveLength(1);
      });

      it("trims, flattens control characters and runs of spaces in the one-line boxes, and keeps line breaks in the long one", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron", { description: "  the\u0000 seat\tsticks   badly \n ", location: " port\u0007  rigger ", howItHappened: "Line one.\r\nLine two.\n\n\n\nLine\u0000 three.  " });
        expect(report.description).toBe("the seat sticks badly");
        expect(report.location).toBe("port rigger");
        expect(report.howItHappened).toBe("Line one.\nLine two.\n\nLine three.");
      });

      it("needs a clear major or minor", async () => {
        const f = await fixture();
        const bad = { code: "invalid", message: "Say whether the damage is major or minor." };
        expect(await refusedWith(file(f, "Ada", "Heron", { major: undefined as unknown as boolean }))).toEqual(bad);
        expect(await refusedWith(file(f, "Ada", "Heron", { major: "yes" as unknown as boolean }))).toEqual(bad);
      });
    });

    describe("the daily limit", () => {
      const rules = rulesWith({ filedPerMemberPerDay: 3 });
      const fileWith = (f: Fixture, who: string, now: Date = NOW) => fileDamageReport(f.store, asMember(f, who, now), rules, input(f, "Heron"));

      it("stops a member at the limit in 24 hours, in words, and counts only that member", async () => {
        const f = await fixture();
        for (let n = 0; n < 3; n++) await fileWith(f, "Ada");
        expect(await refusedWith(fileWith(f, "Ada"))).toEqual({ code: "refused", message: "You have already filed 3 reports in the last 24 hours, which is the most we take from one person. If something else is broken, please tell club staff." });
        await fileWith(f, "Ben");
        expect((await state(f)).damageReports).toHaveLength(4);
      });

      it("lets staff file as many as they like", async () => {
        const f = await fixture();
        for (let n = 0; n < 5; n++) await fileDamageReport(f.store, asStaff(), rules, input(f, "Heron"));
        expect((await state(f)).damageReports).toHaveLength(5);
      });

      it("counts back exactly 24 hours: a minute inside the day is still counted, the moment itself is not", async () => {
        const f = await fixture();
        for (let n = 0; n < 3; n++) await fileWith(f, "Ada");
        expect((await refusedWith(fileWith(f, "Ada", later(24 * HOUR - 1))))?.code).toBe("refused");
        await fileWith(f, "Ada", later(24 * HOUR));
        expect((await state(f)).damageReports).toHaveLength(4);
      });

      it("has no limit when the rule is 0", async () => {
        const f = await fixture();
        const none = rulesWith({ filedPerMemberPerDay: 0 });
        for (let n = 0; n < 12; n++) await fileDamageReport(f.store, asMember(f, "Ada"), none, input(f, "Heron"));
        expect((await state(f)).damageReports).toHaveLength(12);
      });

      it("holds the limit when the same member files many at once", async () => {
        const f = await fixture();
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => fileWith(f, "Ada")));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
        expect((await state(f)).damageReports).toHaveLength(3);
        expect((await state(f)).damageLog).toHaveLength(3);
      });
    });

    describe("notes", () => {
      it("lets the person who filed it add notes while it is open, and staff any time", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const note = await addDamageNote(f.store, asMember(f, "Ada"), DAMAGE_RULES, { reportId: report.id, text: "  It also scrapes on the left. " });
        expect(note).toMatchObject({ kind: "note", text: "It also scrapes on the left.", by: { kind: "member", memberId: f.m.Ada } });
        await addDamageNote(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, text: "Looked at it." });
        await dismissDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, reason: "Nothing found." });
        await addDamageNote(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, text: "Closed note." });
        expect((await logOf(f, report.id)).filter((l) => l.kind === "note").map((l) => l.text)).toEqual(["It also scrapes on the left.", "Looked at it.", "Closed note."]);
      });

      it("tells another member the report does not exist, and the filer once it is closed", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        expect(await refusedWith(addDamageNote(f.store, asMember(f, "Ben"), DAMAGE_RULES, { reportId: report.id, text: "Me too." }))).toEqual({ code: "not_found", message: "That damage report no longer exists." });
        await startDamageRepair(f.store, asStaff(), { reportId: report.id });
        await addDamageNote(f.store, asMember(f, "Ada"), DAMAGE_RULES, { reportId: report.id, text: "Still open, being fixed." });
        await dismissDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, reason: "Duplicate." });
        expect((await refusedWith(addDamageNote(f.store, asMember(f, "Ada"), DAMAGE_RULES, { reportId: report.id, text: "Too late." })))?.message).toBe("That report is already dismissed, so it cannot change. If the damage is back, file a new report.");
      });

      it("will not take a note from the system, from a filer who has left, or an empty or too long one", async () => {
        const f = await fixture();
        const report = await file(f, "Dee", "Heron");
        const note = (text: string, ctx = asStaff()) => addDamageNote(f.store, ctx, DAMAGE_RULES, { reportId: report.id, text });
        expect((await refusedWith(note("x", { actor: { kind: "system", label: "Automatic" }, now: NOW })))?.code).toBe("forbidden");
        expect(await refusedWith(note("   "))).toEqual({ code: "invalid", message: "Write the note first." });
        const max = DAMAGE_RULES.defaults.noteMax;
        await note("n".repeat(max));
        expect(await refusedWith(note("n".repeat(max + 1)))).toEqual({ code: "invalid", message: `A note must be ${max} characters or fewer. It is ${max + 1}.` });
        expect(await refusedWith(addDamageNote(f.store, asStaff(), DAMAGE_RULES, { reportId: "00000000-0000-4000-8000-0000000000ff", text: "x" }))).toEqual({ code: "not_found", message: "That damage report no longer exists." });
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        expect((await refusedWith(note("After leaving.", asMember(f, "Dee"))))?.code).toBe("forbidden");
      });
    });

    describe("triage by staff", () => {
      it("assigns, reassigns and clears who is fixing it, and says so in the log", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const later1 = later(HOUR);
        const done = await assignDamageReport(f.store, asStaff(later1), DAMAGE_RULES, { reportId: report.id, assignedTo: "  Sam   Shop " });
        expect(done).toMatchObject({ assignedTo: "Sam Shop", updatedAt: later1.toISOString() });
        await assignDamageReport(f.store, asStaff(later(2 * HOUR)), DAMAGE_RULES, { reportId: report.id, assignedTo: "Pat" });
        await assignDamageReport(f.store, asStaff(later(3 * HOUR)), DAMAGE_RULES, { reportId: report.id, assignedTo: "" });
        expect((await state(f)).damageReports[0].assignedTo).toBeNull();
        expect((await logOf(f, report.id)).filter((l) => l.kind === "assigned").map((l) => l.text)).toEqual(["Assigned to Sam Shop.", "Assigned to Pat (was Sam Shop).", "No longer assigned to Pat."]);
      });

      it("refuses what changes nothing, a name that is too long, and anyone but staff", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const assign = (assignedTo: string, ctx = asStaff()) => assignDamageReport(f.store, ctx, DAMAGE_RULES, { reportId: report.id, assignedTo });
        expect(await refusedWith(assign(""))).toEqual({ code: "unchanged", message: "Nobody is assigned to this report." });
        await assign("Sam");
        expect(await refusedWith(assign("Sam"))).toEqual({ code: "unchanged", message: "Sam is already assigned to this report." });
        const max = DAMAGE_RULES.defaults.assignedToMax;
        await assign("s".repeat(max));
        expect(await refusedWith(assign("s".repeat(max + 1)))).toEqual({ code: "invalid", message: `Who is fixing it must be ${max} characters or fewer. It is ${max + 1}.` });
        expect(await refusedWith(assign("Me", asMember(f, "Ada")))).toEqual({ code: "forbidden", message: "Only club staff can assign damage reports." });
      });

      it("changes the priority from 1 to 4, in words, and refuses a repeat, a bad number and anyone but staff", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const done = await setDamagePriority(f.store, asStaff(later(HOUR)), { reportId: report.id, priority: 1 });
        expect(done).toMatchObject({ priority: 1, updatedAt: later(HOUR).toISOString() });
        expect((await logOf(f, report.id)).at(-1)!.text).toBe("Priority changed from 3 (normal) to 1 (urgent).");
        expect(await refusedWith(setDamagePriority(f.store, asStaff(), { reportId: report.id, priority: 1 }))).toEqual({ code: "unchanged", message: "This report is already priority 1 (urgent)." });
        for (const priority of [0, 5, 2.5, Number.NaN, -1]) expect((await refusedWith(setDamagePriority(f.store, asStaff(), { reportId: report.id, priority })))?.message, String(priority)).toBe("Priority is a number from 1 (most urgent) to 4 (least urgent).");
        for (const priority of [2, 3, 4]) await setDamagePriority(f.store, asStaff(), { reportId: report.id, priority });
        expect(await refusedWith(setDamagePriority(f.store, asMember(f, "Ada"), { reportId: report.id, priority: 2 }))).toEqual({ code: "forbidden", message: "Only club staff can change a report's priority." });
      });

      it("marks work as started once, and refuses a repeat and anyone but staff", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const done = await startDamageRepair(f.store, asStaff(later(HOUR)), { reportId: report.id });
        expect(done).toMatchObject({ status: "in_progress", updatedAt: later(HOUR).toISOString() });
        expect((await logOf(f, report.id)).at(-1)).toMatchObject({ kind: "started", text: "Work started by Test staff." });
        expect(await refusedWith(startDamageRepair(f.store, asStaff(), { reportId: report.id }))).toEqual({ code: "unchanged", message: "Work on this report has already started." });
        expect(await refusedWith(startDamageRepair(f.store, asMember(f, "Ada"), { reportId: report.id }))).toEqual({ code: "forbidden", message: "Only club staff can start work on a damage report." });
      });

      it("can still be triaged while it is being fixed, and nothing changes once it is closed", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        await startDamageRepair(f.store, asStaff(), { reportId: report.id });
        await assignDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, assignedTo: "Sam" });
        await setDamagePriority(f.store, asStaff(), { reportId: report.id, priority: 2 });
        await markDamageRepaired(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, repairedOn: "2026-10-28", repairedBy: "Sam" });
        const closed = "That report is already repaired, so it cannot change. If the damage is back, file a new report.";
        expect((await refusedWith(assignDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, assignedTo: "Pat" })))?.message).toBe(closed);
        expect((await refusedWith(setDamagePriority(f.store, asStaff(), { reportId: report.id, priority: 4 })))?.message).toBe(closed);
        expect((await refusedWith(startDamageRepair(f.store, asStaff(), { reportId: report.id })))?.message).toBe(closed);
        expect((await refusedWith(takeOutOfServiceForReport(f.store, asStaff(), { reportId: report.id })))?.message).toBe(closed);
        expect((await refusedWith(markDamageRepaired(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, repairedOn: "2026-10-28", repairedBy: "Sam" })))?.message).toBe(closed);
        expect((await refusedWith(dismissDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, reason: "No." })))?.message).toBe(closed);
        expect((await state(f)).damageReports[0]).toMatchObject({ status: "repaired", assignedTo: "Sam", priority: 2 });
      });
    });

    describe("taking the boat out of service from a report", () => {
      it("does the same as the Equipment page with the reason filled in, lists the bookings that stay, and logs it", async () => {
        const f = await fixture();
        await createBooking(f.store, f.book, asMember(f, "Eli"), request(f, "Eli", "Heron", at(1, 7), at(1, 8)));
        const report = await file(f, "Ada", "Heron", { description: "The slide is cracked.", major: true });
        const before = (await state(f)).damageReports[0];
        const done = await takeOutOfServiceForReport(f.store, asStaff(later(HOUR)), { reportId: report.id, expectedReturn: "2026-11-05" });
        expect(done.period).toMatchObject({ itemId: f.i.Heron, reason: 'Damage reported: The slide is cracked.', expectedReturn: "2026-11-05", until: null, from: later(HOUR).toISOString(), createdBy: { kind: "staff", label: "Test staff" } });
        expect(done.affected.map((a) => a.people.map((p) => p.name))).toEqual([["Eli Reed"]]);
        const s = await state(f);
        expect(s.outOfService).toHaveLength(1);
        expect((await logOf(f, report.id)).at(-1)).toMatchObject({ kind: "taken_out_of_service", text: "Heron taken out of service by Test staff. 1 upcoming booking stays; staff have the list to contact the people." });
        // The report itself is untouched: still open, same time, so the database sees no change to it.
        expect(s.damageReports[0]).toEqual(before);
        expect(await refusedFor(createBooking(f.store, f.book, asMember(f, "Ben"), request(f, "Ben", "Heron", at(1, 9), at(1, 10))))).toContain("out_of_service");
      });

      it("says nobody has it booked when that is so, and passes the reason on as plain text capped at 200 characters", async () => {
        const f = await fixture();
        const long = "x".repeat(DAMAGE_RULES.defaults.descriptionMax);
        const report = await file(f, "Ada", "Osprey", { description: long });
        const done = await takeOutOfServiceForReport(f.store, asStaff(), { reportId: report.id });
        expect(done.period.reason).toHaveLength(200);
        expect(done.period.reason).toBe(`Damage reported: ${"x".repeat(200 - "Damage reported: ".length - 3)}...`);
        expect((await logOf(f, report.id)).at(-1)!.text).toBe("Osprey taken out of service by Test staff. Nobody has it booked.");
      });

      it("refuses a boat that is already out of service (saying why), anyone but staff, and a bad date, writing nothing", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        expect(await refusedWith(takeOutOfServiceForReport(f.store, asMember(f, "Ada"), { reportId: report.id }))).toEqual({ code: "forbidden", message: "Only club staff can take something out of service." });
        expect((await refusedWith(takeOutOfServiceForReport(f.store, asStaff(), { reportId: report.id, expectedReturn: "next week" })))?.message).toBe("The expected return date must look like 2026-11-05.");
        expect((await state(f)).outOfService).toEqual([]);
        expect(await logOf(f, report.id)).toHaveLength(1);
        await takeOutOfServiceForReport(f.store, asStaff(), { reportId: report.id });
        const second = await file(f, "Ben", "Heron", { description: "A second problem." });
        expect(await refusedWith(takeOutOfServiceForReport(f.store, asStaff(later(HOUR)), { reportId: second.id }))).toEqual({ code: "conflict", message: "Heron is already out of service: Damage reported: The foot stretcher is loose." });
        expect((await state(f)).outOfService).toHaveLength(1);
      });
    });

    describe("closing a report as repaired", () => {
      const repair = (f: Fixture, reportId: string, change: Record<string, unknown> = {}, now: Date = NOW) =>
        markDamageRepaired(f.store, asStaff(now), DAMAGE_RULES, { reportId, repairedOn: "2026-10-28", repairedBy: "Sam Shop", ...change });

      it("records when, by whom, the time, the cost and the notes, and writes it on the log", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const done = await repair(f, report.id, { repairMinutes: 90, costCents: 1850, notes: "  Replaced two seat wheels.\nCleaned the track. " }, later(HOUR));
        expect(done.returned).toBe(false);
        expect(done.report).toMatchObject({
          status: "repaired",
          closedAt: later(HOUR).toISOString(),
          updatedAt: later(HOUR).toISOString(),
          repairedOn: "2026-10-28",
          repairedBy: "Sam Shop",
          repairMinutes: 90,
          costCents: 1850,
          repairNotes: "Replaced two seat wheels.\nCleaned the track.",
        });
        expect((await state(f)).damageReports[0]).toEqual(done.report);
        expect((await logOf(f, report.id)).at(-1)).toMatchObject({ kind: "repaired", text: "Repaired on Oct 28, 2026 by Sam Shop; 1 hour 30 minutes spent, cost $18.50. Closed by Test staff." });
      });

      it("needs only the date and who did it; the rest is left empty", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const done = await repair(f, report.id);
        expect(done.report).toMatchObject({ repairMinutes: null, costCents: null, repairNotes: null });
        expect((await logOf(f, report.id)).at(-1)!.text).toBe("Repaired on Oct 28, 2026 by Sam Shop. Closed by Test staff.");
      });

      it("takes zero time and zero cost as said, not as missing", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const done = await repair(f, report.id, { repairMinutes: 0, costCents: 0 });
        expect(done.report).toMatchObject({ repairMinutes: 0, costCents: 0 });
        expect((await logOf(f, report.id)).at(-1)!.text).toBe("Repaired on Oct 28, 2026 by Sam Shop; 0 minutes spent, cost $0.00. Closed by Test staff.");
      });

      it("refuses who is missing or too long, bad numbers, bad dates and anyone but staff, and leaves the report open each time", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const d = DAMAGE_RULES.defaults;
        const refused = async (change: Record<string, unknown>) => (await refusedWith(repair(f, report.id, change)))?.message;
        expect(await refused({ repairedBy: "  " })).toBe("Say who did the repair.");
        expect(await refused({ repairedBy: "s".repeat(d.repairedByMax + 1) })).toBe(`Repaired by must be ${d.repairedByMax} characters or fewer. It is ${d.repairedByMax + 1}.`);
        expect(await refused({ notes: "n".repeat(d.repairNotesMax + 1) })).toBe(`The repair notes must be ${d.repairNotesMax} characters or fewer. It is ${d.repairNotesMax + 1}.`);
        for (const repairMinutes of [-1, 1.5, 60001, Number.NaN]) expect(await refused({ repairMinutes }), String(repairMinutes)).toBe("Time spent must be between 0 and 1000 hours.");
        for (const costCents of [-1, 10.5, 10_000_001]) expect(await refused({ costCents }), String(costCents)).toBe("The cost must be between $0 and $100,000.00.");
        for (const repairedOn of ["", "2026-13-01", "2026-02-30", "10/28/2026", "2026-10-28T10:00"]) expect(await refused({ repairedOn }), repairedOn).toBe("The repair date is not a real date. Use a day like 2026-11-05.");
        expect(await refused({ repairedOn: "2026-10-29" })).toBe("The repair date cannot be in the future.");
        expect(await refused({ repairedOn: "2026-10-27" })).toBe("The repair date cannot be before the report was filed on Oct 28, 2026.");
        expect(await refusedWith(markDamageRepaired(f.store, asMember(f, "Ada"), DAMAGE_RULES, { reportId: report.id, repairedOn: "2026-10-28", repairedBy: "Me" }))).toEqual({ code: "forbidden", message: "Only club staff can close a damage report." });
        expect((await state(f)).damageReports[0]).toMatchObject({ status: "open", closedAt: null, repairedOn: null });
        expect(await logOf(f, report.id)).toHaveLength(1);
        // The edges are fine: the day it was filed, the highest time and cost.
        await repair(f, report.id, { repairMinutes: 60000, costCents: 10_000_000, repairedBy: "s".repeat(d.repairedByMax), notes: "n".repeat(d.repairNotesMax) });
        expect((await state(f)).damageReports[0].status).toBe("repaired");
      });

      it("accepts the day of the filing on the Pacific clock even when it is already the next day in UTC", async () => {
        const f = await fixture();
        const lateEvening = new Date("2026-10-29T05:30:00Z"); // 10:30 pm Pacific, Oct 28
        const report = await file(f, "Ada", "Heron", {}, lateEvening);
        // It is already Oct 29 in UTC, but still Oct 28 on the Pacific clock, so Oct 29 is tomorrow and cannot be a repair date.
        expect((await refusedWith(markDamageRepaired(f.store, asStaff(lateEvening), DAMAGE_RULES, { reportId: report.id, repairedOn: "2026-10-29", repairedBy: "Sam" })))?.message).toBe("The repair date cannot be in the future.");
        await markDamageRepaired(f.store, asStaff(lateEvening), DAMAGE_RULES, { reportId: report.id, repairedOn: "2026-10-28", repairedBy: "Sam" });
        expect((await state(f)).damageReports[0].repairedOn).toBe("2026-10-28");
      });

      it("can bring the boat back into service in the same step, and says so in the log", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron", { major: true });
        await takeOutOfServiceForReport(f.store, asStaff(later(HOUR)), { reportId: report.id });
        const done = await repair(f, report.id, { returnToService: true }, later(2 * HOUR));
        expect(done.returned).toBe(true);
        const s = await state(f);
        expect(s.outOfService[0].until).toBe(later(2 * HOUR).toISOString());
        expect((await logOf(f, report.id)).slice(-2).map((l) => [l.kind, l.text])).toEqual([
          ["repaired", "Repaired on Oct 28, 2026 by Sam Shop. Closed by Test staff."],
          ["returned_to_service", "Heron returned to service by Test staff."],
        ]);
        expect(await refusedFor(createBooking(f.store, f.book, asMember(f, "Ben", later(2 * HOUR)), request(f, "Ben", "Heron", at(1, 9), at(1, 10))))).toEqual([]);
      });

      it("leaves the boat alone when not asked, and when it is not out of service there is nothing to return", async () => {
        const f = await fixture();
        const a = await file(f, "Ada", "Heron");
        await takeOutOfServiceForReport(f.store, asStaff(), { reportId: a.id });
        const kept = await repair(f, a.id);
        expect(kept.returned).toBe(false);
        expect((await state(f)).outOfService[0].until).toBeNull();
        const b = await file(f, "Ben", "Osprey");
        const none = await repair(f, b.id, { returnToService: true });
        expect(none.returned).toBe(false);
        expect((await logOf(f, b.id)).map((l) => l.kind)).toEqual(["filed", "repaired"]);
      });

      it("tells staff how many other major reports are still open on the same boat", async () => {
        const f = await fixture();
        const a = await file(f, "Ada", "Heron", { major: true });
        await file(f, "Ben", "Heron", { major: true });
        await file(f, "Cy", "Heron", { major: false });
        const dismissed = await file(f, "Dee", "Heron", { major: true });
        await dismissDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: dismissed.id, reason: "Duplicate." });
        await file(f, "Eli", "Osprey", { major: true });
        expect((await repair(f, a.id)).otherOpenMajor).toBe(1);
      });
    });

    describe("dismissing a report", () => {
      it("closes it with the reason, on the log, and needs a reason", async () => {
        const f = await fixture();
        const report = await file(f, "Ada", "Heron");
        const dismiss = (reason: string, ctx = asStaff(later(HOUR))) => dismissDamageReport(f.store, ctx, DAMAGE_RULES, { reportId: report.id, reason });
        expect(await refusedWith(dismiss("  "))).toEqual({ code: "invalid", message: "Say why the report is being dismissed." });
        const max = DAMAGE_RULES.defaults.dismissReasonMax;
        expect((await refusedWith(dismiss("r".repeat(max + 1))))?.message).toBe(`The reason must be ${max} characters or fewer. It is ${max + 1}.`);
        expect(await refusedWith(dismiss("Nope.", asMember(f, "Ada")))).toEqual({ code: "forbidden", message: "Only club staff can dismiss a damage report." });
        const done = await dismiss(" Already on the list. ");
        expect(done).toMatchObject({ status: "dismissed", dismissedReason: "Already on the list.", closedAt: later(HOUR).toISOString(), updatedAt: later(HOUR).toISOString(), repairedOn: null, repairedBy: null });
        expect((await logOf(f, report.id)).at(-1)).toMatchObject({ kind: "dismissed", text: "Dismissed by Test staff: Already on the list." });
      });
    });

    describe("what members see", () => {
      it("shows the open reports on a boat, major first and then oldest, without who filed them or how it happened", async () => {
        const f = await fixture();
        const minor = await file(f, "Ada", "Heron", { description: "Scratch on the hull.", location: "Port side", howItHappened: "Ada did it.", major: false });
        const major = await file(f, "Ben", "Heron", { description: "Rigger bent.", major: true }, later(HOUR));
        const fixing = await file(f, "Cy", "Heron", { description: "Seat sticks.", major: false }, later(2 * HOUR));
        await startDamageRepair(f.store, asStaff(later(3 * HOUR)), { reportId: fixing.id });
        await file(f, "Dee", "Osprey", { description: "Other boat." });
        const closed = await file(f, "Eli", "Heron", { description: "Fixed already." }, later(4 * HOUR));
        await dismissDamageReport(f.store, asStaff(later(5 * HOUR)), DAMAGE_RULES, { reportId: closed.id, reason: "Duplicate." });
        const notices = openDamageNotices(await state(f), f.i.Heron);
        expect(notices).toEqual([
          { reportId: major.id, major: true, description: "Rigger bent.", location: "", reportedOn: "2026-10-28", beingFixed: false },
          { reportId: minor.id, major: false, description: "Scratch on the hull.", location: "Port side", reportedOn: "2026-10-28", beingFixed: false },
          { reportId: fixing.id, major: false, description: "Seat sticks.", location: "", reportedOn: "2026-10-28", beingFixed: true },
        ]);
        expect(JSON.stringify(notices)).not.toMatch(/Ada|Ben|Cy|Quill|did it/);
        expect(openDamageNotices(await state(f), f.i.Kingfisher)).toEqual([]);
      });

      it("words a notice: major says check with staff, minor says it can still be used, and neither names anyone", () => {
        const base = { reportId: "r", description: "Rigger bent.", location: "", reportedOn: "2026-10-28", beingFixed: false };
        expect(noticeWords({ ...base, major: true })).toBe('Major damage reported on Oct 28, 2026: "Rigger bent.". Check with club staff before you use it.');
        expect(noticeWords({ ...base, major: false, location: "Port side" })).toBe('Minor damage reported on Oct 28, 2026: "Rigger bent." (Port side). You can still use it.');
        expect(noticeWords({ ...base, major: true, location: "Bow", beingFixed: true })).toBe('Major damage reported on Oct 28, 2026: "Rigger bent." (Bow). It is being fixed. Check with club staff before you use it.');
        expect(noticeWords({ ...base, major: false, beingFixed: true })).toBe('Minor damage reported on Oct 28, 2026: "Rigger bent.". It is being fixed. You can still use it.');
      });

      it("tells the booker and the crew about open damage on their upcoming outings, and nobody else, and not once it is closed", async () => {
        const f = await fixture();
        const booking = await createBooking(f.store, f.book, asMember(f, "Ada"), request(f, "Ada", "Loon", at(1, 7), at(1, 8), ["Ben"]));
        await createBooking(f.store, f.book, asMember(f, "Dee"), request(f, "Dee", "Heron", at(1, 9), at(1, 10)));
        await createBooking(f.store, f.book, asMember(f, "Eli"), request(f, "Eli", "Loon", at(2, 7), at(2, 8)));
        const report = await file(f, "Dee", "Loon", { description: "Oar lock loose.", major: true });
        const s = await state(f);
        expect(Object.keys(bookingDamageNotices(s, f.m.Ada, NOW))).toEqual([booking.booking.id]);
        expect(bookingDamageNotices(s, f.m.Ada, NOW)[booking.booking.id].map((n) => n.reportId)).toEqual([report.id]);
        expect(Object.keys(bookingDamageNotices(s, f.m.Ben, NOW))).toEqual([booking.booking.id]);
        // Dee filed the report but her own outing is on another boat; Eli has a second outing in Loon; Cy has none.
        expect(bookingDamageNotices(s, f.m.Dee, NOW)).toEqual({});
        expect(Object.keys(bookingDamageNotices(s, f.m.Eli, NOW))).toHaveLength(1);
        expect(bookingDamageNotices(s, f.m.Cy, NOW)).toEqual({});
        // Ada's outing ends at 8 am tomorrow; after that it is no longer upcoming. Once the report is closed nothing is shown.
        expect(bookingDamageNotices(s, f.m.Ada, later(20 * HOUR))).toEqual({});
        await dismissDamageReport(f.store, asStaff(), DAMAGE_RULES, { reportId: report.id, reason: "Duplicate." });
        expect(bookingDamageNotices(await state(f), f.m.Ada, NOW)).toEqual({});
      });

      it("lists a member's own reports, newest first, with their own notes only and none of staff's details", async () => {
        const f = await fixture();
        const first = await file(f, "Ada", "Heron", { description: "First.", major: true });
        const second = await file(f, "Ada", "Osprey", { description: "Second." }, later(HOUR));
        await file(f, "Ben", "Heron", { description: "Not Ada's." }, later(2 * HOUR));
        await addDamageNote(f.store, asMember(f, "Ada", later(3 * HOUR)), DAMAGE_RULES, { reportId: first.id, text: "More detail." });
        await addDamageNote(f.store, asStaff(later(4 * HOUR)), DAMAGE_RULES, { reportId: first.id, text: "Staff only thought." });
        await assignDamageReport(f.store, asStaff(later(5 * HOUR)), DAMAGE_RULES, { reportId: first.id, assignedTo: "Sam" });
        await markDamageRepaired(f.store, asStaff(later(6 * HOUR)), DAMAGE_RULES, { reportId: second.id, repairedOn: "2026-10-28", repairedBy: "Sam", costCents: 500, notes: "Secret cost note" });
        const mine = myDamageReports(await state(f), f.m.Ada);
        expect(mine.map((r) => r.reportId)).toEqual([second.id, first.id]);
        expect(mine[1]).toEqual({
          reportId: first.id,
          itemName: "Heron",
          major: true,
          description: "First.",
          reportedAt: NOW.toISOString(),
          status: "open",
          statusWords: "Open",
          repairedOn: null,
          dismissedReason: null,
          notes: [{ at: later(3 * HOUR).toISOString(), text: "More detail." }],
        });
        expect(mine[0]).toMatchObject({ status: "repaired", statusWords: "Repaired", repairedOn: "2026-10-28" });
        expect(JSON.stringify(mine)).not.toMatch(/Sam|Staff only|Secret|500|priority/);
        expect(myDamageReports(await state(f), f.m.Cy)).toEqual([]);
      });

      it("keeps a report after its filer leaves the club", async () => {
        const f = await fixture();
        const report = await file(f, "Dee", "Heron");
        await endHousehold(f.store, bookingLedger, asStaff(), f.h.Reed);
        expect(myDamageReports(await state(f), f.m.Dee).map((r) => r.reportId)).toEqual([report.id]);
        expect((await state(f)).damageReports).toHaveLength(1);
      });

      it("offers a member every boat they may see, hides a private boat from those not on its list, and offers staff everything", async () => {
        const f = await fixture();
        await privateBoat(f, "Kestrel", ["Ada"]);
        const names = (items: { name: string }[]) => items.map((i) => i.name);
        expect(names(reportableItems(await state(f), { kind: "member", memberId: f.m.Ada }))).toContain("Kestrel");
        expect(names(reportableItems(await state(f), { kind: "member", memberId: f.m.Eli }))).not.toContain("Kestrel");
        expect(names(reportableItems(await state(f), { kind: "staff" }))).toEqual(["Albatross", "Dock slip A", "Heron", "Kestrel", "Kingfisher", "Loon", "Osprey", "Otter", "Pelican", "Skimmer"]);
      });
    });

    describe("what staff see", () => {
      it("lists what is still to fix with major first, then the most urgent, then the oldest, and the closed ones newest first", async () => {
        const f = await fixture();
        const a = await file(f, "Ada", "Heron", { description: "Minor old.", major: false });
        const b = await file(f, "Ben", "Osprey", { description: "Minor newer.", major: false }, later(HOUR));
        const c = await file(f, "Cy", "Loon", { description: "Major.", major: true }, later(2 * HOUR));
        const d = await file(f, "Dee", "Pelican", { description: "Minor urgent.", major: false }, later(3 * HOUR));
        await setDamagePriority(f.store, asStaff(later(4 * HOUR)), { reportId: d.id, priority: 1 });
        const e = await file(f, "Eli", "Otter", { description: "Closed one.", major: true }, later(5 * HOUR));
        await dismissDamageReport(f.store, asStaff(later(6 * HOUR)), DAMAGE_RULES, { reportId: e.id, reason: "Duplicate." });
        const g = await file(f, "Ada", "Skimmer", { description: "Closed later.", major: false }, later(6 * HOUR));
        await markDamageRepaired(f.store, asStaff(later(7 * HOUR)), DAMAGE_RULES, { reportId: g.id, repairedOn: "2026-10-28", repairedBy: "Sam" });
        const now = later(30 * HOUR);
        const s = await state(f);
        expect(damageQueue(s, now, "open").map((r) => r.reportId)).toEqual([c.id, d.id, a.id, b.id]);
        expect(damageQueue(s, now, "closed").map((r) => r.reportId)).toEqual([g.id, e.id]);
        const row = damageQueue(s, now, "open")[0];
        expect(row).toEqual({ reportId: c.id, itemId: f.i.Loon, itemName: "Loon", description: "Major.", location: "", major: true, priority: 1, status: "open", statusWords: "Open", reportedAt: later(2 * HOUR).toISOString(), reporter: "Cy Quill", assignedTo: null, daysOpen: 1, outOfService: false, closedAt: null });
        // A closed report counts its days up to the day it was closed, not to today.
        expect(damageQueue(s, now, "closed")[0].daysOpen).toBe(0);
      });

      it("marks the reports whose boat is out of service right now", async () => {
        const f = await fixture();
        const a = await file(f, "Ada", "Heron", { major: true });
        await file(f, "Ben", "Osprey", { major: true });
        await takeOutOfServiceForReport(f.store, asStaff(later(HOUR)), { reportId: a.id });
        const rows = damageQueue(await state(f), later(2 * HOUR), "open");
        expect(rows.map((r) => [r.itemName, r.outOfService])).toEqual([["Heron", true], ["Osprey", false]]);
      });

      it("shows one report with its log newest first, the others open on the boat, the bookings, and whether it is out of service", async () => {
        const f = await fixture();
        await createBooking(f.store, f.book, asMember(f, "Eli"), request(f, "Eli", "Heron", at(1, 7), at(1, 8)));
        const a = await file(f, "Ada", "Heron", { description: "Cracked.", location: "Bow", howItHappened: "Dock.", major: true });
        const b = await file(f, "Ben", "Heron", { description: "Scratched.", major: false }, later(HOUR));
        await assignDamageReport(f.store, asStaff(later(2 * HOUR)), DAMAGE_RULES, { reportId: a.id, assignedTo: "Sam" });
        await takeOutOfServiceForReport(f.store, asStaff(later(3 * HOUR)), { reportId: a.id });
        const detail = damageDetail(await state(f), a.id, later(4 * HOUR))!;
        expect(detail).toMatchObject({ itemName: "Heron", reporter: "Ada Quill", assignedTo: "Sam", statusWords: "Open", priorityWords: "Urgent", upcomingBookings: 1, privateBoat: false });
        expect(detail.report.howItHappened).toBe("Dock.");
        expect(detail.log.map((l) => l.kind)).toEqual(["taken_out_of_service", "assigned", "filed"]);
        expect(detail.outOfService).toMatchObject({ itemId: f.i.Heron, until: null });
        expect(detail.otherOpen).toEqual([{ reportId: b.id, description: "Scratched.", major: false, priority: 3 }]);
        expect(damageDetail(await state(f), "00000000-0000-4000-8000-0000000000ff", NOW)).toBeNull();
      });

      it("counts the board: what is open, what is major, which major ones are on a boat still in service, and the top five", async () => {
        const f = await fixture();
        const names = ["Heron", "Osprey", "Kingfisher", "Loon", "Pelican", "Albatross", "Otter"];
        const reports = [];
        for (const [n, boat] of names.entries()) reports.push(await file(f, n % 2 === 0 ? "Ada" : "Ben", boat, { description: `Problem ${n}.`, major: n < 3 }, later(n * HOUR)));
        await takeOutOfServiceForReport(f.store, asStaff(later(8 * HOUR)), { reportId: reports[0].id });
        const closed = await file(f, "Cy", "Skimmer", { major: true }, later(9 * HOUR));
        await dismissDamageReport(f.store, asStaff(later(10 * HOUR)), DAMAGE_RULES, { reportId: closed.id, reason: "Duplicate." });
        const board = officeDamage(await state(f), later(11 * HOUR));
        expect(board).toMatchObject({ open: 7, major: 3, majorInService: 2 });
        expect(board.top.map((r) => r.reportId)).toEqual([reports[0], reports[1], reports[2], reports[3], reports[4]].map((r) => r.id));
        const empty = await fixture();
        expect(officeDamage(await state(empty), NOW)).toEqual({ open: 0, major: 0, majorInService: 0, top: [] });
      });

      it("says time spent in hours and minutes", () => {
        expect(repairTimeWords(0)).toBe("0 minutes");
        expect(repairTimeWords(1)).toBe("1 minute");
        expect(repairTimeWords(45)).toBe("45 minutes");
        expect(repairTimeWords(60)).toBe("1 hour");
        expect(repairTimeWords(90)).toBe("1 hour 30 minutes");
        expect(repairTimeWords(125)).toBe("2 hours 5 minutes");
      });
    });
  });
}
