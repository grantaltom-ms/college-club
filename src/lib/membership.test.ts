import { describe, expect, it } from "vitest";
import {
  chainFlags,
  latestMonth,
  membershipFlags,
  monthLabel,
  periodTotals,
  reconciliationFlags,
  sampleMembership,
  sortMonths,
} from "./membership";
import type { MembershipMonth } from "./types";

/** Counts only, no names: the 16 months from the Membership Count workbooks. */
const REAL: MembershipMonth[] = [
  { year: 2025, month: 7, previousTotal: 502, resignations: 4, applicants: 7, transferred: 0, withApprovals: 505, waitlist: 42, note: null },
  { year: 2025, month: 8, previousTotal: 506, resignations: 3, applicants: 3, transferred: 0, withApprovals: 506, waitlist: null, note: null },
  { year: 2025, month: 9, previousTotal: 506, resignations: 8, applicants: 8, transferred: 0, withApprovals: 506, waitlist: 47, note: null },
  { year: 2025, month: 10, previousTotal: 506, resignations: 13, applicants: 14, transferred: 0, withApprovals: 507, waitlist: 34, note: null },
  { year: 2025, month: 11, previousTotal: 507, resignations: 8, applicants: 9, transferred: 0, withApprovals: 508, waitlist: 38, note: null },
  { year: 2025, month: 12, previousTotal: 506, resignations: 8, applicants: 5, transferred: 0, withApprovals: 503, waitlist: 39, note: null },
  { year: 2026, month: 1, previousTotal: 503, resignations: 7, applicants: 7, transferred: 0, withApprovals: 503, waitlist: 33, note: null },
  { year: 2026, month: 2, previousTotal: 503, resignations: 6, applicants: 6, transferred: 0, withApprovals: 503, waitlist: null, note: null },
  { year: 2026, month: 3, previousTotal: 503, resignations: 6, applicants: 6, transferred: 0, withApprovals: 503, waitlist: 33, note: null },
  { year: 2026, month: 4, previousTotal: 499, resignations: 4, applicants: 6, transferred: 0, withApprovals: 501, waitlist: 29, note: null },
  { year: 2026, month: 5, previousTotal: 501, resignations: 3, applicants: 5, transferred: null, withApprovals: 502, waitlist: 20, note: "Total transferred cell blank in source; category transfers: 2 Resident, 2 Non-Res. Not counted in the total." },
  { year: 2026, month: 6, previousTotal: 502, resignations: 4, applicants: 5, transferred: 0, withApprovals: 502, waitlist: 23, note: null },
  { year: 2026, month: 7, previousTotal: 502, resignations: 2, applicants: 4, transferred: 0, withApprovals: 504, waitlist: 23, note: null },
  { year: 2026, month: 8, previousTotal: 504, resignations: 3, applicants: 4, transferred: 0, withApprovals: 505, waitlist: 37, note: null },
  { year: 2026, month: 9, previousTotal: 505, resignations: 10, applicants: 12, transferred: 0, withApprovals: 507, waitlist: 27, note: null },
  { year: 2026, month: 10, previousTotal: 506, resignations: 10, applicants: 11, transferred: 1, withApprovals: 506, waitlist: 16, note: null },
];

describe("membership month labels and ordering", () => {
  it("labels a month and sorts oldest first", () => {
    expect(monthLabel(REAL[REAL.length - 1])).toBe("Oct 2026");
    expect(sortMonths([REAL[15], REAL[0]])[0]).toBe(REAL[0]);
    expect(latestMonth(REAL)).toBe(REAL[15]);
    expect(latestMonth([])).toBeNull();
  });
});

describe("membership flags", () => {
  it("flags exactly the three sheets that do not add up, and calls out the blank transferred total", () => {
    expect(reconciliationFlags(REAL)).toEqual([
      "May 2026: 501 − 3 + 5 + 0 = 503, but the sheet shows 502. The transferred total was blank in the source.",
      "Jun 2026: 502 − 4 + 5 + 0 = 503, but the sheet shows 502.",
      "Oct 2026: 506 − 10 + 11 + 1 = 508, but the sheet shows 506.",
    ]);
  });

  it("flags exactly the four month-to-month breaks", () => {
    expect(chainFlags(REAL)).toEqual([
      "Aug 2025 starts at 506, but Jul 2025 ended at 505.",
      "Dec 2025 starts at 506, but Nov 2025 ended at 508.",
      "Apr 2026 starts at 499, but Mar 2026 ended at 503.",
      "Oct 2026 starts at 506, but Sep 2026 ended at 507.",
    ]);
  });

  it("combines reconciliation flags before chain flags", () => {
    expect(membershipFlags(REAL)).toHaveLength(7);
  });
});

describe("membership period totals", () => {
  it("totals the 2025-26 club year and the 2026-27 months so far", () => {
    const firstYear = REAL.filter((m) => !(m.year === 2026 && m.month >= 7));
    const secondYear = REAL.filter((m) => m.year === 2026 && m.month >= 7);
    expect(periodTotals(firstYear)).toEqual({ months: 12, start: 502, end: 502, resignations: 74, applicants: 81 });
    expect(periodTotals(secondYear)).toEqual({ months: 4, start: 502, end: 506, resignations: 25, applicants: 31 });
    expect(periodTotals([])).toBeNull();
  });
});

describe("sample membership data", () => {
  it("is clearly labelled sample and adds up cleanly", () => {
    const sample = sampleMembership();
    expect(sample.source).toBe("sample");
    expect(sample.months).toHaveLength(3);
    expect(membershipFlags(sample.months)).toEqual([]);
  });
});
