import { describe, expect, it } from "vitest";
import { dollarsToCents, hoursToMinutes } from "./web-damage";

describe("reading hours spent", () => {
  it("turns hours into minutes, and empty into not said", () => {
    expect(hoursToMinutes("")).toEqual({ ok: true, value: null });
    expect(hoursToMinutes("   ")).toEqual({ ok: true, value: null });
    expect(hoursToMinutes("1.5")).toEqual({ ok: true, value: 90 });
    expect(hoursToMinutes("2")).toEqual({ ok: true, value: 120 });
    expect(hoursToMinutes(" 0.25 ")).toEqual({ ok: true, value: 15 });
    expect(hoursToMinutes("0")).toEqual({ ok: true, value: 0 });
    expect(hoursToMinutes("0.33")).toEqual({ ok: true, value: 20 });
    expect(hoursToMinutes("1000")).toEqual({ ok: true, value: 60000 });
  });

  it("refuses anything that is not a plain number of hours, in words", () => {
    const bad = { ok: false, message: "Hours spent should be a number like 1.5." };
    for (const text of ["abc", "-1", "1,5", "1.555", "1h", "1e3", ".5", "12345", "1 2"]) expect(hoursToMinutes(text), text).toEqual(bad);
  });
});

describe("reading the cost in dollars", () => {
  it("turns dollars into cents, and empty into not said", () => {
    expect(dollarsToCents("")).toEqual({ ok: true, value: null });
    expect(dollarsToCents("12.50")).toEqual({ ok: true, value: 1250 });
    expect(dollarsToCents("$12.5")).toEqual({ ok: true, value: 1250 });
    expect(dollarsToCents("12")).toEqual({ ok: true, value: 1200 });
    expect(dollarsToCents("1,200")).toEqual({ ok: true, value: 120000 });
    expect(dollarsToCents("0")).toEqual({ ok: true, value: 0 });
    expect(dollarsToCents("0.07")).toEqual({ ok: true, value: 7 });
    expect(dollarsToCents("19.99")).toEqual({ ok: true, value: 1999 });
    expect(dollarsToCents("100000")).toEqual({ ok: true, value: 10000000 });
  });

  it("refuses anything that is not a plain number of dollars, in words", () => {
    const bad = { ok: false, message: "The cost should be a number of dollars like 12.50." };
    for (const text of ["abc", "-5", "12.505", "$$5", "5 dollars", "1e3", ".5", "123456789"]) expect(dollarsToCents(text), text).toEqual(bad);
  });
});
