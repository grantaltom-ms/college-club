import { describe, expect, it } from "vitest";
import {
  answerAsk,
  clubYear,
  cumulativeByClubYear,
  expenseRatio,
  fmtMoney,
  fmtPercent,
  lastFullClubYear,
  latestMonth,
  lossMonths,
  monthLabel,
  netMargin,
  operatingMargin,
  periodTotals,
  sampleFinancials,
  sortMonths,
  subtotalSums,
  ytdFlags,
} from "./financials";
import type { FinanceMonth } from "./types";

/** Invented figures only, for the gap check: no real club finances in tests. */
function row(year: number, month: number, income: number, netIncome: number, labeledYtdIncome: number, labeledYtdNetIncome: number): FinanceMonth {
  return {
    year,
    month,
    income,
    cogs: 0,
    grossProfit: income,
    expenses: income - netIncome,
    netOperatingIncome: netIncome,
    otherIncome: 0,
    otherExpenses: 0,
    netOtherIncome: 0,
    netIncome,
    depreciation: 0,
    labeledYtdIncome,
    labeledYtdNetIncome,
    sourceFile: "Sample Board Reporting Package.xlsx",
    note: null,
  };
}

describe("financial month labels, ordering and club years", () => {
  it("labels a month, sorts oldest first and groups July into the new club year", () => {
    const sample = sampleFinancials();
    expect(monthLabel(sample.months[0])).toBe("Jan 2024");
    expect(sortMonths([sample.months[2], sample.months[0]])[0]).toBe(sample.months[0]);
    expect(latestMonth(sample.months)).toBe(sample.months[2]);
    expect(latestMonth([])).toBeNull();
    expect(clubYear({ ...sample.months[0], month: 7, year: 2026 })).toBe("2026–27");
    expect(clubYear({ ...sample.months[0], month: 6, year: 2026 })).toBe("2025–26");
    expect(clubYear({ ...sample.months[0], month: 10, year: 2026 })).toBe("2026–27");
  });
});

describe("financial period totals and YTD flags", () => {
  it("shows both the sum of the months and the labeled year-to-date, with the gap", () => {
    const rows = [row(2024, 7, 10000, 1000, 10000, 1000), row(2024, 8, 10000, 1000, 19000, 1900)];
    expect(periodTotals(rows)).toEqual({
      months: 2,
      sumIncome: 20000,
      sumNet: 2000,
      labeledYtdIncome: 19000,
      labeledYtdNetIncome: 1900,
      gapIncome: 1000,
      gapNet: 100,
    });
    expect(ytdFlags(rows)).toHaveLength(1);
    expect(ytdFlags(rows)[0]).toContain("$20,000.00");
    expect(ytdFlags(rows)[0]).toContain("$19,000.00");
    expect(ytdFlags(rows)[0]).toContain("unreconciled");
    expect(periodTotals([])).toBeNull();
  });

  it("flags nothing when the sample months add up cleanly", () => {
    expect(ytdFlags(sampleFinancials().months)).toEqual([]);
  });
});

describe("financial margins", () => {
  it("computes net margin, operating margin and expense ratio, and formats shares", () => {
    const [jan] = sampleFinancials().months;
    expect(netMargin(jan)).toBeCloseTo(0.095);
    expect(operatingMargin(jan)).toBeCloseTo(0.15);
    expect(expenseRatio(jan)).toBeCloseTo(0.8);
    expect(fmtPercent(netMargin(jan))).toBe("9.5%");
    expect(fmtPercent(null)).toBe("—");
    expect(fmtMoney(-4000.49)).toBe("-$4,000.49");
    expect(fmtMoney(177256.94)).toBe("$177,256.94");
  });

  it("cumulates a metric from the start of each club year", () => {
    const cumulative = cumulativeByClubYear(sampleFinancials().months, "income");
    expect(cumulative.get("2024-1")).toBe(100000);
    expect(cumulative.get("2024-2")).toBe(210000);
    expect(cumulative.get("2024-3")).toBe(300000);
  });
});

describe("Ask the numbers", () => {
  const sample = sampleFinancials().months;

  it("finds the highest and lowest net-income months", () => {
    expect(answerAsk("highest-net", sample).text).toContain("Feb 2024");
    expect(answerAsk("highest-net", sample).text).toContain("$13,400.00");
    expect(answerAsk("lowest-net", sample).highlightKeys).toEqual(["2024-3"]);
    expect(answerAsk("lowest-net", sample).text).toContain("-$1,700.00");
  });

  it("totals a club year showing both the sum and the labeled year-to-date", () => {
    const answer = answerAsk("fy-totals", sample, { clubYear: "2023–24" });
    expect(answer.text).toContain("$300,000.00");
    expect(answer.text).toContain("$21,200.00");
    expect(answer.text).toContain("agree");
    expect(answer.highlightKeys).toHaveLength(3);
    expect(answerAsk("fy-totals", sample, {}).text).toContain("Pick a club year");
  });

  it("compares a month to the previous month, its club-year average, and the prior year", () => {
    const vsPrev = answerAsk("vs-previous", sample, { monthKey: "2024-2" });
    expect(vsPrev.text).toContain("Feb 2024");
    expect(vsPrev.text).toContain("Jan 2024");
    expect(vsPrev.highlightKeys).toEqual(["2024-1", "2024-2"]);
    expect(answerAsk("vs-previous", sample, { monthKey: "2024-1" }).text).toContain("earliest month");
    const vsAvg = answerAsk("vs-fy-average", sample, { monthKey: "2024-3" });
    expect(vsAvg.text).toContain("2023–24");
    expect(vsAvg.text).toContain("below");
    expect(answerAsk("vs-prior-year", sample, { monthKey: "2024-2" }).text).toContain("cannot be made");
  });

  it("lists loss months and answers range questions", () => {
    const losses = answerAsk("loss-months", sample);
    expect(losses.highlightKeys).toEqual(["2024-3"]);
    expect(losses.text).toContain("Mar 2024");
    const change = answerAsk("income-change-range", sample, { startKey: "2024-1", endKey: "2024-3" });
    expect(change.text).toContain("-$10,000.00");
    expect(change.text).toContain("-10.0%");
    const tracking = answerAsk("expenses-vs-income-range", sample, { startKey: "2024-1", endKey: "2024-3" });
    expect(tracking.text).toContain("$300,000.00");
    expect(tracking.text).toContain("$247,000.00");
    expect(tracking.text).toContain("82.3%");
    expect(answerAsk("income-change-range", sample, { startKey: "2024-3", endKey: "2024-1" }).text).toContain("no months");
  });

  it("says so instead of guessing when there is no data", () => {
    expect(answerAsk("highest-net", []).text).toContain("no finance figures");
  });
});

describe("financial subtotal rows and summary-strip helpers", () => {
  it("sums every P&L line for a subtotal row, with both year-to-date figures and the gap", () => {
    const rows = [row(2024, 7, 10000, 1000, 10000, 1000), row(2024, 8, 10000, 1000, 19000, 1900)];
    expect(subtotalSums(rows)).toEqual({
      months: 2,
      sumIncome: 20000,
      sumCogs: 0,
      sumGrossProfit: 20000,
      sumExpenses: 18000,
      sumNetOperatingIncome: 2000,
      sumOtherIncome: 0,
      sumOtherExpenses: 0,
      sumNetOtherIncome: 0,
      sumNet: 2000,
      sumDepreciation: 0,
      labeledYtdIncome: 19000,
      labeledYtdNetIncome: 1900,
      gapIncome: 1000,
      gapNet: 100,
    });
    expect(subtotalSums([])).toBeNull();
  });

  it("finds loss months and the last full club year", () => {
    const sample = sampleFinancials().months;
    expect(lossMonths(sample).map(monthLabel)).toEqual(["Mar 2024"]);
    expect(lossMonths([])).toEqual([]);
    expect(lastFullClubYear(sample)).toBeNull();
    const fullYear: FinanceMonth[] = [];
    for (let i = 0; i < 12; i++) {
      const year = 2025 + Math.floor((7 + i - 1) / 12);
      const month = ((7 + i - 1) % 12) + 1;
      fullYear.push(row(year, month, 10000, 1000, (i + 1) * 10000, (i + 1) * 1000));
    }
    fullYear.push(row(2026, 7, 10000, 1000, 10000, 1000));
    expect(lastFullClubYear(fullYear)).toBe("2025–26");
  });

  it("points a gapped club-year totals answer at the subtotal row, not a flags section", () => {
    const rows = [row(2024, 7, 10000, 1000, 10000, 1000), row(2024, 8, 10000, 1000, 19000, 1900)];
    const answer = answerAsk("fy-totals", rows, { clubYear: "2024–25" });
    expect(answer.text).toContain("subtotal row");
    expect(answer.text).toContain("neither figure has been corrected");
  });
});

describe("sample financial data", () => {
  it("is clearly labelled sample and adds up cleanly", () => {
    const sample = sampleFinancials();
    expect(sample.source).toBe("sample");
    expect(sample.months).toHaveLength(3);
    expect(ytdFlags(sample.months)).toEqual([]);
  });
});
