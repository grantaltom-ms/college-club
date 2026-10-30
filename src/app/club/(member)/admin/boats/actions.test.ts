import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeAccess, boatLocked } from "@/club/engine/boat-access";
import { fullName } from "@/club/engine/queries";
import { buildSampleStore } from "@/club/sample/club";
import type { ClubStore } from "@/club/store/memory";
import type { ClubState } from "@/club/types";

/**
 * The staff Private boats buttons, called directly with who is signed in, whether the member area is on, and the club's records
 * replaced by the invented sample: staff only (anyone else gets "page not found" before the form is read), plain words for a
 * refusal, and nothing saved when something is wrong.
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
  toEngineActor: (a: { kind: string; label: string }) => ({ kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => h.store }));

import { inviteAsStaff, makeOwner, takeOffBoat } from "./actions";

const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const state = (): Promise<ClubState> => (h.store as ClubStore).read();
const member = async (name: string) => (await state()).members.find((m) => fullName(m) === name)!;
const boat = async (name: string) => (await state()).items.find((i) => i.name === name)!;

beforeEach(async () => {
  h.enabled = true;
  h.actor = STAFF;
  h.now = NOW;
  h.store = await buildSampleStore("2026-10-28", NOW);
});

describe("the Private boats actions: who may use them", () => {
  it("answer 'not found' when the member area is off, when nobody is signed in, and for a member, and save nothing", async () => {
    const wren = await boat("Wren");
    const dee = await member("Nora Abernathy");
    const fields = form({ boat: wren.id, member: dee.id });
    const before = (await state()).boatAccess.length;
    h.enabled = false;
    for (const act of [makeOwner, inviteAsStaff]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(takeOffBoat(form({ access: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    for (const act of [makeOwner, inviteAsStaff]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(takeOffBoat(form({ access: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = { kind: "member", label: "Nora Abernathy", member: { id: dee.id }, source: "login" };
    for (const act of [makeOwner, inviteAsStaff]) await expect(act(fields)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(takeOffBoat(form({ access: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await state()).boatAccess).toHaveLength(before);
  });
});

describe("naming owners and inviting as staff", () => {
  it("asks for a boat and a person", async () => {
    for (const act of [makeOwner, inviteAsStaff]) expect(await act(form({}))).toEqual({ kind: "error", message: "Choose a boat and a person." });
  });

  it("makes someone an owner of a locked boat, and the boat is unlocked", async () => {
    const wren = await boat("Wren");
    expect(boatLocked(await state(), wren)).toBe(true);
    const walter = await member("Walter Pemberton");
    expect(await makeOwner(form({ boat: wren.id, member: walter.id }))).toEqual({ kind: "ok", message: "Walter Pemberton is now an owner of Wren." });
    expect(boatLocked(await state(), wren)).toBe(false);
    expect(await makeOwner(form({ boat: wren.id, member: walter.id }))).toEqual({ kind: "error", message: "Walter Pemberton is already an owner of Wren." });
  });

  it("invites someone on an owner's behalf, in words, and refuses a club boat", async () => {
    const kestrel = await boat("Kestrel");
    const walter = await member("Walter Pemberton");
    expect(await inviteAsStaff(form({ boat: kestrel.id, member: walter.id }))).toEqual({ kind: "ok", message: "Walter Pemberton can now book and crew Kestrel." });
    expect(activeAccess(await state(), kestrel.id).find((a) => a.memberId === walter.id)).toMatchObject({ kind: "invited", addedBy: { kind: "staff", label: "Alex Staffer" } });
    expect(await makeOwner(form({ boat: (await boat("Heron")).id, member: walter.id }))).toEqual({ kind: "error", message: "Heron is a club boat, not a private one, so it has no list of owners." });
  });
});

describe("taking someone off as staff", () => {
  it("takes an owner off, locks the boat when it was the last, and says what happened", async () => {
    const kestrel = await boat("Kestrel");
    const nora = await member("Nora Abernathy");
    const line = activeAccess(await state(), kestrel.id).find((a) => a.memberId === nora.id)!;
    expect(await takeOffBoat(form({ access: line.id }))).toEqual({ kind: "ok", message: "Nora Abernathy is off Kestrel." });
    expect(boatLocked(await state(), kestrel)).toBe(true);
    expect(await takeOffBoat(form({ access: line.id }))).toEqual({ kind: "error", message: "That person is already off the boat's list." });
    expect(await takeOffBoat(form({}))).toEqual({ kind: "error", message: "Choose who to take off." });
  });
});
