import type { MembershipData, MembershipMonth } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Oct 2026" for a month row. */
export function monthLabel(m: MembershipMonth): string {
  return `${MONTHS[m.month - 1]} ${m.year}`;
}

/** Months in calendar order, oldest first. */
export function sortMonths(months: MembershipMonth[]): MembershipMonth[] {
  return [...months].sort((a, b) => a.year - b.year || a.month - b.month);
}

/** True when `next` is the calendar month right after `prev`. */
function consecutive(prev: MembershipMonth, next: MembershipMonth): boolean {
  return (prev.year === next.year && next.month === prev.month + 1) || (next.year === prev.year + 1 && prev.month === 12 && next.month === 1);
}

/**
 * Where a sheet's own total does not match its own figures, in plain words.
 * The numbers are reported exactly as shown; nothing here corrects them.
 * A blank transferred total counts as 0 for the check and is called out.
 */
export function reconciliationFlags(months: MembershipMonth[]): string[] {
  return sortMonths(months).flatMap((m) => {
    const transferred = m.transferred ?? 0;
    const expected = m.previousTotal - m.resignations + m.applicants + transferred;
    if (expected === m.withApprovals) return [];
    const blank = m.transferred === null ? " The transferred total was blank in the source." : "";
    return [
      `${monthLabel(m)}: ${m.previousTotal} − ${m.resignations} + ${m.applicants} + ${transferred} = ${expected}, but the sheet shows ${m.withApprovals}.${blank}`,
    ];
  });
}

/** Where one month starts from a different total than the last month ended at. */
export function chainFlags(months: MembershipMonth[]): string[] {
  const sorted = sortMonths(months);
  const flags: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    if (consecutive(prev, next) && next.previousTotal !== prev.withApprovals) {
      flags.push(`${monthLabel(next)} starts at ${next.previousTotal}, but ${monthLabel(prev)} ended at ${prev.withApprovals}.`);
    }
  }
  return flags;
}

/** All the flags, reconciliation first, then month-to-month breaks. */
export function membershipFlags(months: MembershipMonth[]): string[] {
  return [...reconciliationFlags(months), ...chainFlags(months)];
}

export interface PeriodTotals {
  months: number;
  start: number;
  end: number;
  resignations: number;
  applicants: number;
}

/** Totals across a set of months: first month's starting total to last month's ending total. */
export function periodTotals(months: MembershipMonth[]): PeriodTotals | null {
  const sorted = sortMonths(months);
  if (sorted.length === 0) return null;
  return {
    months: sorted.length,
    start: sorted[0].previousTotal,
    end: sorted[sorted.length - 1].withApprovals,
    resignations: sorted.reduce((sum, m) => sum + m.resignations, 0),
    applicants: sorted.reduce((sum, m) => sum + m.applicants, 0),
  };
}

/** The most recent month, or null when there are none. */
export function latestMonth(months: MembershipMonth[]): MembershipMonth | null {
  const sorted = sortMonths(months);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** "Oct ’26": the short label under a chart column. */
export function shortMonthLabel(m: MembershipMonth): string {
  return `${MONTHS[m.month - 1]} ’${String(m.year).slice(2)}`;
}

/** The three reasons for leaving, in chart order, or null for a month with no reason split (a gap, never zeroes). */
export function reasonParts(m: MembershipMonth): [number, number, number] | null {
  if (m.resignationsMoved === null || m.resignationsNotUsing === null || m.resignationsOther === null) return null;
  return [m.resignationsMoved, m.resignationsNotUsing, m.resignationsOther];
}

/** The five member categories in chart order, or null for a month with no category split. */
export function categoryParts(m: MembershipMonth): [number, number, number, number, number] | null {
  if (m.catResident === null || m.catIntermediate === null || m.catNonResident === null || m.catSuburban === null || m.catHonorary === null) return null;
  return [m.catResident, m.catIntermediate, m.catNonResident, m.catSuburban, m.catHonorary];
}

/** The months that have no figure for the given split, oldest first. */
export function monthsWithout(months: MembershipMonth[], parts: (m: MembershipMonth) => unknown): MembershipMonth[] {
  return sortMonths(months).filter((m) => parts(m) === null);
}

export interface ReasonsSummary {
  /** First and last month of the window. */
  from: MembershipMonth;
  to: MembershipMonth;
  /** How many months the window covers (12 unless the data is shorter), and how many of them have a reason split. */
  monthsInWindow: number;
  monthsWithSplit: number;
  moved: number;
  notUsing: number;
  other: number;
  /** The resignations on the monthly sheets for just the months counted, to set beside the three reasons (they need not match). */
  resignations: number;
}

/**
 * The reasons for leaving over the last `window` calendar months, counted back from the latest month. A month with no split is
 * left out, not counted as zero; `monthsWithSplit` says how many were counted. Null when no month in the window has a split.
 */
export function trailingReasons(months: MembershipMonth[], window = 12): ReasonsSummary | null {
  const sorted = sortMonths(months);
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const index = (m: MembershipMonth) => m.year * 12 + m.month;
  const inWindow = sorted.filter((m) => index(latest) - index(m) < window);
  const counted = inWindow.filter((m) => reasonParts(m) !== null);
  if (counted.length === 0) return null;
  const sum = (pick: (m: MembershipMonth) => number | null) => counted.reduce((total, m) => total + (pick(m) ?? 0), 0);
  return {
    from: inWindow[0],
    to: latest,
    monthsInWindow: inWindow.length,
    monthsWithSplit: counted.length,
    moved: sum((m) => m.resignationsMoved),
    notUsing: sum((m) => m.resignationsNotUsing),
    other: sum((m) => m.resignationsOther),
    resignations: counted.reduce((total, m) => total + m.resignations, 0),
  };
}

/** The months whose note text matches, oldest first. Used to put a note next to the chart it is about. */
export function notesMatching(months: MembershipMonth[], pattern: RegExp): MembershipMonth[] {
  return sortMonths(months).filter((m) => m.note !== null && pattern.test(m.note));
}

/**
 * Made-up months for development and tests, clearly labelled sample.
 * These are invented figures, not the real club's counts.
 */
export function sampleMembership(): MembershipData {
  return {
    source: "sample",
    months: [
      {
        year: 2024, month: 1, previousTotal: 400, resignations: 2, applicants: 3, transferred: 0, withApprovals: 401, waitlist: 10,
        resignationsMoved: 1, resignationsNotUsing: 1, resignationsOther: 0,
        catResident: 340, catIntermediate: 40, catNonResident: 18, catSuburban: 1, catHonorary: 9, totalAllCategories: 408, note: null,
      },
      // No reason or category split for February, so the sample shows a gap the way the real Jun 2025 does.
      {
        year: 2024, month: 2, previousTotal: 401, resignations: 1, applicants: 2, transferred: 0, withApprovals: 402, waitlist: null,
        resignationsMoved: null, resignationsNotUsing: null, resignationsOther: null,
        catResident: null, catIntermediate: null, catNonResident: null, catSuburban: null, catHonorary: null, totalAllCategories: null,
        note: "Sample note: no reason or category split for this made-up month.",
      },
      {
        year: 2024, month: 3, previousTotal: 402, resignations: 3, applicants: 3, transferred: 1, withApprovals: 403, waitlist: 12,
        resignationsMoved: 1, resignationsNotUsing: 1, resignationsOther: 1,
        catResident: 342, catIntermediate: 41, catNonResident: 18, catSuburban: 1, catHonorary: 9, totalAllCategories: 411, note: null,
      },
    ],
  };
}
