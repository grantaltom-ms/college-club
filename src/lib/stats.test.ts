import { describe, expect, it } from "vitest";
import { sampleData } from "./sample";
import {
  bandSummary,
  bookingMonths,
  bookingSeries,
  bookingWeekdays,
  bookingYearOverYear,
  bookingYears,
  busiestSlots,
  doorYears,
  heatColor,
  heatmap,
  headline,
  hourSeries,
  quietByJoined,
  visitsByType,
  monthComparison,
  multiBooking,
  monthSeries,
  percent,
  weekdaySeries,
  yearOverYear,
} from "./stats";
import type { Member } from "./types";

const data = sampleData();

function member(overrides: Partial<Member>): Member {
  return {
    name: "Test Member",
    band: "1-2/month",
    visitsPerMonth: 1.5,
    visitDays: 13,
    doorEntries: 14,
    bookingDays: 2,
    bookings: 2,
    earlyShare: 0.2,
    weekendShare: 0.1,
    household: false,
    lastVisit: "2026-09-01",
    ownFob: true,
    joined: null,
    memberType: null,
    qbCreatedOn: null,
    notStarted: false,
    monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe("band summary and headline", () => {
  it("counts the groups among members who have started", () => {
    expect(bandSummary(data.members).map((r) => r.members)).toEqual([31, 102, 80, 75, 198]);
  });

  it("has 497 members, 11 not started, and 133 of the 486 who started under one visit a month", () => {
    const h = headline(data.members);
    expect(h.total).toBe(497);
    expect(h.notStarted).toBe(11);
    expect(h.started).toBe(486);
    expect(h.quiet).toBe(133);
    expect(h.quietShare).toBe(27);
    expect(h.noVisits).toBe(31);
    expect(h.regulars).toBe(198);
  });

  it("leaves not-started members out of the rarely-visit count and every share", () => {
    const members = [
      member({ band: "0 visits", visitDays: 0, doorEntries: 0 }),
      member({ band: "0 visits", visitDays: 0, doorEntries: 0, notStarted: true, qbCreatedOn: "2026-06-01" }),
      member({ band: "4+/month", doorEntries: 100 }),
    ];
    const h = headline(members);
    expect(h).toMatchObject({ total: 3, started: 2, notStarted: 1, quiet: 1, noVisits: 1, quietShare: 50 });
    expect(bandSummary(members).reduce((s, r) => s + r.members, 0)).toBe(2);
  });

  it("shares of door entries add up to about 100", () => {
    const total = bandSummary(data.members).reduce((s, r) => s + r.entryShare, 0);
    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it("handles an empty list", () => {
    expect(headline([]).total).toBe(0);
    expect(percent(1, 0)).toBe(0);
  });
});

describe("door pattern", () => {
  const sum = (n: number[]) => n.reduce((x, y) => x + y, 0);

  it("lists the years newest first", () => {
    expect(doorYears(data.door)).toEqual([2026, 2025]);
  });

  it("door counts agree across month, hour and weekday", () => {
    for (const year of [2025, 2026]) {
      const months = sum(monthSeries(data.door, year).map((m) => m.entries));
      const hours = sum(hourSeries(data.door, year).map((h) => h.entries));
      const days = sum(weekdaySeries(data.door, year).map((d) => d.entries));
      expect(hours).toBe(months);
      expect(days).toBe(months);
    }
  });

  it("averages per day using how many of each weekday the year covers", () => {
    // Jan 1 to Oct 12, 2026 is 285 days: 41 of every weekday except Tue and Wed (40).
    expect(weekdaySeries(data.door, 2026).map((d) => d.days)).toEqual([41, 40, 40, 41, 41, 41, 41]);
    // 2025 is a full 365-day year starting on a Wednesday.
    expect(weekdaySeries(data.door, 2025).map((d) => d.days)).toEqual([52, 52, 53, 52, 52, 52, 52]);
    const sat = weekdaySeries(data.door, 2026)[5];
    expect(sat.perDay).toBeCloseTo(sat.entries / 41, 5);
  });

  it("reports weekends as quieter than weekdays", () => {
    const [, , , , , sat, sun] = weekdaySeries(data.door, 2026);
    expect(sat.belowWeekday).toBeGreaterThan(0);
    expect(sun.belowWeekday).toBeGreaterThan(0);
  });

  it("marks only finished months as complete", () => {
    const months2026 = monthSeries(data.door, 2026);
    expect(months2026).toHaveLength(12);
    expect(months2026.slice(0, 9).every((m) => m.complete)).toBe(true);
    expect(months2026[9].complete).toBe(false); // October stops on the 12th
    expect(months2026[9].entries).toBeGreaterThan(0);
    expect(months2026[10]).toMatchObject({ complete: false, entries: 0 }); // November has not happened
    expect(monthSeries(data.door, 2025).every((m) => m.complete)).toBe(true);
  });

  it("compares this year with last year using only months finished in both", () => {
    const yoy = yearOverYear(data.door)!;
    expect(yoy).toMatchObject({ year: 2026, previousYear: 2025, months: 9, fromLabel: "Jan", toLabel: "Sep" });
    const now = monthSeries(data.door, 2026).slice(0, 9);
    const before = monthSeries(data.door, 2025).slice(0, 9);
    expect(yoy.thisYear).toBe(sum(now.map((m) => m.entries)));
    expect(yoy.lastYear).toBe(sum(before.map((m) => m.entries)));
    expect(yoy.change).toBe(Math.round((yoy.thisYear / yoy.lastYear - 1) * 100));
  });

  it("lines up each month across years with the change where both are finished", () => {
    const c = monthComparison(data.door);
    expect(c.years).toEqual([2025, 2026]);
    expect(c.rows).toHaveLength(12);
    const mar = c.rows[2];
    expect(mar.label).toBe("Mar");
    expect(mar.years.map((m) => m.key)).toEqual(["2025-03", "2026-03"]);
    expect(mar.change).toBe(Math.round((mar.years[1].entries / mar.years[0].entries - 1) * 100));
    expect(c.rows[9].change).toBeNull(); // October 2026 is not finished
    expect(c.rows[11].change).toBeNull(); // December 2026 has not happened
    for (let i = 0; i < 3; i++) expect(monthComparison(data.door)).toEqual(c);
  });

  it("compares nothing with only one year, and nothing with no data", () => {
    const one = monthComparison({ ...data.door, periods: [data.door.periods[0]] });
    expect(one.years).toHaveLength(1);
    expect(one.rows.every((r) => r.change === null)).toBe(true);
    expect(monthComparison({ ...data.door, periods: [], months: [] }).rows).toEqual([]);
  });

  it("has no year-over-year figure when there is only one year", () => {
    expect(yearOverYear({ ...data.door, periods: [data.door.periods[0]] })).toBeNull();
  });

  it("builds the day-by-hour grid from the first to the last busy hour", () => {
    const map = heatmap(data.door, 2026);
    expect(map.rows).toHaveLength(7);
    expect(map.hours[0]).toBe(4);
    expect(map.hours[map.hours.length - 1]).toBe(21);
    expect(map.rows.every((r) => r.cells.length === map.hours.length)).toBe(true);
    const tue5 = map.rows[1].cells.find((c) => c.hour === 5)!;
    expect(tue5.perDay).toBeCloseTo(tue5.entries / 40, 5);
    expect(map.max).toBe(Math.max(...map.rows.flatMap((r) => r.cells.map((c) => c.perDay))));
  });

  it("returns an empty grid for a year with no data", () => {
    expect(heatmap(data.door, 1999)).toMatchObject({ hours: [], max: 0 });
  });

  it("colors from near-paper to dark, never outside the range", () => {
    expect(heatColor(0, 10)).toBe("rgb(243, 240, 232)");
    expect(heatColor(10, 10)).toBe("rgb(43, 58, 66)");
    expect(heatColor(99, 10)).toBe("rgb(43, 58, 66)");
    expect(heatColor(-5, 10)).toBe("rgb(243, 240, 232)");
    expect(heatColor(5, 0)).toBe("rgb(243, 240, 232)");
  });

  it("lists the busiest slots highest first", () => {
    const slots = busiestSlots(heatmap(data.door, 2026), 3);
    expect(slots).toHaveLength(3);
    expect(slots[0].perDay).toBeGreaterThanOrEqual(slots[1].perDay);
    expect(slots[1].perDay).toBeGreaterThanOrEqual(slots[2].perDay);
  });

  it("flags weekend booking days and covers Jan 1, 2025 to Sep 30, 2026", () => {
    const days = bookingSeries(data.totals);
    expect(days).toHaveLength(638);
    expect(days[0].day).toBe("2025-01-01");
    expect(days.find((d) => d.day === "2026-07-04")?.weekend).toBe(true); // a Saturday
    expect(days.find((d) => d.day === "2026-07-06")?.weekend).toBe(false); // a Monday
  });
});

describe("reservation views", () => {
  it("finds both years, newest first", () => {
    expect(bookingYears(data.totals)).toEqual([2026, 2025]);
  });

  it("marks months complete only when every day is present", () => {
    const m26 = bookingMonths(data.totals, 2026);
    expect(m26.filter((m) => m.complete).length).toBe(9);
    expect(m26[9].bookings).toBe(0);
    expect(bookingMonths(data.totals, 2025).every((m) => m.complete)).toBe(true);
  });

  it("month totals add up to the daily totals", () => {
    const daily = bookingSeries(data.totals).reduce((s, d) => s + d.bookings, 0);
    const monthly = [2025, 2026].flatMap((y) => bookingMonths(data.totals, y)).reduce((s, m) => s + m.bookings, 0);
    expect(monthly).toBe(daily);
  });

  it("compares Jan to Sep of the two years", () => {
    const yoy = bookingYearOverYear(data.totals)!;
    expect(yoy.fromLabel).toBe("Jan");
    expect(yoy.toLabel).toBe("Sep");
    expect(yoy.thisYear).toBeLessThan(yoy.lastYear);
  });

  it("averages each weekday over the days it appears", () => {
    const w = bookingWeekdays(data.totals, 2026);
    expect(w).toHaveLength(7);
    expect(w.reduce((s, x) => s + x.days, 0)).toBe(273);
  });
});

describe("multiBooking", () => {
  const wfc = { bookingDays: 10, bookings: 16, earlyShare: 0.1, weekendShare: 0.1 };
  it("counts members who booked twice in a day and the work-from-club pattern", () => {
    const members = [
      member({ bookingDays: 0, bookings: 0 }),
      member({ bookingDays: 5, bookings: 5 }),
      member({ bookingDays: 5, bookings: 7 }),
      member(wfc),
      member({ ...wfc, earlyShare: 0.8 }),
      member({ ...wfc, household: true }),
      member({ ...wfc, earlyShare: null, weekendShare: null }),
    ];
    const r = multiBooking(members);
    expect(r).toMatchObject({ total: 7, booked: 6, multiDay: 5, often: 4, workFromClub: 1, earlyBirds: 1, households: 1, unknown: 1 });
    expect(r.multiDayShare).toBe(83);
  });
  it("is stable on repeated use and with no bookings", () => {
    expect(multiBooking([])).toMatchObject({ booked: 0, multiDayShare: 0, workFromClub: 0 });
    const a = multiBooking(data.members);
    for (let i = 0; i < 5; i++) expect(multiBooking(data.members)).toEqual(a);
    expect(a.workFromClub).toBeLessThanOrEqual(a.often);
    expect(a.multiDay).toBeLessThanOrEqual(a.booked);
  });
});

describe("visits by membership type and by when members joined", () => {
  it("splits the groups by QuickBooks type and shares the under-once-a-month rate", () => {
    const members = [
      member({ memberType: "Resident", band: "0 visits", visitDays: 0 }),
      member({ memberType: "Resident", band: "Under 1/month" }),
      member({ memberType: "Resident", band: "4+/month" }),
      member({ memberType: "Resident", band: "4+/month" }),
      member({ memberType: "Intermediate", band: "1-2/month" }),
      member({ memberType: "Non-Resident", band: "0 visits", visitDays: 0, notStarted: true, qbCreatedOn: "2026-05-01" }),
      member({ memberType: "Non-Resident", band: "Under 1/month" }),
    ];
    const rows = visitsByType(members);
    expect(rows.map((r) => r.type)).toEqual(["Resident", "Intermediate", "Non-Resident"]);
    expect(rows[0]).toMatchObject({ members: 4, counts: [1, 1, 0, 0, 2], quiet: 2, quietShare: 50 });
    expect(rows[1]).toMatchObject({ members: 1, quiet: 0, quietShare: 0 });
    // The not-started Non-Resident is left out of both the count and the share.
    expect(rows[2]).toMatchObject({ members: 1, quiet: 1, quietShare: 100, notStarted: 1 });
  });

  it("covers every started member exactly once across the types", () => {
    const rows = visitsByType(data.members);
    expect(rows.reduce((s, r) => s + r.members, 0)).toBe(486);
  });

  it("groups by when the QuickBooks record was created, with the load day meaning on or before", () => {
    const at = (qbCreatedOn: string, band: Member["band"] = "4+/month", extra: Partial<Member> = {}) =>
      member({ qbCreatedOn, band, ...extra });
    const members = [
      at("2019-10-18", "Under 1/month"),
      at("2019-10-18"),
      at("2019-10-19"),
      at("2022-12-31", "0 visits", { visitDays: 0 }),
      at("2023-01-01"),
      at("2024-12-31", "Under 1/month"),
      at("2025-06-01"),
      at("2026-02-01", "Under 1/month"),
      at("2026-08-01", "0 visits", { visitDays: 0, notStarted: true }),
    ];
    const rows = quietByJoined(members, "2026-09-27");
    expect(rows.map((r) => r.label)).toEqual(["Before Oct 2019", "Oct 2019–2022", "2023–2024", "2025", "2026 so far"]);
    expect(rows.map((r) => r.members)).toEqual([2, 2, 2, 1, 1]);
    expect(rows.map((r) => r.quietShare)).toEqual([50, 50, 50, 0, 100]);
    expect(rows[4]).toMatchObject({ partial: true, notStarted: 1 });
    expect(rows.slice(0, 4).every((r) => !r.partial)).toBe(true);
  });

  it("leaves members with no creation date out of every group, and handles an empty list", () => {
    expect(quietByJoined([member({ qbCreatedOn: null })], "2026-09-27").every((r) => r.members === 0)).toBe(true);
    expect(visitsByType([]).every((r) => r.members === 0 && r.quietShare === 0)).toBe(true);
  });
});
