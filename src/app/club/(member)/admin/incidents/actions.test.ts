import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The staff buttons on an incident report (record what was found, close it), called directly with who is signed in, whether the
 * member area is on, and the club's records replaced by the invented sample. Staff only: a coach (even the one who filed the
 * report), a member, nobody and the live site get "page not found" before the form is read; the engine's words come back as they
 * are.
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

import { closeIncidentAction, reviewIncidentAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const member = async (name: string) => (await state()).members.find((m) => fullName(m) === name)!;
const staff = () => {
  h.actor = { kind: "staff", label: "Alex Staffer", source: "login" };
};
/** The sample's open dock incident: filed by staff, not yet reviewed. */
const openUnreviewed = async () => (await state()).incidents.find((i) => i.status === "open" && i.cause === null)!;

beforeEach(async () => {
  h.enabled = true;
  h.actor = null;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the staff incident buttons: who may use them", () => {
  it("answer 'not found' for the live site, nobody, a member and a coach, and change nothing", async () => {
    const incident = await openUnreviewed();
    const review = form({ incident: incident.id, cause: "A gust.", change: "", followUpBy: "", damage: "" });
    const close = form({ incident: incident.id, outcome: "Done." });
    const before = JSON.stringify((await state()).incidents);
    const attempts = async () => {
      await expect(reviewIncidentAction(review)).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(closeIncidentAction(close)).rejects.toThrow("NEXT_NOT_FOUND");
    };
    staff();
    h.enabled = false;
    await attempts();
    h.enabled = true;
    h.actor = null;
    await attempts();
    const alex = await member("Alex Brooks");
    h.actor = { kind: "member", label: "Alex Brooks", member: { id: alex.id }, source: "login" };
    await attempts();
    const kenji = await member("Kenji Tanaka");
    h.actor = { kind: "member", label: "Kenji Tanaka", member: { id: kenji.id }, source: "login" };
    await attempts();
    expect(JSON.stringify((await state()).incidents)).toBe(before);
  });
});

describe("recording what was found", () => {
  it("saves the cause, what will change, who is following up and the damage report, and says so", async () => {
    staff();
    const incident = await openUnreviewed();
    const damage = (await state()).damageReports[0];
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "  A gust.  ", change: "Wind check before launch.", followUpBy: "Safety officer", damage: damage.id }))).toEqual({ kind: "ok", message: "Saved." });
    expect((await state()).incidents.find((i) => i.id === incident.id)).toMatchObject({ cause: "A gust.", whatWillChange: "Wind check before launch.", followUpBy: "Safety officer", damageReportId: damage.id });
    // An empty damage box removes the link; the other boxes stay as they were.
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "A gust.", change: "Wind check before launch.", followUpBy: "Safety officer", damage: "" }))).toEqual({ kind: "ok", message: "Saved." });
    expect((await state()).incidents.find((i) => i.id === incident.id)).toMatchObject({ cause: "A gust.", damageReportId: null });
  });

  it("asks for the report, refuses a save that changes nothing, and passes the engine's words on", async () => {
    staff();
    expect(await reviewIncidentAction(form({ cause: "x" }))).toEqual({ kind: "error", message: "Choose the report." });
    const incident = await openUnreviewed();
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "", change: "", followUpBy: "", damage: "" }))).toEqual({ kind: "error", message: "Nothing was changed: what you gave is what the report already says." });
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "c".repeat(1001) }))).toEqual({ kind: "error", message: "The cause must be 1000 characters or fewer. It is 1001." });
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "x", damage: "00000000-0000-4000-8000-0000000000ff" }))).toEqual({ kind: "error", message: "That damage report no longer exists." });
    expect((await state()).incidents.find((i) => i.id === incident.id)!.cause).toBeNull();
  });
});

describe("closing a report", () => {
  it("closes it with what was done, and then nothing more can be done to it", async () => {
    staff();
    const incident = await openUnreviewed();
    expect(await closeIncidentAction(form({ incident: incident.id, outcome: "  Rules posted. " }))).toEqual({ kind: "ok", message: "Report closed." });
    expect((await state()).incidents.find((i) => i.id === incident.id)).toMatchObject({ status: "closed", closedNote: "Rules posted." });
    const frozen = { kind: "error", message: "That report is already closed, so it cannot change. If something has come back, file a new report." };
    expect(await closeIncidentAction(form({ incident: incident.id, outcome: "Again." }))).toEqual(frozen);
    expect(await reviewIncidentAction(form({ incident: incident.id, cause: "Late." }))).toEqual(frozen);
  });

  it("asks for the report and for an outcome", async () => {
    staff();
    expect(await closeIncidentAction(form({ outcome: "Done." }))).toEqual({ kind: "error", message: "Choose the report." });
    const incident = await openUnreviewed();
    expect(await closeIncidentAction(form({ incident: incident.id, outcome: "  " }))).toEqual({ kind: "error", message: "Say what was done, or why nothing more is needed." });
    expect((await state()).incidents.find((i) => i.id === incident.id)!.status).toBe("open");
  });
});
