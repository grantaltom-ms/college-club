import { describe, expect, it } from "vitest";
import { blockReasonFor, meetsQualification } from "../engine/eligibility";
import { historyOf, membersOf, qualificationsOf } from "../engine/queries";
import { buildSampleStore } from "./club";

const TODAY = "2026-10-22";

describe("the sample club", () => {
  it("has about 14 households covering every case the rules need", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    const sizes = (status: string) =>
      state.households.filter((h) => h.status === status).map((h) => state.members.filter((m) => m.householdId === h.id && m.status !== "removed").length);
    expect(state.households).toHaveLength(14);
    // A single adult, couples and a three-adult household.
    expect(new Set(sizes("active"))).toEqual(new Set([1, 2, 3]));
    // Every membership type.
    expect(new Set(state.households.map((h) => h.membershipType))).toEqual(new Set(["Resident", "Intermediate", "Non-Resident"]));
    // Exactly one ended household, with an end date; everyone else has none.
    const ended = state.households.filter((h) => h.status === "ended");
    expect(ended).toHaveLength(1);
    expect(ended[0].endedOn).toBe("2026-10-01");
    expect(state.households.filter((h) => h.status === "active").every((h) => h.endedOn === null)).toBe(true);
    // Exactly one household joined this month.
    expect(state.households.filter((h) => h.joinedOn.startsWith("2026-10"))).toHaveLength(1);
  });

  it("has members with and without rowing qualifications, at different levels", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    const withQuals = state.members.filter((m) => qualificationsOf(state, m.id).length > 0);
    expect(withQuals.length).toBeGreaterThan(0);
    expect(withQuals.length).toBeLessThan(state.members.length);
    expect(new Set(state.memberQualifications.map((q) => q.code))).toEqual(new Set(["scull-1", "scull-2", "scull-3", "sweep"]));
    expect(state.memberQualifications.every((q) => q.grantedBy.kind === "staff")).toBe(true);
    // A ready-made crew for a double: two active adults in one household, both level 2 or better.
    const crew = state.households.filter((h) => h.status === "active").some((h) => {
      const adults = membersOf(state, h.id).filter((m) => m.status === "active");
      return adults.length >= 2 && adults.filter((m) => meetsQualification(state, m.id, "scull-2")).length >= 2;
    });
    expect(crew).toBe(true);
  });

  it("has one pair of partners sharing an email address", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    const byEmail = new Map<string, number>();
    for (const m of state.members) byEmail.set(m.email, (byEmail.get(m.email) ?? 0) + 1);
    const shared = [...byEmail.entries()].filter(([, n]) => n > 1);
    expect(shared).toHaveLength(1);
    expect(shared[0][1]).toBe(2);
  });

  it("blocks everyone in the ended household and nobody else", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    const ended = state.households.find((h) => h.status === "ended")!;
    for (const m of state.members) {
      const reason = blockReasonFor(state, m.id);
      if (m.householdId === ended.id) expect(reason).toContain("ended on Oct 1, 2026");
      else expect(reason).toBeNull();
    }
  });

  it("gives every household a file that starts with joining and, for the ended one, finishes with the end", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    for (const h of state.households) {
      const history = historyOf(state, h.id);
      expect(history.at(-1)?.kind).toBe("joined");
      expect(history.every((e) => e.at >= history.at(-1)!.at)).toBe(true);
      expect(history[0].kind).toBe(h.status === "ended" ? "membership_ended" : history[0].kind);
    }
  });

  it("uses only invented contact details and distinct permanent IDs", async () => {
    const state = await (await buildSampleStore(TODAY)).read();
    expect(state.members.every((m) => m.email.endsWith("@example.com"))).toBe(true);
    expect(state.members.every((m) => /^206-555-01\d\d$/.test(m.phone))).toBe(true);
    const ids = [...state.households.map((h) => h.id), ...state.members.map((m) => m.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.members.every((m) => m.brivoCredentialId === null && m.mailchimpContactId === null && m.loginId === null)).toBe(true);
  });

  it("builds the same IDs every time, so test links stay put", async () => {
    const a = await (await buildSampleStore(TODAY)).read();
    const b = await (await buildSampleStore(TODAY)).read();
    expect(a.members.map((m) => m.id)).toEqual(b.members.map((m) => m.id));
  });

  it("puts the 'joined this month' household on the 1st of whatever month it is today", async () => {
    const state = await (await buildSampleStore("2027-02-03")).read();
    expect(state.households.filter((h) => h.joinedOn.startsWith("2027-02")).map((h) => h.joinedOn)).toEqual(["2027-02-01"]);
  });
});
