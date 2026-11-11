import { describe, expect, it } from "vitest";
import { rowingOutlook, usageOutlook, waitlistOutlook } from "./executive";
import { membershipSeedData } from "./membership-seed.testkit";
import { sampleData } from "./sample";
import type { Outing } from "./shells";
import type { MembershipMonth } from "./types";

const month = (year: number, m: number, resignations: number, waitlist: number | null, withApprovals = 500): MembershipMonth => ({
  year,
  month: m,
  previousTotal: withApprovals,
  resignations,
  applicants: resignations,
  transferred: 0,
  withApprovals,
  waitlist,
  resignationsMoved: null,
  resignationsNotUsing: null,
  resignationsOther: null,
  catResident: null,
  catIntermediate: null,
  catNonResident: null,
  catSuburban: null,
  catHonorary: null,
  totalAllCategories: null,
  note: null,
});

describe("the waitlist outlook", () => {
  it("reads the club's real 28 months the way the page states them", () => {
    const o = waitlistOutlook(membershipSeedData().months)!;
    expect(o.now).toEqual({ label: "Oct 2026", waitlist: 16 });
    expect(o.yearAgo).toEqual({ label: "Oct 2025", waitlist: 34 });
    expect(o.twoYearsAgo).toEqual({ label: "Oct 2024", waitlist: 50 });
    expect(o.resignations12).toBe(71);
    expect(o.monthsCounted).toBe(12);
    expect(o.perMonth).toBe(5.9);
    expect(o.monthsOfCover).toBe(2.7);
    expect(o.lastWinter).toEqual({ label: "Nov 2025 – Feb 2026", resignations: 29 });
    expect(o.members).toBe(506);
    expect(o.membersLabel).toBe("Oct 2026");
  });

  it("uses the newest month that has a waitlist count, in any order, and skips comparisons it does not have", () => {
    const o = waitlistOutlook([month(2026, 3, 4, null), month(2026, 1, 6, 30), month(2026, 2, 2, 20)])!;
    expect(o.now).toEqual({ label: "Feb 2026", waitlist: 20 });
    expect(o.yearAgo).toBeNull();
    expect(o.twoYearsAgo).toBeNull();
    expect(o.resignations12).toBe(12);
    expect(o.monthsCounted).toBe(3);
    expect(o.perMonth).toBe(4);
    expect(o.monthsOfCover).toBe(5);
    expect(o.lastWinter).toBeNull();
  });

  it("counts only the latest 12 months and names the last full winter", () => {
    const months: MembershipMonth[] = [];
    for (let i = 0; i < 18; i++) {
      const y = 2025 + Math.floor((i + 4) / 12);
      const m = ((i + 4) % 12) + 1; // May 2025 .. Oct 2026
      months.push(month(y, m, i < 6 ? 100 : 1, 10));
    }
    const o = waitlistOutlook(months)!;
    expect(o.resignations12).toBe(12);
    expect(o.lastWinter).toEqual({ label: "Nov 2025 – Feb 2026", resignations: 4 });
  });

  it("gives no cover figure when nobody resigned, and nothing at all with no waitlist count", () => {
    expect(waitlistOutlook([month(2026, 1, 0, 12)])!.monthsOfCover).toBeNull();
    expect(waitlistOutlook([month(2026, 1, 3, null)])).toBeNull();
    expect(waitlistOutlook([])).toBeNull();
  });
});

describe("the rowing outlook", () => {
  const o = (day: string, team = false): Outing => ({ boat: "B", seats: 1, day, team, minutes: 60, startHour: 6, ownership: "club" });

  it("compares member outings from Jan 1 to the same day each year, leaving out team outings", () => {
    const outings = [o("2025-01-05"), o("2025-03-01"), o("2025-03-01", true), o("2025-12-01"), o("2026-02-01"), o("2026-02-01", true)];
    expect(rowingOutlook(outings, "2026-11-04")).toEqual({ year: 2026, now: 1, before: 2, change: -50, through: "2026-11-04" });
  });

  it("says nothing without last year to compare with", () => {
    expect(rowingOutlook([o("2026-02-01")], "2026-11-04")).toBeNull();
  });
});

describe("the usage outlook", () => {
  it("agrees with the Summary's own headline", () => {
    const u = usageOutlook(sampleData().members);
    expect(u.total).toBe(sampleData().members.length);
    expect(u.rarely).toBeGreaterThan(0);
    expect(u.rarelyShare).toBe(Math.round((u.rarely / u.total) * 100));
    expect(u.regulars).toBeGreaterThan(0);
  });
});
