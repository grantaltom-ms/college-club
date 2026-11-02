import { describe, expect, it } from "vitest";
import { fixture } from "./engine/testkit";
import { demoMember } from "./start";
import type { ClubState, Member } from "./types";

/** The shared test club, copied so a test can change it freely. */
async function club(): Promise<ClubState> {
  const f = await fixture();
  return structuredClone(await f.store.read());
}

/** A copy of an existing active member under another name, in the same household, so every other rule stays satisfied. */
function nora(state: ClubState, over: Partial<Member> = {}): Member {
  const base = state.members.find((m) => m.status === "active")!;
  return { ...base, id: "00000000-0000-4000-8000-00000000a001", firstName: "Nora", lastName: "Abernathy", ...over };
}

describe("the member the test landing page signs in as", () => {
  it("is Nora Abernathy when she is an active member of an active household", async () => {
    const state = await club();
    state.members.push(nora(state));
    expect(demoMember(state)?.firstName).toBe("Nora");
    expect(demoMember(state)?.lastName).toBe("Abernathy");
  });

  it("is the first active member of an active household when she is not in the club", async () => {
    const state = await club();
    const first = state.members.find((m) => m.status === "active" && state.households.some((h) => h.id === m.householdId && h.status === "active"))!;
    expect(demoMember(state)?.id).toBe(first.id);
  });

  it("passes over Nora when she has left, and takes someone who is still here", async () => {
    const state = await club();
    state.members.unshift(nora(state, { status: "removed" }));
    const chosen = demoMember(state)!;
    expect(chosen.lastName).not.toBe("Abernathy");
    expect(chosen.status).toBe("active");
  });

  it("passes over Nora when her household's membership ended", async () => {
    const state = await club();
    const ended = { ...state.households[0], id: "00000000-0000-4000-8000-00000000b001", status: "ended" as const, endedOn: "2026-09-01" };
    state.households.push(ended);
    state.members.unshift(nora(state, { householdId: ended.id }));
    expect(demoMember(state)?.lastName).not.toBe("Abernathy");
  });

  it("is nobody when no one in the club is active", async () => {
    const state = await club();
    state.members = state.members.map((m) => ({ ...m, status: "removed" as const }));
    expect(demoMember(state)).toBeNull();
    expect(demoMember({ ...state, members: [] })).toBeNull();
  });
});
