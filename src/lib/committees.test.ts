import { describe, expect, it } from "vitest";
import { COMMITTEES, committeeBySlug, committeePath } from "./committees";

describe("committee pages", () => {
  it("are the Boathouse, Membership and Social committees, at their own addresses", () => {
    expect(COMMITTEES.map((c) => c.slug)).toEqual(["boathouse", "membership", "social"]);
    expect(COMMITTEES.map((c) => committeePath(c.slug))).toEqual(["/committees/boathouse", "/committees/membership", "/committees/social"]);
    expect(committeeBySlug("social")?.name).toBe("Social Committee");
    expect(committeeBySlug("house")).toBeUndefined();
  });

  it("hold the sections Grant agreed, each committee's own first and the shared ones after", () => {
    const keys = Object.fromEntries(COMMITTEES.map((c) => [c.slug, c.sections.map((s) => s.key)]));
    expect(keys).toEqual({
      boathouse: ["shells", "reservations", "timing", "visits"],
      membership: ["summary", "membership", "visits", "timing", "email"],
      social: ["events", "email", "timing", "visits"],
    });
    for (const c of COMMITTEES) {
      const firstShared = c.sections.findIndex((s) => s.shared);
      expect(c.sections.slice(firstShared).every((s) => s.shared), c.slug).toBe(true);
      expect(firstShared, c.slug).toBeGreaterThan(0);
    }
  });

  it("call a section shared exactly when another committee shows it too", () => {
    const count = new Map<string, number>();
    for (const c of COMMITTEES) for (const s of c.sections) count.set(s.key, (count.get(s.key) ?? 0) + 1);
    for (const c of COMMITTEES) {
      for (const s of c.sections) expect(s.shared, `${c.slug} ${s.key}`).toBe((count.get(s.key) ?? 0) > 1);
    }
  });

  it("never show Financials or Goals, and give every section a heading and a reason", () => {
    for (const c of COMMITTEES) {
      expect(c.sections.map((s) => s.key)).not.toContain("financials");
      expect(c.sections.map((s) => s.key)).not.toContain("goals");
      for (const s of c.sections) {
        expect(s.heading.length).toBeGreaterThan(2);
        expect(s.why).toMatch(/^[A-Z].{20,200}\.$/);
      }
      expect(new Set(c.sections.map((s) => s.key)).size).toBe(c.sections.length);
    }
  });
});
