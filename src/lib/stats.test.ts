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
  filterMembers,
  headline,
  hourSeries,
  matchesPreset,
  multiBooking,
  membersToCsv,
  monthSeries,
  paginate,
  percent,
  presetCounts,
  sortMembers,
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
    monthly: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ...overrides,
  };
}

describe("band summary and headline", () => {
  it("matches the real club's group sizes", () => {
    expect(bandSummary(data.members).map((r) => r.members)).toEqual([63, 122, 96, 81, 188]);
  });

  it("has 550 members, 185 of them under one visit a month", () => {
    const h = headline(data.members);
    expect(h.total).toBe(550);
    expect(h.quiet).toBe(185);
    expect(h.noVisits).toBe(63);
    expect(h.regulars).toBe(188);
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

describe("member groups", () => {
  it("builds the outreach groups from the member list", () => {
    const counts = presetCounts(data.members, data.dataThrough);
    expect(counts.all).toBe(550);
    expect(counts["no-visits"]).toBe(63);
    expect(counts["under-one"]).toBe(122);
    expect(counts["no-fob"]).toBe(data.members.filter((m) => !m.ownFob).length);
  });

  it("calls someone 'gone quiet' only if they usually come monthly and have been away 45+ days", () => {
    const base = "2026-09-27";
    expect(matchesPreset(member({ lastVisit: "2026-08-01" }), "gone-quiet", base)).toBe(true);
    expect(matchesPreset(member({ lastVisit: "2026-09-20" }), "gone-quiet", base)).toBe(false);
    expect(matchesPreset(member({ lastVisit: "2026-08-01", visitsPerMonth: 0.5 }), "gone-quiet", base)).toBe(false);
    expect(matchesPreset(member({ lastVisit: null }), "gone-quiet", base)).toBe(false);
  });

  it("treats 'new' as joined within 90 days", () => {
    const base = "2026-09-27";
    expect(matchesPreset(member({ joined: "2026-08-01" }), "new", base)).toBe(true);
    expect(matchesPreset(member({ joined: "2026-05-01" }), "new", base)).toBe(false);
    expect(matchesPreset(member({ joined: null }), "new", base)).toBe(false);
  });

  it("searches by name, ignoring case and spaces at the ends", () => {
    const first = data.members[0].name;
    const hits = filterMembers(data.members, { query: `  ${first.toUpperCase()} `, preset: "all", dataThrough: data.dataThrough });
    expect(hits.map((m) => m.name)).toContain(first);
  });

  it("combines a group with a search", () => {
    const hits = filterMembers(data.members, { query: "a", preset: "no-visits", dataThrough: data.dataThrough });
    expect(hits.every((m) => m.band === "0 visits" && m.name.toLowerCase().includes("a"))).toBe(true);
  });
});

describe("sorting and paging", () => {
  const a = member({ name: "Ada", lastVisit: "2026-09-01" });
  const b = member({ name: "Ben", lastVisit: null });
  const c = member({ name: "Cy", lastVisit: "2026-08-01" });

  it("puts members with no date last in either direction", () => {
    expect(sortMembers([a, b, c], "lastVisit", "asc").map((m) => m.name)).toEqual(["Cy", "Ada", "Ben"]);
    expect(sortMembers([a, b, c], "lastVisit", "desc").map((m) => m.name)).toEqual(["Ada", "Cy", "Ben"]);
  });

  it("sorts by name both ways and does not change the original list", () => {
    const list = [c, a, b];
    expect(sortMembers(list, "name", "desc").map((m) => m.name)).toEqual(["Cy", "Ben", "Ada"]);
    expect(list.map((m) => m.name)).toEqual(["Cy", "Ada", "Ben"]);
  });

  it("pages through 550 members in 22 pages and keeps the page in range", () => {
    const first = paginate(data.members, 1, 25);
    expect(first.pages).toBe(22);
    expect(first.rows).toHaveLength(25);
    expect(paginate(data.members, 99, 25).page).toBe(22);
    expect(paginate(data.members, 0, 25).page).toBe(1);
    expect(paginate([], 1, 25)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});

describe("CSV export", () => {
  it("writes a header and one line per member", () => {
    const csv = membersToCsv([member({ name: "Ada Lovelace" })]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Name,Usage level,Visits per month,Last visit,Joined,Own door fob");
    expect(lines[1]).toBe("Ada Lovelace,1–2 a month,1.50,2026-09-01,,Yes");
  });

  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    const csv = membersToCsv([member({ name: 'Smith, "Bo"' }), member({ name: "=HYPERLINK(\"x\")" })]);
    expect(csv).toContain('"Smith, ""Bo"""');
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
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
