import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileDamageReport } from "@/club/engine/damage";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import { DAMAGE_RULES } from "@/club/settings/damage-rules";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The staff buttons on a damage report, called directly with who is signed in, whether the member area is on, and the club's
 * records replaced by the invented sample (a minor open report on Pelican, a major one being fixed on Merganser, a repaired one
 * on Loon and a dismissed one on Tern). They are staff only: anyone else gets "page not found" before the form is read.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, store: null as unknown, now: null as unknown }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/club/enabled", () => ({ clubEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => h.now }));
vi.mock("@/club/identity", () => ({
  getCurrentActor: async () => h.actor,
  toEngineActor: (a: { kind: string; label: string; member?: { id: string } }) => (a.kind === "member" ? { kind: "member", memberId: a.member!.id, label: a.label } : { kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.store }));

import { assignReport, changePriority, dismissReport, outOfServiceForReport, repairedReport, startReport } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const report = async (boat: string) => {
  const s = await state();
  const item = s.items.find((i) => i.name === boat)!;
  return s.damageReports.find((r) => r.itemId === item.id)!;
};
const staff = () => {
  h.actor = { kind: "staff", label: "Alex Staffer", source: "login" };
};

beforeEach(async () => {
  h.enabled = true;
  h.actor = null;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the damage report staff buttons: who may use them", () => {
  it("answer 'not found' when the member area is off, when nobody is signed in, and for a member, and change nothing", async () => {
    const pelican = await report("Pelican");
    const fields = form({ report: pelican.id, assignedTo: "Sam", priority: "1", reason: "x", repairedOn: "2026-10-28", repairedBy: "Sam" });
    const actions = [assignReport, changePriority, startReport, outOfServiceForReport, repairedReport, dismissReport];
    const before = JSON.stringify([(await state()).damageReports, (await state()).damageLog, (await state()).outOfService]);
    const members = (await state()).members;
    const alex = members.find((m) => fullName(m) === "Alex Brooks")!;
    for (const [label, setup] of [
      ["area off", () => { staff(); h.enabled = false; }],
      ["nobody", () => { h.enabled = true; h.actor = null; }],
      ["a member", () => { h.enabled = true; h.actor = { kind: "member", label: "Alex Brooks", member: { id: alex.id }, source: "login" }; }],
    ] as [string, () => void][]) {
      setup();
      for (const action of actions) await expect(action(fields), `${label} ${action.name}`).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(JSON.stringify([(await state()).damageReports, (await state()).damageLog, (await state()).outOfService])).toBe(before);
  });
});

describe("assigning and prioritising", () => {
  it("assigns who is fixing it, says so, and says when it is cleared or unchanged", async () => {
    staff();
    const pelican = await report("Pelican");
    expect(await assignReport(form({ report: pelican.id, assignedTo: " Sam  Shop " }))).toEqual({ kind: "ok", message: "Assigned to Sam Shop." });
    expect((await report("Pelican")).assignedTo).toBe("Sam Shop");
    expect(await assignReport(form({ report: pelican.id, assignedTo: "Sam Shop" }))).toEqual({ kind: "error", message: "Sam Shop is already assigned to this report." });
    expect(await assignReport(form({ report: pelican.id, assignedTo: "" }))).toEqual({ kind: "ok", message: "No longer assigned to anyone." });
    expect(await assignReport(form({ assignedTo: "Sam" }))).toEqual({ kind: "error", message: "Choose the report." });
  });

  it("changes the priority and refuses a bad or repeated one in words", async () => {
    staff();
    const pelican = await report("Pelican");
    expect(await changePriority(form({ report: pelican.id, priority: "2" }))).toEqual({ kind: "ok", message: "Priority is now 2." });
    expect((await report("Pelican")).priority).toBe(2);
    expect(await changePriority(form({ report: pelican.id, priority: "2" }))).toEqual({ kind: "error", message: "This report is already priority 2 (high)." });
    expect(await changePriority(form({ report: pelican.id, priority: "9" }))).toEqual({ kind: "error", message: "Priority is a number from 1 (most urgent) to 4 (least urgent)." });
    for (const priority of ["", "x", "-1", "1.5", "12"]) expect(await changePriority(form({ report: pelican.id, priority })), priority).toEqual({ kind: "error", message: "Pick a priority from 1 to 4." });
    expect(await changePriority(form({ priority: "1" }))).toEqual({ kind: "error", message: "Choose the report." });
  });

  it("marks work as started once", async () => {
    staff();
    const pelican = await report("Pelican");
    expect(await startReport(form({ report: pelican.id }))).toEqual({ kind: "ok", message: "Marked as being fixed." });
    expect((await report("Pelican")).status).toBe("in_progress");
    expect(await startReport(form({ report: pelican.id }))).toEqual({ kind: "error", message: "Work on this report has already started." });
    expect(await startReport(form({}))).toEqual({ kind: "error", message: "Choose the report." });
  });
});

describe("taking the boat out of service", () => {
  it("does it with the report's words, says nobody had it booked, and then refuses to do it twice", async () => {
    staff();
    const pelican = await report("Pelican");
    expect(await outOfServiceForReport(form({ report: pelican.id, expectedReturn: "2026-11-05" }))).toEqual({ kind: "ok", message: "Taken out of service. Nobody had it booked." });
    const period = (await state()).outOfService.find((p) => p.reason.startsWith("Damage reported: The foot stretcher"))!;
    expect(period).toMatchObject({ expectedReturn: "2026-11-05", until: null });
    expect(await outOfServiceForReport(form({ report: pelican.id }))).toEqual({ kind: "error", message: "Pelican is already out of service: Damage reported: The foot stretcher on the stroke side is loose." });
  });

  it("says how many bookings stay when there are some, and refuses a bad date", async () => {
    staff();
    // Heron has a sample booking tomorrow. File a report on it first, as staff would.
    const heron = (await state()).items.find((i) => i.name === "Heron")!;
    const filed = await fileDamageReport(h.store as ClubStore, { actor: { kind: "staff", label: "Alex Staffer" }, now: NOW }, DAMAGE_RULES, { itemId: heron.id, description: "Slide cracked.", major: true });
    expect(await outOfServiceForReport(form({ report: filed.id, expectedReturn: "soon" }))).toEqual({ kind: "error", message: "The expected return date must look like 2026-11-05." });
    expect(await outOfServiceForReport(form({ report: filed.id }))).toEqual({ kind: "ok", message: "Taken out of service. 1 upcoming booking stays; the Equipment page lists who to contact." });
  });

  it("refuses a boat that is already out of service for another reason", async () => {
    staff();
    const rigger = await report("Merganser");
    expect(await outOfServiceForReport(form({ report: rigger.id }))).toEqual({ kind: "error", message: "Merganser is already out of service: Rigger being repaired" });
  });
});

describe("closing a report", () => {
  it("marks it repaired with the hours and the cost read from what staff typed", async () => {
    staff();
    const pelican = await report("Pelican");
    const result = await repairedReport(form({ report: pelican.id, repairedOn: "2026-10-28", repairedBy: "Sam Shop", hours: "1.5", cost: "$12.50", notes: "Tightened it." }));
    expect(result).toEqual({ kind: "ok", message: "Marked as repaired." });
    expect(await report("Pelican")).toMatchObject({ status: "repaired", repairedOn: "2026-10-28", repairedBy: "Sam Shop", repairMinutes: 90, costCents: 1250, repairNotes: "Tightened it." });
  });

  it("brings the boat back into service when asked, and says another major report is still open", async () => {
    staff();
    const rigger = await report("Merganser");
    const merganser = (await state()).items.find((i) => i.name === "Merganser")!;
    await fileDamageReport(h.store as ClubStore, { actor: { kind: "staff", label: "Alex Staffer" }, now: NOW }, DAMAGE_RULES, { itemId: merganser.id, description: "Seat broke too.", major: true });
    const result = await repairedReport(form({ report: rigger.id, repairedOn: "2026-10-28", repairedBy: "Sam", returnToService: "on" }));
    expect(result).toEqual({ kind: "ok", message: "Marked as repaired. The boat is back in service. 1 other major report is still open on it." });
    const stillOut = (await state()).outOfService.find((p) => p.reason === "Rigger being repaired")!;
    expect(stillOut.until).toBe(NOW.toISOString());
  });

  it("reads the boxes carefully: bad hours, a bad cost, a missing person and a bad date are each told in words, and nothing is saved", async () => {
    staff();
    const pelican = await report("Pelican");
    const base = { report: pelican.id, repairedOn: "2026-10-28", repairedBy: "Sam" };
    expect(await repairedReport(form({ ...base, hours: "a lot" }))).toEqual({ kind: "error", message: "Hours spent should be a number like 1.5." });
    expect(await repairedReport(form({ ...base, cost: "cheap" }))).toEqual({ kind: "error", message: "The cost should be a number of dollars like 12.50." });
    expect(await repairedReport(form({ ...base, repairedBy: "" }))).toEqual({ kind: "error", message: "Say who did the repair." });
    expect(await repairedReport(form({ ...base, repairedOn: "yesterday" }))).toEqual({ kind: "error", message: "The repair date is not a real date. Use a day like 2026-11-05." });
    expect(await repairedReport(form({ ...base, repairedOn: "2026-10-29" }))).toEqual({ kind: "error", message: "The repair date cannot be in the future." });
    expect(await repairedReport(form({ repairedOn: "2026-10-28", repairedBy: "Sam" }))).toEqual({ kind: "error", message: "Choose the report." });
    expect((await report("Pelican")).status).toBe("open");
  });

  it("dismisses a report with a reason, and refuses an empty reason or a report that is already closed", async () => {
    staff();
    const pelican = await report("Pelican");
    expect(await dismissReport(form({ report: pelican.id, reason: "  " }))).toEqual({ kind: "error", message: "Say why the report is being dismissed." });
    expect(await dismissReport(form({ report: pelican.id, reason: "Duplicate of the one on Loon." }))).toEqual({ kind: "ok", message: "Report dismissed." });
    expect(await report("Pelican")).toMatchObject({ status: "dismissed", dismissedReason: "Duplicate of the one on Loon." });
    expect(await dismissReport(form({ report: pelican.id, reason: "Again." }))).toEqual({ kind: "error", message: "That report is already dismissed, so it cannot change. If the damage is back, file a new report." });
    expect(await dismissReport(form({ reason: "x" }))).toEqual({ kind: "error", message: "Choose the report." });
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    staff();
    const pelican = await report("Pelican");
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(startReport(form({ report: pelican.id }))).rejects.toThrow("the database is down");
  });
});
