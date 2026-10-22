import { describe, expect, it } from "vitest";
import { canViewHousehold, parseActorCookie, resolveActor, toEngineActor } from "./identity";
import { buildSampleStore } from "./sample/club";

describe("parseActorCookie", () => {
  it("reads the two values the picker stores and nothing else", () => {
    expect(parseActorCookie("staff")).toEqual({ kind: "staff" });
    expect(parseActorCookie("member:00000000-0000-4000-8000-000000000002")).toEqual({ kind: "member", memberId: "00000000-0000-4000-8000-000000000002" });
    for (const bad of [undefined, "", "admin", "member:", "member:abc", "member:../../etc", "staff ", "MEMBER:00000000-0000-4000-8000-000000000002"]) {
      expect(parseActorCookie(bad), String(bad)).toBeNull();
    }
  });
});

describe("resolveActor", () => {
  it("finds the member and their household, or staff, or nobody", async () => {
    const store = await buildSampleStore("2026-10-22");
    const state = await store.read();
    const erik = state.members.find((m) => m.firstName === "Erik")!;
    const current = await resolveActor(store, `member:${erik.id}`);
    expect(current).toMatchObject({ kind: "member", member: { firstName: "Erik" }, household: { displayName: "The Lindqvist household" } });
    expect(await resolveActor(store, "staff")).toEqual({ kind: "staff", label: "Test staff" });
    expect(await resolveActor(store, undefined)).toBeNull();
    expect(await resolveActor(store, "member:11111111-1111-4111-8111-111111111111")).toBeNull();
  });

  it("still finds a member whose household ended, so their blocked state can be seen", async () => {
    const store = await buildSampleStore("2026-10-22");
    const state = await store.read();
    const colm = state.members.find((m) => m.firstName === "Colm")!;
    expect(await resolveActor(store, `member:${colm.id}`)).toMatchObject({ kind: "member", household: { status: "ended" } });
  });
});

describe("who can see a household", () => {
  it("staff see all, a member sees only their own, nobody sees none", async () => {
    const store = await buildSampleStore("2026-10-22");
    const state = await store.read();
    const [a, b] = state.households;
    const member = state.members.find((m) => m.householdId === a.id)!;
    const asMember = await resolveActor(store, `member:${member.id}`);
    const asStaff = await resolveActor(store, "staff");
    expect(canViewHousehold(asStaff, a.id) && canViewHousehold(asStaff, b.id)).toBe(true);
    expect(canViewHousehold(asMember, a.id)).toBe(true);
    expect(canViewHousehold(asMember, b.id)).toBe(false);
    expect(canViewHousehold(null, a.id)).toBe(false);
  });

  it("records a member by name and staff by label in the household file", async () => {
    const store = await buildSampleStore("2026-10-22");
    const state = await store.read();
    const m = state.members[0];
    expect(toEngineActor((await resolveActor(store, `member:${m.id}`))!)).toEqual({ kind: "member", memberId: m.id, label: `${m.firstName} ${m.lastName}` });
    expect(toEngineActor((await resolveActor(store, "staff"))!)).toEqual({ kind: "staff", label: "Test staff" });
  });
});
