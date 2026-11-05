import { describe, expect, it } from "vitest";
import { countWeekdays, daysBetween, formatDay, pacificCalendarDate, weekdayIndex } from "./dates";

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

  it("keeps a Tuesday evening Pacific send on Tuesday", () => {
    // 5:30 pm PDT on Tuesday Oct 6, 2026 is 00:30 UTC on Wednesday.
    expect(pacificCalendarDate("2026-10-07T00:30:00+00:00")).toBe("2026-10-06");
    // 5:30 pm PST on Tuesday Nov 3, 2026 is 01:30 UTC on Wednesday. Clocks fell back on Nov 1.
    expect(pacificCalendarDate("2026-11-04T01:30:00+00:00")).toBe("2026-11-03");
    // 10:00 am PDT stays on the same calendar day.
    expect(pacificCalendarDate("2026-10-06T17:00:00+00:00")).toBe("2026-10-06");
    // 11:30 pm PDT on Oct 31 is already the next morning in UTC.
    expect(pacificCalendarDate("2026-11-01T06:30:00Z")).toBe("2026-10-31");
    expect(pacificCalendarDate("not-a-time")).toBe("not-a-time");
  });

  it("formats days and tolerates missing dates", () => {
    expect(formatDay("2026-09-07")).toBe("Sep 7");
    expect(formatDay("2026-09-07", true)).toBe("Sep 7, 2026");
    expect(formatDay(null)).toBe("—");
  });
});
