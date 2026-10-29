import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitTourRequest } from "@/club/engine/tours";
import { TOUR_RULES } from "@/club/settings/tour-rules";
import { MemoryTourStore } from "@/club/store/tours";

/**
 * The Tour requests screen's button, called directly with the page's own ingredients replaced by fakes: whether the member
 * area is on, who is signed in, and the list of requests. Staff only, one press marks one request, and a refusal comes back
 * in plain words.
 */
const NOW = new Date("2026-10-28T20:00:00Z");
const h = vi.hoisted(() => ({ enabled: true, actor: null as unknown, store: null as unknown }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/club/enabled", () => ({ clubEnabled: () => h.enabled }));
vi.mock("@/club/clock", () => ({ clubNow: () => NOW }));
vi.mock("@/club/identity", () => ({
  getCurrentActor: async () => h.actor,
  toEngineActor: (a: { kind: string; label: string }) => ({ kind: a.kind, label: a.label }),
}));
vi.mock("@/club/store/instance", () => ({ getClubStore: async () => ({}) }));
vi.mock("@/club/store/tours-instance", () => ({ getTourStore: () => h.store }));

import { markFollowedUp } from "./actions";

const STAFF = { kind: "staff", label: "Alex Staffer", source: "login" };
const MEMBER = { kind: "member", label: "Ann Number1" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
let id = "";

beforeEach(async () => {
  h.enabled = true;
  h.actor = STAFF;
  h.store = new MemoryTourStore();
  const result = await submitTourRequest(h.store as MemoryTourStore, TOUR_RULES, { name: "Ada Quill", email: "ada@example.com", phone: "", note: "", website: "" }, NOW);
  if (!result.ok || !result.request) throw new Error("expected a saved request");
  id = result.request.id;
});

describe("the Tour requests button", () => {
  it("answers 'not found' when the member area is off, when nobody is signed in, and for a member, and changes nothing", async () => {
    h.enabled = false;
    await expect(markFollowedUp(form({ id }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.enabled = true;
    h.actor = null;
    await expect(markFollowedUp(form({ id }))).rejects.toThrow("NEXT_NOT_FOUND");
    h.actor = MEMBER;
    await expect(markFollowedUp(form({ id }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect((await (h.store as MemoryTourStore).list(10)).newCount).toBe(1);
  });

  it("marks the request, says whose it was, and keeps the staff member's name", async () => {
    expect(await markFollowedUp(form({ id }))).toEqual({ kind: "ok", message: "Ada Quill is marked as followed up." });
    expect((await (h.store as MemoryTourStore).list(10)).items[0]).toMatchObject({ status: "followed_up", followedUpBy: "Alex Staffer", followedUpAt: NOW.toISOString() });
  });

  it("says plainly when it was already marked, or cannot be found, or no request was named", async () => {
    await markFollowedUp(form({ id }));
    expect(await markFollowedUp(form({ id }))).toEqual({ kind: "error", message: "That request was already marked as followed up." });
    expect(await markFollowedUp(form({ id: "00000000-0000-4000-8000-000000000000" }))).toEqual({ kind: "error", message: "That tour request could not be found." });
    expect(await markFollowedUp(form({}))).toEqual({ kind: "error", message: "That tour request could not be found." });
    expect(await markFollowedUp(form({ id: "'; drop table x; --" }))).toEqual({ kind: "error", message: "That tour request could not be found." });
  });
});
