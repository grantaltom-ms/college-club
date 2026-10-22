import { describe, expect, it } from "vitest";
import { addDays, formatDay, formatMoment, middayPacific, pacificDate } from "./time";

describe("club time", () => {
  it("reads the Pacific date of a moment, across daylight saving", () => {
    expect(pacificDate(new Date("2026-10-22T07:00:00Z"))).toBe("2026-10-22");
    expect(pacificDate(new Date("2026-10-22T06:59:00Z"))).toBe("2026-10-21");
    // Clocks fall back at 2 am on Nov 1, 2026: midnight Pacific is 07:00 UTC before and 08:00 UTC after.
    expect(pacificDate(new Date("2026-11-01T06:59:00Z"))).toBe("2026-10-31");
    expect(pacificDate(new Date("2026-11-01T07:00:00Z"))).toBe("2026-11-01");
    expect(pacificDate(new Date("2026-11-02T07:59:00Z"))).toBe("2026-11-01");
    expect(pacificDate(new Date("2026-11-02T08:00:00Z"))).toBe("2026-11-02");
  });

  it("places a backdated record inside the right Pacific day, summer or winter", () => {
    for (const day of ["2026-07-04", "2026-11-01", "2026-12-25", "2027-03-14", "2026-01-01"]) {
      expect(pacificDate(middayPacific(day))).toBe(day);
    }
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-22", -21)).toBe("2026-10-01");
  });

  it("writes dates and moments for people", () => {
    expect(formatDay("2026-10-03")).toBe("Oct 3, 2026");
    expect(formatMoment("2026-10-03T18:00:00Z")).toBe("Oct 3, 2026, 11:00 am");
    expect(formatMoment("2026-12-03T19:00:00Z")).toBe("Dec 3, 2026, 11:00 am");
  });
});
