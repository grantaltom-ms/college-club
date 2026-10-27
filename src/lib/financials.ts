import type { FinanceData, FinanceMonth } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "$17,031.73" for a dollar figure, with cents, so no figure is rounded away. */
export function fmtMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

/** "Oct 2026" for a month row. */
export function monthLabel(m: FinanceMonth): string {
  return `${MONTHS[m.month - 1]} ${m.year}`;
}

/** "2025-7" style key for a month, used to pick months in filters and answers. */
export function monthKey(m: FinanceMonth): string {
  return `${m.year}-${m.month}`;
}

/** Months in calendar order, oldest first. */
export function sortMonths(months: FinanceMonth[]): FinanceMonth[] {
  return [...months].sort((a, b) => a.year - b.year || a.month - b.month);
}

/** The most recent month, or null when there are none. */
export function latestMonth(months: FinanceMonth[]): FinanceMonth | null {
  const sorted = sortMonths(months);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** The club year a month belongs to: July starts a new year, so Oct 2026 is 2026-27 and Jul 2026 starts 2026-27. */
export function clubYear(m: FinanceMonth): string {
  return m.month >= 7 ? `${m.year}–${String(m.year + 1).slice(2)}` : `${m.year - 1}–${String(m.year).slice(2)}`;
}

/** True when `next` is the calendar month right after `prev`. */
function consecutive(prev: FinanceMonth, next: FinanceMonth): boolean {
  return (prev.year === next.year && next.month === prev.month + 1) || (next.year === prev.year + 1 && prev.month === 12 && next.month === 1);
}

const roundCents = (n: number) => Math.round(n * 100) / 100;

export interface PeriodTotals {
  months: number;
  /** Sum of the monthly sheets in the period. */
  sumIncome: number;
  sumNet: number;
  /** The last month's package figures, which are the labeled year-to-date for a full club year. */
  labeledYtdIncome: number;
  labeledYtdNetIncome: number;
  /** Sum minus labeled, so a gap shows up instead of being picked silently. */
  gapIncome: number;
  gapNet: number;
}

/** Totals across a set of months, showing both the sum of the months and the labeled year-to-date. */
export function periodTotals(months: FinanceMonth[]): PeriodTotals | null {
  const sorted = sortMonths(months);
  if (sorted.length === 0) return null;
  const last = sorted[sorted.length - 1];
  const sumIncome = roundCents(sorted.reduce((sum, m) => sum + m.income, 0));
  const sumNet = roundCents(sorted.reduce((sum, m) => sum + m.netIncome, 0));
  return {
    months: sorted.length,
    sumIncome,
    sumNet,
    labeledYtdIncome: last.labeledYtdIncome,
    labeledYtdNetIncome: last.labeledYtdNetIncome,
    gapIncome: roundCents(sumIncome - last.labeledYtdIncome),
    gapNet: roundCents(sumNet - last.labeledYtdNetIncome),
  };
}

/** Every P&L line summed across a set of months, plus both year-to-date figures and their gaps, for a club-year subtotal row. */
export interface SubtotalSums {
  months: number;
  sumIncome: number;
  sumCogs: number;
  sumGrossProfit: number;
  sumExpenses: number;
  sumNetOperatingIncome: number;
  sumOtherIncome: number;
  sumOtherExpenses: number;
  sumNetOtherIncome: number;
  sumNet: number;
  sumDepreciation: number;
  labeledYtdIncome: number;
  labeledYtdNetIncome: number;
  gapIncome: number;
  gapNet: number;
}

/**
 * Sums for a club-year subtotal row. Income, net, labeled figures, and gaps
 * come from periodTotals so that helper's exact shape stays unchanged;
 * the other lines are summed the same way.
 */
export function subtotalSums(months: FinanceMonth[]): SubtotalSums | null {
  const totals = periodTotals(months);
  if (!totals) return null;
  const sorted = sortMonths(months);
  const sum = (pick: (m: FinanceMonth) => number) => roundCents(sorted.reduce((total, m) => total + pick(m), 0));
  return {
    months: totals.months,
    sumIncome: totals.sumIncome,
    sumCogs: sum((m) => m.cogs),
    sumGrossProfit: sum((m) => m.grossProfit),
    sumExpenses: sum((m) => m.expenses),
    sumNetOperatingIncome: sum((m) => m.netOperatingIncome),
    sumOtherIncome: sum((m) => m.otherIncome),
    sumOtherExpenses: sum((m) => m.otherExpenses),
    sumNetOtherIncome: sum((m) => m.netOtherIncome),
    sumNet: totals.sumNet,
    sumDepreciation: sum((m) => m.depreciation),
    labeledYtdIncome: totals.labeledYtdIncome,
    labeledYtdNetIncome: totals.labeledYtdNetIncome,
    gapIncome: totals.gapIncome,
    gapNet: totals.gapNet,
  };
}

/** Months that lost money, oldest first. */
export function lossMonths(months: FinanceMonth[]): FinanceMonth[] {
  return sortMonths(months).filter((m) => m.netIncome < 0);
}

/** The label of the most recent club year with a full 12 months, or null when there is none. */
export function lastFullClubYear(months: FinanceMonth[]): string | null {
  const groups = new Map<string, FinanceMonth[]>();
  for (const m of sortMonths(months)) {
    const label = clubYear(m);
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  let found: string | null = null;
  for (const [label, rows] of groups) {
    if (rows.length === 12) found = label;
  }
  return found;
}

/**
 * Where a club year's monthly sheets do not add up to its labeled
 * year-to-date figures, in plain words. The figures are reported exactly
 * as shown; nothing here corrects them or picks one side.
 */
export function ytdFlags(months: FinanceMonth[]): string[] {
  const groups = new Map<string, FinanceMonth[]>();
  for (const m of sortMonths(months)) {
    const label = clubYear(m);
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  return [...groups.entries()].flatMap(([label, rows]) => {
    const totals = periodTotals(rows);
    if (!totals) return [];
    if (Math.abs(totals.gapIncome) < 0.01 && Math.abs(totals.gapNet) < 0.01) return [];
    return [
      `${label}: the monthly sheets add up to ${fmtMoney(totals.sumIncome)} income and ${fmtMoney(totals.sumNet)} net, but the labeled fiscal year-to-date figures are ${fmtMoney(totals.labeledYtdIncome)} income and ${fmtMoney(totals.labeledYtdNetIncome)} net — differences of ${fmtMoney(totals.gapIncome)} income and ${fmtMoney(totals.gapNet)} net, unreconciled.`,
    ];
  });
}

/** Net margin (net income as a share of income), or null when income is 0. */
export function netMargin(m: FinanceMonth): number | null {
  return m.income === 0 ? null : m.netIncome / m.income;
}

/** Operating margin (net operating income as a share of income), or null when income is 0. */
export function operatingMargin(m: FinanceMonth): number | null {
  return m.income === 0 ? null : m.netOperatingIncome / m.income;
}

/** Expense ratio (expenses as a share of income), or null when income is 0. */
export function expenseRatio(m: FinanceMonth): number | null {
  return m.income === 0 ? null : m.expenses / m.income;
}

/** "12.3%" for a share, or a dash when there is none. */
export function fmtPercent(share: number | null): string {
  return share === null ? "—" : `${(share * 100).toFixed(1)}%`;
}

/** The value of one metric for one month, for the metric toggle. */
export type FinanceMetric = "income" | "expenses" | "netIncome" | "grossProfit" | "netOperatingIncome";

export const METRIC_LABELS: Record<FinanceMetric, string> = {
  income: "Income",
  expenses: "Expenses",
  netIncome: "Net income",
  grossProfit: "Gross profit",
  netOperatingIncome: "Net operating income",
};

export function metricValue(m: FinanceMonth, metric: FinanceMetric): number {
  switch (metric) {
    case "income":
      return m.income;
    case "expenses":
      return m.expenses;
    case "netIncome":
      return m.netIncome;
    case "grossProfit":
      return m.grossProfit;
    case "netOperatingIncome":
      return m.netOperatingIncome;
  }
}

/**
 * Cumulative sum of a metric from the start of its club year to each month.
 * Net income's cumulative sum is deliberately not the labeled year-to-date:
 * where the two differ, the club-year subtotal rows show both.
 */
export function cumulativeByClubYear(months: FinanceMonth[], metric: FinanceMetric): Map<string, number> {
  const out = new Map<string, number>();
  const groups = new Map<string, FinanceMonth[]>();
  for (const m of sortMonths(months)) {
    const label = clubYear(m);
    groups.set(label, [...(groups.get(label) ?? []), m]);
  }
  for (const rows of groups.values()) {
    let running = 0;
    for (const m of rows) {
      running = roundCents(running + metricValue(m, metric));
      out.set(monthKey(m), running);
    }
  }
  return out;
}

/* ---------- Ask the numbers ---------- */
/**
 * Deterministic questions answered from the loaded rows only. No model,
 * no external call: every answer is computed here, cites the months it
 * used, and names the table rows to highlight. An answer that cannot be
 * computed from the data says so instead of guessing.
 */

export type AskQuestionId =
  | "highest-net"
  | "lowest-net"
  | "fy-totals"
  | "vs-previous"
  | "vs-fy-average"
  | "vs-prior-year"
  | "loss-months"
  | "income-change-range"
  | "expenses-vs-income-range";

export const ASK_QUESTIONS: { id: AskQuestionId; label: string; needsMonth: boolean; needsRange: boolean; needsYear: boolean }[] = [
  { id: "highest-net", label: "Which month had the highest net income?", needsMonth: false, needsRange: false, needsYear: false },
  { id: "lowest-net", label: "Which month had the lowest net income?", needsMonth: false, needsRange: false, needsYear: false },
  { id: "fy-totals", label: "What were the totals for a club year?", needsMonth: false, needsRange: false, needsYear: true },
  { id: "vs-previous", label: "How did a month compare to the previous month?", needsMonth: true, needsRange: false, needsYear: false },
  { id: "vs-fy-average", label: "How did a month compare to its club-year average?", needsMonth: true, needsRange: false, needsYear: false },
  { id: "vs-prior-year", label: "How did a month compare to the same month last year?", needsMonth: true, needsRange: false, needsYear: false },
  { id: "loss-months", label: "Which months lost money?", needsMonth: false, needsRange: false, needsYear: false },
  { id: "income-change-range", label: "How did income change over a range of months?", needsMonth: false, needsRange: true, needsYear: false },
  { id: "expenses-vs-income-range", label: "How did expenses track income over a range of months?", needsMonth: false, needsRange: true, needsYear: false },
];

export interface AskAnswer {
  text: string;
  /** Month keys for the table rows to highlight. */
  highlightKeys: string[];
  /** Month labels the answer rests on, in order. */
  monthsUsed: string[];
}

export interface AskOptions {
  monthKey?: string;
  startKey?: string;
  endKey?: string;
  clubYear?: string;
}

const byKey = (months: FinanceMonth[]) => new Map(sortMonths(months).map((m) => [monthKey(m), m]));

function rangeMonths(sorted: FinanceMonth[], startKey: string, endKey: string): FinanceMonth[] {
  const start = sorted.findIndex((m) => monthKey(m) === startKey);
  const end = sorted.findIndex((m) => monthKey(m) === endKey);
  if (start < 0 || end < 0 || end < start) return [];
  return sorted.slice(start, end + 1);
}

const pctChange = (from: number, to: number): string => {
  if (from === 0) return " (no percentage: the starting figure is $0)";
  const pct = ((to - from) / Math.abs(from)) * 100;
  return ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
};

export function answerAsk(question: AskQuestionId, months: FinanceMonth[], opts: AskOptions = {}): AskAnswer {
  const sorted = sortMonths(months);
  if (sorted.length === 0) return { text: "There are no finance figures loaded yet.", highlightKeys: [], monthsUsed: [] };
  const by = byKey(sorted);

  if (question === "highest-net" || question === "lowest-net") {
    const pick = sorted.reduce((best, m) => (question === "highest-net" ? (m.netIncome > best.netIncome ? m : best) : m.netIncome < best.netIncome ? m : best), sorted[0]);
    return {
      text: `${monthLabel(pick)} had the ${question === "highest-net" ? "highest" : "lowest"} net income, at ${fmtMoney(pick.netIncome)} on ${fmtMoney(pick.income)} income.`,
      highlightKeys: [monthKey(pick)],
      monthsUsed: [monthLabel(pick)],
    };
  }

  if (question === "fy-totals") {
    const rows = opts.clubYear ? sorted.filter((m) => clubYear(m) === opts.clubYear) : [];
    if (rows.length === 0) return { text: "Pick a club year to see its totals.", highlightKeys: [], monthsUsed: [] };
    const totals = periodTotals(rows)!;
    const gapText =
      Math.abs(totals.gapIncome) < 0.01 && Math.abs(totals.gapNet) < 0.01
        ? "The monthly sheets and the labeled year-to-date figures agree."
        : `The labeled year-to-date figures differ from the sum of the months by ${fmtMoney(totals.gapIncome)} income and ${fmtMoney(totals.gapNet)} net — see the club-year subtotal row in the table above; neither figure has been corrected.`;
    return {
      text: `${opts.clubYear} (${totals.months} months): the monthly sheets add up to ${fmtMoney(totals.sumIncome)} income and ${fmtMoney(totals.sumNet)} net. The labeled fiscal year-to-date figures are ${fmtMoney(totals.labeledYtdIncome)} income and ${fmtMoney(totals.labeledYtdNetIncome)} net. ${gapText}`,
      highlightKeys: rows.map(monthKey),
      monthsUsed: rows.map(monthLabel),
    };
  }

  if (question === "loss-months") {
    const losses = sorted.filter((m) => m.netIncome < 0);
    if (losses.length === 0) return { text: "No month in the loaded figures lost money.", highlightKeys: [], monthsUsed: [] };
    return {
      text: `${losses.length} month${losses.length === 1 ? "" : "s"} lost money: ${losses.map((m) => `${monthLabel(m)} (${fmtMoney(m.netIncome)})`).join(", ")}.`,
      highlightKeys: losses.map(monthKey),
      monthsUsed: losses.map(monthLabel),
    };
  }

  if (question === "income-change-range" || question === "expenses-vs-income-range") {
    if (!opts.startKey || !opts.endKey) return { text: "Pick a start month and an end month for the range.", highlightKeys: [], monthsUsed: [] };
    const rows = rangeMonths(sorted, opts.startKey, opts.endKey);
    if (rows.length === 0) return { text: "That range has no months in the loaded figures, or the end month comes before the start month.", highlightKeys: [], monthsUsed: [] };
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (question === "income-change-range") {
      const change = roundCents(last.income - first.income);
      return {
        text: `Income went from ${fmtMoney(first.income)} in ${monthLabel(first)} to ${fmtMoney(last.income)} in ${monthLabel(last)}, a change of ${fmtMoney(change)}${pctChange(first.income, last.income)}.`,
        highlightKeys: [monthKey(first), monthKey(last)],
        monthsUsed: rows.map(monthLabel),
      };
    }
    const sumIncome = roundCents(rows.reduce((sum, m) => sum + m.income, 0));
    const sumExpenses = roundCents(rows.reduce((sum, m) => sum + m.expenses, 0));
    const sumNet = roundCents(rows.reduce((sum, m) => sum + m.netIncome, 0));
    const ratio = sumIncome === 0 ? null : sumExpenses / sumIncome;
    return {
      text: `From ${monthLabel(first)} to ${monthLabel(last)} (${rows.length} months), income was ${fmtMoney(sumIncome)} and expenses were ${fmtMoney(sumExpenses)} — expenses were ${fmtPercent(ratio)} of income — and net income was ${fmtMoney(sumNet)}.`,
      highlightKeys: rows.map(monthKey),
      monthsUsed: rows.map(monthLabel),
    };
  }

  // Month-based questions.
  if (!opts.monthKey || !by.has(opts.monthKey)) return { text: "Pick a month to compare.", highlightKeys: [], monthsUsed: [] };
  const m = by.get(opts.monthKey)!;
  const idx = sorted.findIndex((x) => monthKey(x) === opts.monthKey);

  if (question === "vs-previous") {
    if (idx === 0) return { text: `${monthLabel(m)} is the earliest month in the loaded figures, so there is no previous month to compare it to.`, highlightKeys: [opts.monthKey], monthsUsed: [monthLabel(m)] };
    const prev = sorted[idx - 1];
    if (!consecutive(prev, m)) {
      return { text: `${monthLabel(m)}'s previous month in the loaded figures is ${monthLabel(prev)}, but the months in between are missing, so a month-to-month comparison would not be like for like.`, highlightKeys: [monthKey(prev), opts.monthKey], monthsUsed: [monthLabel(prev), monthLabel(m)] };
    }
    return {
      text: `${monthLabel(m)} net income was ${fmtMoney(m.netIncome)}, ${fmtMoney(roundCents(m.netIncome - prev.netIncome))} ${m.netIncome >= prev.netIncome ? "more" : "less"} than ${monthLabel(prev)} (${fmtMoney(prev.netIncome)}). Income was ${fmtMoney(m.income)}, ${fmtMoney(roundCents(m.income - prev.income))} ${m.income >= prev.income ? "more" : "less"} than ${monthLabel(prev)} (${fmtMoney(prev.income)}).`,
      highlightKeys: [monthKey(prev), opts.monthKey],
      monthsUsed: [monthLabel(prev), monthLabel(m)],
    };
  }

  if (question === "vs-fy-average") {
    const yearRows = sorted.filter((x) => clubYear(x) === clubYear(m));
    const avgNet = roundCents(yearRows.reduce((sum, x) => sum + x.netIncome, 0) / yearRows.length);
    const diff = roundCents(m.netIncome - avgNet);
    return {
      text: `${monthLabel(m)} net income was ${fmtMoney(m.netIncome)}. The ${clubYear(m)} club-year average over ${yearRows.length} months is ${fmtMoney(avgNet)}, so ${monthLabel(m)} was ${fmtMoney(Math.abs(diff))} ${diff >= 0 ? "above" : "below"} that average.`,
      highlightKeys: yearRows.map(monthKey),
      monthsUsed: yearRows.map(monthLabel),
    };
  }

  if (question === "vs-prior-year") {
    const prior = sorted.find((x) => x.year === m.year - 1 && x.month === m.month);
    if (!prior) {
      return { text: `There is no ${monthLabel(m)} equivalent from the year before in the loaded figures, so a same-month-last-year comparison cannot be made.`, highlightKeys: [opts.monthKey], monthsUsed: [monthLabel(m)] };
    }
    return {
      text: `${monthLabel(m)} net income was ${fmtMoney(m.netIncome)}, ${fmtMoney(roundCents(m.netIncome - prior.netIncome))} ${m.netIncome >= prior.netIncome ? "more" : "less"} than ${monthLabel(prior)} (${fmtMoney(prior.netIncome)}). Income was ${fmtMoney(m.income)}, ${fmtMoney(roundCents(m.income - prior.income))} ${m.income >= prior.income ? "more" : "less"} than ${monthLabel(prior)} (${fmtMoney(prior.income)}).`,
      highlightKeys: [monthKey(prior), opts.monthKey],
      monthsUsed: [monthLabel(prior), monthLabel(m)],
    };
  }

  return { text: "That question is not available.", highlightKeys: [], monthsUsed: [] };
}

/**
 * Made-up months for development and tests, clearly labelled sample.
 * These are invented figures, not the real club's finances, and they
 * add up cleanly: the monthly sheets match the labeled year-to-date.
 */
export function sampleFinancials(): FinanceData {
  const base = (year: number, month: number, income: number, cogs: number, expenses: number, otherIncome: number, otherExpenses: number, labeledYtdIncome: number, labeledYtdNetIncome: number): FinanceMonth => {
    const grossProfit = income - cogs;
    const netOperatingIncome = grossProfit - expenses;
    const netOtherIncome = otherIncome - otherExpenses;
    return {
      year,
      month,
      income,
      cogs,
      grossProfit,
      expenses,
      netOperatingIncome,
      otherIncome,
      otherExpenses,
      netOtherIncome,
      netIncome: netOperatingIncome + netOtherIncome,
      depreciation: 8000,
      labeledYtdIncome,
      labeledYtdNetIncome,
      sourceFile: "Sample Board Reporting Package.xlsx",
      note: null,
    };
  };
  return {
    source: "sample",
    months: [
      base(2024, 1, 100000, 5000, 80000, 500, 6000, 100000, 9500),
      base(2024, 2, 110000, 6000, 85000, 400, 6000, 210000, 22900),
      base(2024, 3, 90000, 4000, 82000, 300, 6000, 300000, 21200),
    ],
  };
}
