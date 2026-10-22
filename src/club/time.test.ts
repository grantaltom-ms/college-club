import { describe, expect, it } from "vitest";
import { addDays, clockToMinutes, formatClock, formatDay, formatDayLong, formatMoment, formatRange, middayPacific, pacificDate, pacificDayStart, pacificWall, weekdayName } from "./time";

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

describe("Pacific wall clock to real moments", () => {
  const iso = (d: Date) => d.toISOString();

  it("maps a wall time to the right moment in summer and winter", () => {
    expect(iso(pacificWall("2026-10-22", 5 * 60))).toBe("2026-10-22T12:00:00.000Z"); // PDT, UTC-7
    expect(iso(pacificWall("2026-12-01", 5 * 60))).toBe("2026-12-01T13:00:00.000Z"); // PST, UTC-8
    expect(iso(pacificDayStart("2026-07-04"))).toBe("2026-07-04T07:00:00.000Z");
  });

  it("clocks fall back on Nov 1, 2026: that day is 25 hours long and no hour is lost or doubled", () => {
    const start = pacificDayStart("2026-11-01");
    const next = pacificDayStart("2026-11-02");
    expect(iso(start)).toBe("2026-11-01T07:00:00.000Z"); // midnight PDT
    expect(iso(next)).toBe("2026-11-02T08:00:00.000Z"); // midnight PST
    expect((next.getTime() - start.getTime()) / 3600000).toBe(25);
    // The days either side are ordinary.
    expect((start.getTime() - pacificDayStart("2026-10-31").getTime()) / 3600000).toBe(24);
    expect((pacificDayStart("2026-11-03").getTime() - next.getTime()) / 3600000).toBe(24);
    // 1:30 am happens twice; the first one (still summer time) is chosen.
    expect(iso(pacificWall("2026-11-01", 90))).toBe("2026-11-01T08:30:00.000Z");
    // Everything from 2 am on is winter time: 5 am is 13:00 UTC.
    expect(iso(pacificWall("2026-11-01", 300))).toBe("2026-11-01T13:00:00.000Z");
  });

  it("clocks spring forward on Mar 14, 2027: that day is 23 hours long", () => {
    const hours = (pacificDayStart("2027-03-15").getTime() - pacificDayStart("2027-03-14").getTime()) / 3600000;
    expect(hours).toBe(23);
    // 2:30 am does not exist that day; the first moment after the gap is used (3:30 am summer time).
    expect(iso(pacificWall("2027-03-14", 150))).toBe("2027-03-14T10:30:00.000Z");
  });

  it("round-trips: the Pacific date and clock of the moment match what was asked for, all year", () => {
    for (const day of ["2026-01-15", "2026-03-08", "2026-07-04", "2026-10-31", "2026-11-01", "2026-11-02", "2026-12-25", "2027-03-14"]) {
      for (const minutes of [0, 300, 720, 1200]) {
        const at = pacificWall(day, minutes);
        expect(pacificDate(at), `${day} ${minutes}`).toBe(day);
        const expected = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(at);
        expect(expected, `${day} ${minutes}`).toBe(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
      }
    }
  });

  it("reads clock strings and refuses nonsense", () => {
    expect(clockToMinutes("05:00")).toBe(300);
    expect(clockToMinutes("20:00")).toBe(1200);
    expect(clockToMinutes("24:00")).toBe(1440);
    expect(() => clockToMinutes("25:00")).toThrow("not a time between");
    expect(() => clockToMinutes("5pm")).toThrow("not a time like");
    expect(() => clockToMinutes("10:75")).toThrow("not a time between");
  });

  it("writes days, times and ranges for people", () => {
    expect(weekdayName("2026-10-31")).toBe("Saturday");
    expect(formatDayLong("2026-10-31")).toBe("Saturday, Oct 31");
    expect(formatClock(pacificWall("2026-10-22", 450))).toBe("7:30 am");
    expect(formatClock(pacificWall("2026-10-22", 0))).toBe("12:00 am");
    expect(formatRange(pacificWall("2026-10-22", 420), pacificWall("2026-10-22", 510))).toBe("7:00 to 8:30 am");
    expect(formatRange(pacificWall("2026-10-22", 690), pacificWall("2026-10-22", 750))).toBe("11:30 am to 12:30 pm");
  });
});
