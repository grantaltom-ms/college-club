import { describe, expect, it } from "vitest";
import { decimal, firstDayOf, formatMoney, isMonth, lastDayOf, monthLabel, monthOf, nextMonth, parseDollars, usDate, visitorFeeCents, visitorRuleWords, visitorTotalWords } from "./billing-words";

const rules = { visitorFreePerDay: 4, visitorFeeCents: 1000 };

describe("money", () => {
  it("is written with a dollar sign, thousands commas and two decimals, and a minus sign for a credit", () => {
    expect(formatMoney(15450)).toBe("$154.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(5)).toBe("$0.05");
    expect(formatMoney(123456789)).toBe("$1,234,567.89");
    expect(formatMoney(-2000)).toBe("-$20.00");
    expect(formatMoney(-5)).toBe("-$0.05");
  });

  it("is written for a spreadsheet with no dollar sign or comma", () => {
    expect(decimal(15450)).toBe("154.50");
    expect(decimal(123456789)).toBe("1234567.89");
    expect(decimal(-2000)).toBe("-20.00");
    expect(decimal(-5)).toBe("-0.05");
    expect(decimal(0)).toBe("0.00");
  });
});

describe("what staff type as an amount", () => {
  it("reads whole dollars, one or two decimals, a dollar sign, thousands commas and a leading minus", () => {
    for (const [typed, cents] of [
      ["12", 1200],
      ["12.5", 1250],
      ["12.50", 1250],
      ["$12.50", 1250],
      ["  12.50  ", 1250],
      ["1,250.00", 125000],
      ["$1,250", 125000],
      ["0.05", 5],
      [".5", null],
      ["-20", -2000],
      ["-$20.00", -2000],
      ["0", 0],
      ["9,999,999.99", 999999999],
    ] as const) {
      expect(parseDollars(typed), typed).toBe(cents);
    }
  });

  it("never guesses: too many decimals, stray characters, words, an empty box and absurd sizes are all refused", () => {
    for (const typed of ["", " ", "12.505", "1.2.3", "twelve", "12 dollars", "$$5", "1,25", "12,5.00", "--5", "5-", "1e3", "12.", "10,000,000", "100000000", "NaN", "Infinity", "$ 5"]) {
      expect(parseDollars(typed), typed).toBeNull();
    }
  });
});

describe("months", () => {
  it("knows a real YYYY-MM from anything else", () => {
    for (const ok of ["2026-01", "2026-09", "2026-12", "1999-06"]) expect(isMonth(ok), ok).toBe(true);
    for (const bad of ["2026-00", "2026-13", "2026-9", "26-09", "2026-09-01", "September", "", "2026/09"]) expect(isMonth(bad), bad).toBe(false);
  });

  it("finds the first and last day, the day's month, and the next month across a year end", () => {
    expect(firstDayOf("2026-02")).toBe("2026-02-01");
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-10")).toBe("2026-10-31");
    expect(lastDayOf("2026-12")).toBe("2026-12-31");
    expect(monthOf("2026-10-31")).toBe("2026-10");
    expect(nextMonth("2026-09")).toBe("2026-10");
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2026-01")).toBe("2026-02");
  });

  it("says a month in words and a date the way QuickBooks Online reads it", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
    expect(usDate("2026-10-31")).toBe("10/31/2026");
    expect(usDate("2027-01-05")).toBe("01/05/2027");
  });
});

describe("the visitor fee", () => {
  it("is nothing up to the free number, and over it every visitor that day is charged", () => {
    expect(visitorFeeCents(0, rules)).toBe(0);
    expect(visitorFeeCents(1, rules)).toBe(0);
    expect(visitorFeeCents(4, rules)).toBe(0);
    expect(visitorFeeCents(5, rules)).toBe(5000);
    expect(visitorFeeCents(6, rules)).toBe(6000);
    expect(visitorFeeCents(30, rules)).toBe(30000);
  });

  it("follows the numbers in the rules", () => {
    expect(visitorFeeCents(2, { visitorFreePerDay: 1, visitorFeeCents: 750 })).toBe(1500);
    expect(visitorFeeCents(1, { visitorFreePerDay: 1, visitorFeeCents: 750 })).toBe(0);
    expect(visitorFeeCents(0, { visitorFreePerDay: 0, visitorFeeCents: 750 })).toBe(0);
    expect(visitorFeeCents(1, { visitorFreePerDay: 0, visitorFeeCents: 750 })).toBe(750);
    expect(visitorFeeCents(9, { visitorFreePerDay: 4, visitorFeeCents: 0 })).toBe(0);
  });

  it("says the rule and what a day's total means, in plain words", () => {
    expect(visitorRuleWords(rules)).toBe("A member can bring up to 4 visitors a day for free. With more than that, every visitor that day costs $10.00, not just the extra ones: 5 visitors cost $50.00 in all.");
    expect(visitorRuleWords({ visitorFreePerDay: 4, visitorFeeCents: 0 })).toBe("There is no fee for visitors.");
    expect(visitorRuleWords({ visitorFreePerDay: 1, visitorFeeCents: 500 })).toContain("up to 1 visitor a day");
    expect(visitorTotalWords(2, rules)).toBe("That makes 2 visitors today, with no fee. 2 more visitors would still be free.");
    expect(visitorTotalWords(3, rules)).toContain("1 more visitor would still be free");
    expect(visitorTotalWords(4, rules)).toBe("That makes 4 visitors today, with no fee. One more visitor today and every visitor that day costs $10.00.");
    expect(visitorTotalWords(6, rules)).toBe("That makes 6 visitors today. That is over 4, so each costs $10.00: $60.00, added to the household's bill.");
    expect(visitorTotalWords(1, rules)).toContain("That makes 1 visitor today");
  });
});
