import { describe, expect, it } from "vitest";
import { columnsFrom, formatShare, readCell, toPercentTable } from "./percent-table";

describe("readCell", () => {
  it("reads plain numbers, commas and words after the number", () => {
    expect(readCell(42)).toEqual({ value: 42, rest: "" });
    expect(readCell("1,234")).toEqual({ value: 1234, rest: "" });
    expect(readCell("12 (so far)")).toEqual({ value: 12, rest: " (so far)" });
    expect(readCell("3.5")).toEqual({ value: 3.5, rest: "" });
  });
  it("leaves dashes, words and figures that are already percentages alone", () => {
    expect(readCell("—")).toBeNull();
    expect(readCell("–")).toBeNull();
    expect(readCell("Jan 26")).toBeNull();
    expect(readCell("45%")).toBeNull();
    expect(readCell(Number.NaN)).toBeNull();
  });
});

describe("formatShare", () => {
  it("rounds to a whole percent", () => {
    expect(formatShare(1, 3)).toBe("33%");
    expect(formatShare(2, 3)).toBe("67%");
    expect(formatShare(5, 5)).toBe("100%");
    expect(formatShare(0, 5)).toBe("0%");
  });
  it("never shows a real but tiny share as 0%, and never divides by nothing", () => {
    expect(formatShare(1, 1000)).toBe("<1%");
    expect(formatShare(0, 0)).toBe("—");
  });
});

const table = {
  headers: ["Month", "Shell", "Kayak", "Total"],
  rows: [
    ["Jan", "30", "10", "40"],
    ["Feb", "1,000", "0", "1,000"],
    ["Mar", "—", "5 (part month)", "5"],
  ],
};

describe("toPercentTable", () => {
  it("as a share of each column", () => {
    const out = toPercentTable(table, { of: "column", columns: [1, 2], note: "" });
    expect(out.headers).toEqual(table.headers);
    expect(out.rows).toEqual([
      ["Jan", "3%", "67%", "40"],
      ["Feb", "97%", "0%", "1,000"],
      ["Mar", "—", "33% (part month)", "5"],
    ]);
  });
  it("as a share of the row's total column, which reads 100%", () => {
    const out = toPercentTable(table, { of: 3, columns: [1, 2, 3], note: "" });
    expect(out.rows).toEqual([
      ["Jan", "75%", "25%", "100%"],
      ["Feb", "100%", "0%", "100%"],
      ["Mar", "—", "100% (part month)", "100%"],
    ]);
  });
  it("as a share of the row's converted cells added up", () => {
    const out = toPercentTable(
      { headers: ["Day", "Avg", "6am", "7am"], rows: [["Mon", "20", "1.5", "4.5"], ["Tue", "0", "0.0", "0.0"]] },
      { of: "row", columns: [2, 3], note: "" },
    );
    expect(out.rows).toEqual([
      ["Mon", "20", "25%", "75%"],
      ["Tue", "0", "—", "—"],
    ]);
  });
  it("leaves a row alone when its total cell is not a number", () => {
    const out = toPercentTable({ headers: ["M", "A", "T"], rows: [["Jun", "—", "—"]] }, { of: 2, columns: [1], note: "" });
    expect(out.rows).toEqual([["Jun", "—", "—"]]);
  });
  it("does not change the table it was given, so switching back shows the same numbers", () => {
    const before = JSON.stringify(table);
    for (let i = 0; i < 5; i++) toPercentTable(table, { of: "column", columns: [1, 2], note: "" });
    expect(JSON.stringify(table)).toBe(before);
  });
});

describe("columnsFrom", () => {
  it("lists columns from a starting point, skipping some", () => {
    expect(columnsFrom(table, 1)).toEqual([1, 2, 3]);
    expect(columnsFrom(table, 1, [3])).toEqual([1, 2]);
  });
});
