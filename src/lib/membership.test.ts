import { describe, expect, it } from "vitest";
import {
  categoryParts,
  chainFlags,
  latestMonth,
  membershipFlags,
  monthLabel,
  monthsWithout,
  notesMatching,
  periodTotals,
  reasonParts,
  reconciliationFlags,
  sampleMembership,
  shortMonthLabel,
  sortMonths,
  trailingReasons,
} from "./membership";
import { membershipSeedData } from "./membership-seed.testkit";
import type { MembershipMonth } from "./types";

/** The columns the extension added, all empty: what the 16 months below look like before any reason or category split is known. */
const NO_SPLIT = {
  resignationsMoved: null,
  resignationsNotUsing: null,
  resignationsOther: null,
  catResident: null,
  catIntermediate: null,
  catNonResident: null,
  catSuburban: null,
  catHonorary: null,
  totalAllCategories: null,
};

/** Counts only, no names: the 16 months from the Membership Count workbooks (the original columns only). */
const REAL: MembershipMonth[] = ([
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
] as Omit<MembershipMonth, keyof typeof NO_SPLIT>[]).map((m) => ({ ...m, ...NO_SPLIT }));

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

  it("has one invented month with no split, so the gaps can be seen without the real data", () => {
    const sample = sampleMembership();
    expect(monthsWithout(sample.months, reasonParts).map(monthLabel)).toEqual(["Feb 2024"]);
    expect(monthsWithout(sample.months, categoryParts).map(monthLabel)).toEqual(["Feb 2024"]);
    expect(sample.months[1].note).toMatch(/^Sample note/);
    expect(trailingReasons(sample.months)).toMatchObject({ monthsInWindow: 3, monthsWithSplit: 2 });
  });
});

/** The seed Grant loads: 28 months, Jul 2024 to Oct 2026, as the endpoint serves them once the table is loaded. */
const SEED = membershipSeedData().months;
const seedMonth = (year: number, month: number) => SEED.find((m) => m.year === year && m.month === month) as MembershipMonth;

describe("the 28-month seed", () => {
  it("holds 28 months, Jul 2024 to Oct 2026, one after another with none missing", () => {
    expect(SEED).toHaveLength(28);
    expect(monthLabel(SEED[0])).toBe("Jul 2024");
    expect(monthLabel(SEED[27])).toBe("Oct 2026");
    expect(sortMonths(SEED)).toEqual(SEED);
    SEED.slice(1).forEach((m, i) => {
      const before = SEED[i];
      expect(m.year * 12 + m.month).toBe(before.year * 12 + before.month + 1);
    });
  });

  it("leaves the 16 months that were already loaded exactly as they were, except the two waitlist figures that were blank", () => {
    const later = SEED.filter((m) => m.year * 12 + m.month >= 2025 * 12 + 7);
    expect(later).toHaveLength(16);
    const withoutExtras = (m: MembershipMonth) => {
      const base: Record<string, unknown> = { ...m };
      for (const key of Object.keys(NO_SPLIT)) delete base[key];
      return base;
    };
    const unchanged = (m: MembershipMonth) => {
      const base = withoutExtras(m);
      delete base.note;
      return base;
    };
    REAL.forEach((old, i) => {
      const now = later[i];
      if (old.waitlist === null) {
        // Aug 2025 and Feb 2026 had no waitlist figure; the extension fills them in and says so in the note.
        expect([`${old.year}-${old.month}`]).toContain(`${now.year}-${now.month}`);
        expect([45, 33]).toContain(now.waitlist);
        expect(now.note).toMatch(/placeholder estimate/);
        expect({ ...unchanged(now), waitlist: null }).toEqual({ ...unchanged(old), waitlist: null });
      } else {
        expect(unchanged(now)).toEqual(unchanged(old));
      }
    });
    expect(REAL.filter((m) => m.waitlist === null).map(monthLabel)).toEqual(["Aug 2025", "Feb 2026"]);
  });

  it("has no applications or sign-ups figure anywhere in a month: the data deliberately has none", () => {
    for (const m of SEED) expect(Object.keys(m).filter((k) => /sign.?up|signup/i.test(k))).toEqual([]);
    // "Applicants" is the existing applicants-for-approval column, and nothing is derived from the waitlist.
    expect(Object.keys(SEED[0]).filter((k) => /applic/i.test(k))).toEqual(["applicants"]);
  });
});

describe("the reason split", () => {
  it("is stored for 27 months and is missing, all three together, only for Jun 2025", () => {
    expect(monthsWithout(SEED, reasonParts).map(monthLabel)).toEqual(["Jun 2025"]);
    const jun = seedMonth(2025, 6);
    expect([jun.resignationsMoved, jun.resignationsNotUsing, jun.resignationsOther]).toEqual([null, null, null]);
    expect(reasonParts(jun)).toBeNull();
    // A gap is never turned into zeroes: a real month with no resignation of one kind is a genuine 0, a missing month is not.
    expect(reasonParts(seedMonth(2024, 7))).toEqual([3, 2, 0]);
    expect(reasonParts(seedMonth(2025, 8))).toEqual([3, 0, 0]);
  });

  it("is handed back as stored, even where it does not add up to the month's resignations", () => {
    const off = SEED.filter((m) => {
      const parts = reasonParts(m);
      return parts !== null && parts[0] + parts[1] + parts[2] !== m.resignations;
    }).map((m) => `${monthLabel(m)}: ${(reasonParts(m) as number[]).reduce((a, b) => a + b, 0)} against ${m.resignations}`);
    // Five months are one short, and Mar 2026 is one over (its own note says so). None is forced to balance.
    expect(off).toEqual([
      "Oct 2024: 7 against 8",
      "Dec 2024: 7 against 8",
      "Jan 2025: 3 against 4",
      "Feb 2025: 4 against 5",
      "Mar 2026: 7 against 6",
      "Jun 2026: 3 against 4",
    ]);
    expect(reasonParts(seedMonth(2026, 3))).toEqual([0, 4, 3]);
  });

  it("is only a gap when any one of the three is missing", () => {
    const base = seedMonth(2025, 7);
    expect(reasonParts({ ...base, resignationsOther: null })).toBeNull();
    expect(reasonParts({ ...base, resignationsMoved: null })).toBeNull();
    expect(reasonParts({ ...base, resignationsNotUsing: null })).toBeNull();
    expect(reasonParts(base)).toEqual([3, 1, 0]);
  });
});

describe("the category mix and its two totals", () => {
  it("has all five categories for 27 months and none for Jun 2025", () => {
    expect(monthsWithout(SEED, categoryParts).map(monthLabel)).toEqual(["Jun 2025"]);
    const jun = seedMonth(2025, 6);
    expect(jun.totalAllCategories).toBeNull();
    expect(categoryParts(jun)).toBeNull();
    expect(categoryParts(seedMonth(2026, 10))).toEqual([437, 29, 39, 1, 10]);
  });

  it("adds the five categories up to the all-categories total, and that total is never the dues-paying total", () => {
    for (const m of SEED) {
      const parts = categoryParts(m);
      if (parts === null) continue;
      expect(parts.reduce((a, b) => a + b, 0)).toBe(m.totalAllCategories);
      // The all-categories count includes Suburban and Honorary members, so it is higher than the dues-paying count every month.
      expect(m.totalAllCategories).toBeGreaterThan(m.withApprovals);
    }
    expect(seedMonth(2026, 10).withApprovals).toBe(506);
    expect(seedMonth(2026, 10).totalAllCategories).toBe(516);
  });
});

describe("the trailing twelve months of reasons", () => {
  it("adds up the last 12 calendar months, counted back from the latest month", () => {
    const summary = trailingReasons(SEED);
    expect(summary && { from: monthLabel(summary.from), to: monthLabel(summary.to) }).toEqual({ from: "Nov 2025", to: "Oct 2026" });
    expect(summary).toMatchObject({ monthsInWindow: 12, monthsWithSplit: 12, moved: 16, notUsing: 31, other: 24, resignations: 71 });
    expect(shortMonthLabel(summary!.from)).toBe("Nov ’25");
    expect(shortMonthLabel(summary!.to)).toBe("Oct ’26");
  });

  it("leaves a month with no split out, never counts it as zero, and says how many months it counted", () => {
    // Twelve months ending Jul 2025 take in the Jun 2025 gap.
    const upToJuly = SEED.filter((m) => m.year * 12 + m.month <= 2025 * 12 + 7);
    const summary = trailingReasons(upToJuly)!;
    expect(monthLabel(summary.from)).toBe("Aug 2024");
    expect(monthLabel(summary.to)).toBe("Jul 2025");
    expect(summary.monthsInWindow).toBe(12);
    expect(summary.monthsWithSplit).toBe(11);
    // The resignations on the monthly sheets are summed over the same 11 months, so the two sides are comparable.
    const counted = upToJuly.filter((m) => reasonParts(m) !== null && m.year * 12 + m.month >= 2024 * 12 + 8);
    expect(counted).toHaveLength(11);
    expect(summary.resignations).toBe(counted.reduce((t, m) => t + m.resignations, 0));
    expect(summary.moved + summary.notUsing + summary.other).toBe(
      counted.reduce((t, m) => t + (m.resignationsMoved ?? 0) + (m.resignationsNotUsing ?? 0) + (m.resignationsOther ?? 0), 0),
    );
  });

  it("uses fewer months when the data is shorter, and is null with no data or no split at all", () => {
    expect(trailingReasons(SEED.slice(0, 3))).toMatchObject({ monthsInWindow: 3, monthsWithSplit: 3 });
    expect(trailingReasons([])).toBeNull();
    expect(trailingReasons(REAL)).toBeNull();
    expect(trailingReasons([seedMonth(2025, 6)])).toBeNull();
  });
});

describe("notes", () => {
  it("finds the notes that belong next to a chart by what they say, oldest month first", () => {
    expect(notesMatching(SEED, /waitlist/i).map(monthLabel)).toEqual(["Dec 2024", "Jan 2025", "Aug 2025", "Feb 2026", "Jun 2026"]);
    // Jun 2026's note names the waitlist too (the trend workbook said 21, the monthly sheet 23), so it sits under the waitlist chart as well.
    expect(notesMatching(SEED, /placeholder estimate/i).map((m) => m.waitlist)).toEqual([45, 44, 45, 33]);
    expect(notesMatching(SEED, /reason/i).map(monthLabel)).toEqual(["Oct 2024", "Dec 2024", "Jan 2025", "Feb 2025", "Jun 2025", "Mar 2026", "Jun 2026"]);
    expect(notesMatching(SEED, /zzz-matches-nothing/)).toEqual([]);
    expect(notesMatching(REAL, /./).map(monthLabel)).toEqual(["May 2026"]);
  });

  it("keeps the two flagged waitlist estimates of Dec 2024 and Jan 2025 as notes on those months", () => {
    expect(seedMonth(2024, 12).note).toContain("Waitlist 45 is a placeholder estimate");
    expect(seedMonth(2025, 1).note).toContain("Waitlist 44 is a placeholder estimate");
  });
});

describe("the flags on the full 28 months", () => {
  it("flags the five sheets that do not add up and the seven month-to-month breaks, and fixes none of them", () => {
    expect(reconciliationFlags(SEED).map((f) => f.split(":")[0])).toEqual(["Aug 2024", "Sep 2024", "May 2026", "Jun 2026", "Oct 2026"]);
    expect(chainFlags(SEED).map((f) => f.split(" starts")[0])).toEqual(["Jan 2025", "Feb 2025", "Jul 2025", "Aug 2025", "Dec 2025", "Apr 2026", "Oct 2026"]);
    expect(membershipFlags(SEED)).toHaveLength(12);
  });
});

describe("shortMonthLabel", () => {
  it("writes the month and a two-digit year", () => {
    expect(shortMonthLabel(seedMonth(2024, 7))).toBe("Jul ’24");
    expect(shortMonthLabel(seedMonth(2026, 10))).toBe("Oct ’26");
  });
});
