import { beforeEach, describe, expect, it, vi } from "vitest";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The "Report an incident" buttons, called directly with who is signed in, whether the member area is on, and the club's records
 * replaced by the invented sample. What matters about them lives in the actions: only staff and coaches file a report (everyone
 * else, nobody and the live site get "page not found" before the form is read), the people box is only for people who may file, the
 * form's boxes are read the way the form writes them, and a refusal comes back in the engine's own words, every reason at once.
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

import { addIncidentNoteAction, fileIncidentAction, searchIncidentPeople } from "./actions";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
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
/** A good form: yesterday, mid-morning, on the water, nobody named, no first aid, no emergency call. */
const good = (change: Record<string, string | string[]> = {}) => form({ day: "2026-10-27", time: "10:30", what: "A single capsized near the dock.", water: "yes", firstAid: "no", emergency: "no", ...change });

beforeEach(async () => {
  h.enabled = true;
  h.actor = null;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the incident report buttons: who may use them", () => {
  it("answer 'not found' when the member area is off or nobody is signed in, and change nothing", async () => {
    const before = (await state()).incidents.length;
    await signedInAs("Kenji Tanaka");
    h.enabled = false;
    await expect(fileIncidentAction(good())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(addIncidentNoteAction(form({ incident: "x", text: "Hi." }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(searchIncidentPeople("Quill", [])).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(fileIncidentAction(good())).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(addIncidentNoteAction(form({ incident: "x", text: "Hi." }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(searchIncidentPeople("Quill", [])).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await state()).incidents).toHaveLength(before);
  });

  it("let a coach and staff file, and turn an ordinary member away in the engine's words", async () => {
    const before = (await state()).incidents.length;
    await signedInAs("Alex Brooks");
    expect(await fileIncidentAction(good())).toEqual({ kind: "error", message: "Only club staff and coaches can file an incident report." });
    await signedInAs("Kenji Tanaka");
    expect(await fileIncidentAction(good())).toMatchObject({ kind: "ok" });
    staff();
    expect(await fileIncidentAction(good())).toMatchObject({ kind: "ok" });
    const added = (await state()).incidents.slice(before);
    expect(added.map((i) => i.reportedBy)).toEqual([{ kind: "member", memberId: (await member("Kenji Tanaka")).id, label: "Kenji Tanaka" }, { kind: "staff", label: "Alex Staffer" }]);
  });

  it("only answer the people box for someone who may file, so it cannot be used to browse the membership", async () => {
    await signedInAs("Alex Brooks");
    await expect(searchIncidentPeople("Abernathy", [])).rejects.toThrow("NEXT_NOT_FOUND");
    await signedInAs("Kenji Tanaka");
    expect((await searchIncidentPeople("Abernathy", [])).people.map((p) => p.name)).toEqual(["Nora Abernathy"]);
    staff();
    expect((await searchIncidentPeople("Abernathy", [])).people.map((p) => p.name)).toEqual(["Nora Abernathy"]);
  });
});

describe("filing a report from the form", () => {
  it("reads the day and time as Pacific, and the yes and no buttons", async () => {
    await signedInAs("Kenji Tanaka");
    const result = await fileIncidentAction(good({ day: "2026-10-27", time: "10:30", water: "no", firstAid: "yes", firstAidNotes: "Bandage.", emergency: "yes", emergencyNotes: "Fire dept", location: "East dock", conditions: "Calm" }));
    expect(result).toEqual({ kind: "ok", message: "Thank you. The report is filed. Club staff will see it." });
    expect((await state()).incidents.at(-1)).toMatchObject({
      occurredAt: "2026-10-27T17:30:00.000Z",
      onTheWater: false,
      firstAidGiven: true,
      firstAidNotes: "Bandage.",
      emergencyCalled: true,
      emergencyNotes: "Fire dept",
      location: "East dock",
      conditions: "Calm",
    });
  });

  it("reads each person row (a member from the list or a typed name, hurt, a parent told) and every boat, and says staff will look first when someone was hurt", async () => {
    await signedInAs("Kenji Tanaka");
    const nora = await member("Nora Abernathy");
    const heron = await boat("Heron");
    const loon = await boat("Loon");
    const result = await fileIncidentAction(
      good({
        people: "3",
        personMember0: nora.id,
        personName0: "",
        personHurt0: "on",
        personMember1: "",
        personName1: "Jordan Example",
        personParent1: "on",
        personMember2: "",
        personName2: "Pat Example",
        boat: [heron.id, "", loon.id],
      }),
    );
    expect(result).toEqual({ kind: "ok", message: "Thank you. The report is filed. Club staff will see it first because someone was hurt." });
    const s = await state();
    const saved = s.incidents.at(-1)!;
    expect(s.incidentPeople.filter((p) => p.incidentId === saved.id).map((p) => ({ memberId: p.memberId, name: p.name, injured: p.injured, parentTold: p.parentTold }))).toEqual([
      { memberId: nora.id, name: "Nora Abernathy", injured: true, parentTold: false },
      { memberId: null, name: "Jordan Example", injured: false, parentTold: true },
      { memberId: null, name: "Pat Example", injured: false, parentTold: false },
    ]);
    expect(s.incidentBoats.filter((b) => b.incidentId === saved.id).map((b) => b.itemId)).toEqual([heron.id, loon.id]);
  });

  it("asks for a real day and time before anything else", async () => {
    await signedInAs("Kenji Tanaka");
    const before = (await state()).incidents.length;
    expect(await fileIncidentAction(good({ day: "" }))).toEqual({ kind: "error", message: "Choose the day it happened." });
    expect(await fileIncidentAction(good({ day: "2026-13-40" }))).toEqual({ kind: "error", message: "Choose the day it happened." });
    expect(await fileIncidentAction(good({ time: "" }))).toEqual({ kind: "error", message: "Choose the time it happened." });
    expect(await fileIncidentAction(good({ time: "25:99" }))).toEqual({ kind: "error", message: "Choose the time it happened." });
    expect((await state()).incidents).toHaveLength(before);
  });

  it("passes every one of the engine's refusals on at once, in plain words, and saves nothing", async () => {
    await signedInAs("Kenji Tanaka");
    const before = (await state()).incidents.length;
    const result = await fileIncidentAction(form({ day: "2026-10-27", time: "10:30", what: "   " }));
    expect(result).toEqual({ kind: "error", message: "Say what happened. Say whether it happened on the water. Say whether first aid was given. Say whether emergency services were called." });
    expect(await fileIncidentAction(good({ firstAid: "no", firstAidNotes: "Bandage" }))).toEqual({ kind: "error", message: "Say that first aid was given, or clear the first aid notes." });
    expect(await fileIncidentAction(good({ day: "2026-10-29" }))).toEqual({ kind: "error", message: "That time is in the future. Say when it happened." });
    expect(await fileIncidentAction(good({ people: "1", personMember0: "", personName0: "" }))).toEqual({ kind: "error", message: "Each person needs a name." });
    expect((await state()).incidents).toHaveLength(before);
  });

  it("reads at most forty person rows, so a forged count cannot make it read forever, and the engine's own limit still refuses the report", async () => {
    await signedInAs("Kenji Tanaka");
    const fields: Record<string, string> = { people: "9999" };
    for (let i = 0; i < 60; i++) {
      fields[`personName${i}`] = `Guest ${i}`;
    }
    const result = await fileIncidentAction(good(fields));
    expect(result).toEqual({ kind: "error", message: "A report can name up to 20 people." });
  });
});

describe("notes", () => {
  it("let the coach who filed a report add to it, and tell anyone else it does not exist", async () => {
    const kenji = await member("Kenji Tanaka");
    const mine = (await state()).incidents.find((i) => i.reportedBy.kind === "member" && i.reportedBy.memberId === kenji.id && i.status === "open")!;
    await signedInAs("Kenji Tanaka");
    expect(await addIncidentNoteAction(form({ incident: mine.id, text: "  The boat is back on its rack. " }))).toEqual({ kind: "ok", message: "Note added." });
    expect((await state()).incidentLog.at(-1)).toMatchObject({ incidentId: mine.id, kind: "note", text: "The boat is back on its rack.", by: { kind: "member", label: "Kenji Tanaka" } });
    await signedInAs("Alex Brooks");
    expect(await addIncidentNoteAction(form({ incident: mine.id, text: "Hi." }))).toEqual({ kind: "error", message: "That incident report no longer exists." });
    staff();
    expect(await addIncidentNoteAction(form({ incident: mine.id, text: "Spoke to Kenji." }))).toEqual({ kind: "ok", message: "Note added." });
  });

  it("ask for the report and for words, and pass the engine's refusals on", async () => {
    staff();
    expect(await addIncidentNoteAction(form({ text: "Hi." }))).toEqual({ kind: "error", message: "Choose the report." });
    const some = (await state()).incidents[0];
    expect(await addIncidentNoteAction(form({ incident: some.id, text: "   " }))).toEqual({ kind: "error", message: "Write the note first." });
    expect(await addIncidentNoteAction(form({ incident: "00000000-0000-4000-8000-0000000000ff", text: "Hi." }))).toEqual({ kind: "error", message: "That incident report no longer exists." });
  });
});
