import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeAccess } from "@/club/engine/boat-access";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * "My boats" buttons, called directly with who is signed in, whether the member area is on, and the club's records replaced by
 * the invented sample. What matters about them lives in the actions: a signed-in member only (anyone else gets "page not
 * found" before the form is read), the engine decides whether that member is an owner, and a refusal comes back in plain words.
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

import { inviteToMyBoat, removeFromMyBoat } from "./actions";

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

beforeEach(async () => {
  h.enabled = true;
  h.actor = null;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the My boats actions: who may use them", () => {
  it("answer 'not found' when the member area is off, when nobody is signed in, and for staff, and change nothing", async () => {
    const kestrel = await boat("Kestrel");
    const walter = await member("Walter Pemberton");
    const fields = form({ boat: kestrel.id, member: walter.id });
    const before = (await state()).boatAccess.length;
    await signedInAs("Nora Abernathy");
    h.enabled = false;
    await expect(inviteToMyBoat(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(inviteToMyBoat(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(removeFromMyBoat(form({ access: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = { kind: "staff", label: "Alex Staffer", source: "login" };
    await expect(inviteToMyBoat(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(removeFromMyBoat(form({ access: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await state()).boatAccess).toHaveLength(before);
  });
});

describe("inviting from My boats", () => {
  it("asks for a boat and a person", async () => {
    await signedInAs("Nora Abernathy");
    expect(await inviteToMyBoat(form({}))).toEqual({ kind: "error", message: "Choose a boat and a person." });
    expect(await inviteToMyBoat(form({ boat: (await boat("Kestrel")).id }))).toEqual({ kind: "error", message: "Choose a boat and a person." });
  });

  it("lets an owner invite a member, at once, and says so in words", async () => {
    await signedInAs("Nora Abernathy");
    const kestrel = await boat("Kestrel");
    const walter = await member("Walter Pemberton");
    expect(await inviteToMyBoat(form({ boat: kestrel.id, member: walter.id }))).toEqual({ kind: "ok", message: "Walter Pemberton can now book and crew Kestrel." });
    const line = activeAccess(await state(), kestrel.id).find((a) => a.memberId === walter.id)!;
    expect(line).toMatchObject({ kind: "invited", addedBy: { kind: "member", label: "Nora Abernathy" } });
    expect(await inviteToMyBoat(form({ boat: kestrel.id, member: walter.id }))).toEqual({ kind: "error", message: "Walter Pemberton is already invited to Kestrel." });
  });

  it("refuses a member who is not an owner, one who is only invited, and a club boat, in words", async () => {
    const kestrel = await boat("Kestrel");
    const walter = await member("Walter Pemberton");
    await signedInAs("Walter Pemberton");
    expect(await inviteToMyBoat(form({ boat: kestrel.id, member: walter.id }))).toEqual({ kind: "error", message: "Only an owner of Kestrel, or club staff, can invite people to it." });
    await signedInAs("Tomas Vandermeer");
    expect(await inviteToMyBoat(form({ boat: kestrel.id, member: walter.id }))).toEqual({ kind: "error", message: "Only an owner of Kestrel, or club staff, can invite people to it." });
    await signedInAs("Nora Abernathy");
    expect(await inviteToMyBoat(form({ boat: (await boat("Heron")).id, member: walter.id }))).toEqual({ kind: "error", message: "Heron is a club boat, not a private one, so it has no list of owners." });
    expect(activeAccess(await state(), kestrel.id).map((a) => a.kind)).toEqual(["owner", "invited"]);
  });
});

describe("taking someone off from My boats", () => {
  it("lets an owner take off someone they invited, and says what happened", async () => {
    await signedInAs("Nora Abernathy");
    const kestrel = await boat("Kestrel");
    const tomas = await member("Tomas Vandermeer");
    const line = activeAccess(await state(), kestrel.id).find((a) => a.memberId === tomas.id)!;
    expect(await removeFromMyBoat(form({ access: line.id }))).toEqual({ kind: "ok", message: "Tomas Vandermeer is off Kestrel." });
    expect(activeAccess(await state(), kestrel.id).map((a) => a.memberId)).not.toContain(tomas.id);
    expect(await removeFromMyBoat(form({ access: line.id }))).toEqual({ kind: "error", message: "That person is already off the boat's list." });
  });

  it("will not let an owner take off an owner, or anyone else take anyone off, and asks who to take off", async () => {
    const kestrel = await boat("Kestrel");
    const lines = activeAccess(await state(), kestrel.id);
    const owner = lines.find((a) => a.kind === "owner")!;
    const invited = lines.find((a) => a.kind === "invited")!;
    await signedInAs("Nora Abernathy");
    expect(await removeFromMyBoat(form({ access: owner.id }))).toEqual({ kind: "error", message: "Nora Abernathy is an owner of Kestrel. Only club staff can change the owners." });
    expect(await removeFromMyBoat(form({}))).toEqual({ kind: "error", message: "Choose who to take off." });
    await signedInAs("Walter Pemberton");
    expect(await removeFromMyBoat(form({ access: invited.id }))).toEqual({ kind: "error", message: "Only an owner of Kestrel, or club staff, can take people off it." });
    expect(activeAccess(await state(), kestrel.id)).toHaveLength(2);
  });

  it("passes on a failure it does not understand instead of hiding it", async () => {
    await signedInAs("Nora Abernathy");
    const kestrel = await boat("Kestrel");
    (h.store as ClubStore).transaction = async () => {
      throw new Error("the database is down");
    };
    await expect(inviteToMyBoat(form({ boat: kestrel.id, member: (await member("Walter Pemberton")).id }))).rejects.toThrow("the database is down");
  });
});
