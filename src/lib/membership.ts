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

/**
 * Made-up months for development and tests, clearly labelled sample.
 * These are invented figures, not the real club's counts.
 */
export function sampleMembership(): MembershipData {
  return {
    source: "sample",
    months: [
      { year: 2024, month: 1, previousTotal: 400, resignations: 2, applicants: 3, transferred: 0, withApprovals: 401, waitlist: 10, note: null },
      { year: 2024, month: 2, previousTotal: 401, resignations: 1, applicants: 2, transferred: 0, withApprovals: 402, waitlist: null, note: null },
      { year: 2024, month: 3, previousTotal: 402, resignations: 3, applicants: 3, transferred: 1, withApprovals: 403, waitlist: 12, note: null },
    ],
  };
}
