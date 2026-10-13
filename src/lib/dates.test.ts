import { describe, expect, it } from "vitest";
import { countWeekdays, daysBetween, formatDay, weekdayIndex } from "./dates";

describe("dates", () => {
  it("finds the weekday, Monday first", () => {
    expect(weekdayIndex("2026-01-01")).toBe(3); // Thursday
    expect(weekdayIndex("2026-09-27")).toBe(6); // Sunday
  });

  it("counts days between dates without drifting across month ends", () => {
    expect(daysBetween("2026-01-01", "2026-09-27")).toBe(269);
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it("counts each weekday in Jan 1 to Sep 27, 2026", () => {
    // 270 days: 38 full weeks plus Thu, Fri, Sat, Sun.
    expect(countWeekdays("2026-01-01", "2026-09-27")).toEqual([38, 38, 38, 39, 39, 39, 39]);
  });

  it("formats days and tolerates missing dates", () => {
    expect(formatDay("2026-09-07")).toBe("Sep 7");
    expect(formatDay("2026-09-07", true)).toBe("Sep 7, 2026");
    expect(formatDay(null)).toBe("—");
  });
});
