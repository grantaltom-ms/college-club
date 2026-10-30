import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The "Report damage" buttons, called directly with who is signed in, whether the member area is on, and the club's records
 * replaced by the invented sample. What matters about them lives in the actions: anyone signed in may file a report (members and
 * staff), nobody else gets "page not found" before the form is read, the engine decides what each person may do, and a refusal
 * comes back in plain words.
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

import { addDamageNoteAction, fileDamage } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const member = async (name: string) => (await state()).members.find((m) => fullName(m) === name)!;
const boat = async (name: string) => (await state()).items.find((i) => i.name === name)!;
const signedInAs = async (name: string) => {
  const m = await member(name);
  h.actor = { kind: "member", label: name, member: { id: m.id }, source: "login" };
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

describe("the damage report actions: who may use them", () => {
  it("answer 'not found' when the member area is off or nobody is signed in, and change nothing", async () => {
    const heron = await boat("Heron");
    const fields = form({ item: heron.id, description: "Seat sticks.", severity: "minor" });
    const before = (await state()).damageReports.length;
    await signedInAs("Alex Brooks");
    h.enabled = false;
    await expect(fileDamage(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(addDamageNoteAction(form({ report: "x", text: "Hi." }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(fileDamage(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(addDamageNoteAction(form({ report: "x", text: "Hi." }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await state()).damageReports).toHaveLength(before);
  });

  it("let staff file a report too, under their own name", async () => {
    staff();
    const heron = await boat("Heron");
    expect(await fileDamage(form({ item: heron.id, description: "Seat sticks.", severity: "minor" }))).toMatchObject({ kind: "ok" });
    expect((await state()).damageReports.at(-1)!.reportedBy).toEqual({ kind: "staff", label: "Alex Staffer" });
  });
});

describe("filing a report", () => {
  it("asks for a boat and for major or minor", async () => {
    await signedInAs("Alex Brooks");
    expect(await fileDamage(form({ description: "x", severity: "minor" }))).toEqual({ kind: "error", message: "Choose the boat or space." });
    const heron = await boat("Heron");
    expect(await fileDamage(form({ item: heron.id, description: "x" }))).toEqual({ kind: "error", message: "Say whether the damage is major or minor." });
    expect(await fileDamage(form({ item: heron.id, description: "x", severity: "huge" }))).toEqual({ kind: "error", message: "Say whether the damage is major or minor." });
  });

  it("files a minor report and says so in words", async () => {
    await signedInAs("Alex Brooks");
    const heron = await boat("Heron");
    const result = await fileDamage(form({ item: heron.id, description: "  The seat sticks. ", location: "Bow seat", how: "Grit.", severity: "minor" }));
    expect(result).toEqual({ kind: "ok", message: "Thank you. Your report on Heron is filed. Club staff will see it." });
    const saved = (await state()).damageReports.at(-1)!;
    expect(saved).toMatchObject({ itemId: heron.id, description: "The seat sticks.", location: "Bow seat", howItHappened: "Grit.", major: false, priority: 3, status: "open", reportedBy: { kind: "member", label: "Alex Brooks" } });
  });

  it("files a major report and says staff will look at it first", async () => {
    await signedInAs("Alex Brooks");
    const loon = await boat("Loon");
    expect(await fileDamage(form({ item: loon.id, description: "Rigger bent.", severity: "major" }))).toEqual({ kind: "ok", message: "Thank you. Your report on Loon is filed. You marked it major, so club staff will look at it first." });
    expect((await state()).damageReports.at(-1)).toMatchObject({ major: true, priority: 1 });
  });

  it("passes the engine's refusals on in plain words and saves nothing", async () => {
    await signedInAs("Alex Brooks");
    const heron = await boat("Heron");
    const before = (await state()).damageReports.length;
    expect(await fileDamage(form({ item: heron.id, description: "   ", severity: "minor" }))).toEqual({ kind: "error", message: "Say what is wrong with it." });
    expect(await fileDamage(form({ item: heron.id, description: "x".repeat(2000), severity: "minor" }))).toEqual({ kind: "error", message: "What is wrong must be 300 characters or fewer. It is 2000." });
    expect(await fileDamage(form({ item: "00000000-0000-4000-8000-0000000000ff", description: "Broken.", severity: "minor" }))).toEqual({ kind: "error", message: "That boat or space no longer exists." });
    // Kestrel is Nora Abernathy's private boat: Alex Brooks is not on its list, so it does not exist for them.
    const kestrel = await boat("Kestrel");
    expect(await fileDamage(form({ item: kestrel.id, description: "Broken.", severity: "minor" }))).toEqual({ kind: "error", message: "That boat or space no longer exists." });
    expect((await state()).damageReports).toHaveLength(before);
  });

  it("stops a member at the daily limit with the words the engine gives", async () => {
    await signedInAs("Alex Brooks");
    const heron = await boat("Heron");
    for (let n = 0; n < 10; n++) expect((await fileDamage(form({ item: heron.id, description: `Problem ${n}.`, severity: "minor" }))).kind).toBe("ok");
    expect(await fileDamage(form({ item: heron.id, description: "One more.", severity: "minor" }))).toEqual({
      kind: "error",
      message: "You have already filed 10 reports in the last 24 hours, which is the most we take from one person. If something else is broken, please tell club staff.",
    });
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    await signedInAs("Alex Brooks");
    const heron = await boat("Heron");
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(fileDamage(form({ item: heron.id, description: "Broken.", severity: "minor" }))).rejects.toThrow("the database is down");
  });
});

describe("adding a note", () => {
  it("lets the person who filed it add one, and says so", async () => {
    await signedInAs("Maren Lindqvist");
    const report = (await state()).damageReports.find((r) => r.description.startsWith("The foot stretcher"))!;
    expect(await addDamageNoteAction(form({ report: report.id, text: " It is worse today. " }))).toEqual({ kind: "ok", message: "Note added." });
    expect((await state()).damageLog.at(-1)).toMatchObject({ reportId: report.id, kind: "note", text: "It is worse today.", by: { kind: "member", label: "Maren Lindqvist" } });
  });

  it("asks which report, refuses another member in words that hide the report, and refuses an empty note", async () => {
    const report = (await state()).damageReports.find((r) => r.description.startsWith("The foot stretcher"))!;
    await signedInAs("Alex Brooks");
    expect(await addDamageNoteAction(form({ text: "Hi." }))).toEqual({ kind: "error", message: "Choose the report." });
    expect(await addDamageNoteAction(form({ report: report.id, text: "Me too." }))).toEqual({ kind: "error", message: "That damage report no longer exists." });
    await signedInAs("Maren Lindqvist");
    expect(await addDamageNoteAction(form({ report: report.id, text: "   " }))).toEqual({ kind: "error", message: "Write the note first." });
  });

  it("lets staff add a note to a closed report, and not the person who filed it", async () => {
    const closed = (await state()).damageReports.find((r) => r.status === "repaired")!;
    await signedInAs("Sasha Bellweather");
    expect((await addDamageNoteAction(form({ report: closed.id, text: "Thanks." }))).kind).toBe("error");
    staff();
    expect(await addDamageNoteAction(form({ report: closed.id, text: "Checked the seat again." }))).toEqual({ kind: "ok", message: "Note added." });
  });
});
