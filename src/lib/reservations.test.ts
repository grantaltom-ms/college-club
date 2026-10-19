import { describe, expect, it } from "vitest";
import { convertReservations, toIsoDay } from "./icrew-import";
import {
  asShare,
  byHour,
  byMonth,
  byWeek,
  byWeekday,
  fromCounts,
  orderTypes,
  sampleReservations,
  typeColor,
  typeSummary,
  weekStart,
  type CountRow,
} from "./reservations";

const data = sampleReservations();
const all = new Set(data.types);
const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);
const grand = sum(data.cells.map((c) => c[3]));

describe("reservation types", () => {
  it("orders known types first, in a fixed order, and keeps unknown ones after", () => {
    expect(orderTypes(["Kayak", "Shell", "Zip Line", "Gym Space"])).toEqual(["Gym Space", "Shell", "Kayak", "Zip Line"]);
    expect(typeColor("Shell")).not.toBe(typeColor("Gym Space"));
    expect(typeColor("Zip Line")).toBe(typeColor("Events")); // anything unknown is neutral gray
  });

  it("builds the data from counts and leaves out days that have not happened", () => {
    const rows: CountRow[] = [
      { day: "2026-05-01", hour: 7, item_type: "Shell", reservations: 3 },
      { day: "2026-05-02", hour: 9, item_type: "Kayak", reservations: 2 },
      { day: "2026-05-09", hour: 9, item_type: "Kayak", reservations: 5 },
    ];
    const d = fromCounts(rows, "2026-05-05");
    expect(d).toMatchObject({ first: "2026-05-01", through: "2026-05-02", types: ["Shell", "Kayak"] });
    expect(d.cells).toEqual([
      ["2026-05-01", 7, 0, 3],
      ["2026-05-02", 9, 1, 2],
    ]);
    expect(fromCounts([], "2026-05-05")).toMatchObject({ first: "", through: "", cells: [] });
  });

  it("gives the same total in every breakdown", () => {
    for (const buckets of [byWeek(data, all), byMonth(data, all), byWeekday(data, all), byHour(data, all)]) {
      expect(sum(buckets.map((b) => b.total))).toBe(grand);
      for (const b of buckets) expect(sum(b.counts)).toBe(b.total);
    }
  });

  it("limits every breakdown to the chosen types, and changes nothing else", () => {
    const shell = new Set(["Shell"]);
    const i = data.types.indexOf("Shell");
    const expected = sum(data.cells.filter((c) => c[2] === i).map((c) => c[3]));
    for (const buckets of [byWeek(data, shell), byMonth(data, shell), byWeekday(data, shell), byHour(data, shell)]) {
      expect(sum(buckets.map((b) => b.total))).toBe(expected);
      expect(buckets.every((b) => b.counts.every((n, t) => t === i || n === 0))).toBe(true);
    }
    expect(sum(byMonth(data, new Set()).map((b) => b.total))).toBe(0);
  });

  it("lists every week and month in the period, marking part weeks and the unfinished month", () => {
    const weeks = byWeek(data, all);
    expect(weeks[0].key).toBe(weekStart(data.first)); // the Monday before Jan 1
    expect(weeks[0].key).toBe("2025-12-29");
    expect(weeks[0].complete).toBe(false); // Jan 1 2026 is a Thursday
    expect(weeks[weeks.length - 1].complete).toBe(false);
    expect(weeks.slice(1, -1).every((w) => w.complete)).toBe(true);
    const months = byMonth(data, all);
    expect(months.map((m) => m.key)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(months[0].complete).toBe(true);
    expect(months[9]).toMatchObject({ complete: false, label: "Oct 2026 (so far)" });
  });

  it("covers Monday to Sunday and each start hour in a run", () => {
    expect(byWeekday(data, all).map((b) => b.axis)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const hours = byHour(data, all);
    expect(hours[0].label).toBe("5 am");
    expect(hours.map((h) => Number(h.key))).toEqual(Array.from({ length: hours.length }, (_, k) => 5 + k));
    expect(byHour({ ...data, cells: [] }, all)).toEqual([]);
  });

  it("summarizes each chosen type with its share and busiest times", () => {
    const rows = typeSummary(data, all);
    expect(rows).toHaveLength(data.types.length);
    expect(sum(rows.map((r) => r.total))).toBe(grand);
    expect(rows.map((r) => r.total)).toEqual([...rows.map((r) => r.total)].sort((a, b) => b - a));
    const two = typeSummary(data, new Set(["Shell", "Kayak"]));
    expect(two.map((r) => r.type).sort()).toEqual(["Kayak", "Shell"]);
    expect(sum(two.map((r) => r.share))).toBeGreaterThanOrEqual(99);
    expect(typeSummary({ ...data, cells: [] }, all).every((r) => r.peakWeekday === "—")).toBe(true);
  });

  it("turns counts into shares that add to 100, and handles an empty column", () => {
    expect(asShare([1, 3], 4)).toEqual([25, 75]);
    expect(asShare([0, 0], 0)).toEqual([0, 0]);
    const b = byMonth(data, all)[3];
    expect(sum(asShare(b.counts, b.total))).toBeCloseTo(100, 6);
  });

  it("gives the same answers on repeated use", () => {
    const first = [byWeek(data, all), byMonth(data, all), typeSummary(data, all)];
    for (let i = 0; i < 5; i++) expect([byWeek(data, all), byMonth(data, all), typeSummary(data, all)]).toEqual(first);
    expect(sampleReservations()).toEqual(data);
  });
});

describe("preparing the iCrew reservations export", () => {
  const header = "Date,Day,StartTime,EndTime,BookedOnDate,BookedAtTime,ID,ItemType,Shell/Item,Oars,ReservedBy,Rower(s),OutAt,InAt";
  const row = (date: string, start: string, type: string, who = "Pat Example") =>
    `${date},Thursday,${start},9:00am,01-02-2026,06:25:00,1,"${type}","3-2 Irwin","","${who}","${who} (1)",12:00am,12:00am`;
  const text = [
    header,
    row("01-01-2026", "7:30am", "Shell"),
    row("01-01-2026", "7:45am", "Shell", "Sam Sample"),
    row("01-01-2026", "5:30pm", ""),
    row("01-02-2026", "12:00pm", "Kayak"),
    row("bad-date", "7:30am", "Shell"),
  ].join("\r\n");

  it("reads month-day-year dates", () => {
    expect(toIsoDay("09-08-2026")).toBe("2026-09-08");
    expect(toIsoDay("1-2-2026")).toBe("2026-01-02");
    expect(toIsoDay("2026-09-08")).toBe("");
  });

  it("counts per day, start hour and type, calls blank types Events, and keeps no names", () => {
    const { counts, csv, total, skipped } = convertReservations(text);
    expect(counts).toEqual([
      { day: "2026-01-01", hour: 7, item_type: "Shell", reservations: 2 },
      { day: "2026-01-01", hour: 17, item_type: "Events", reservations: 1 },
      { day: "2026-01-02", hour: 12, item_type: "Kayak", reservations: 1 },
    ]);
    expect(total).toBe(4);
    expect(skipped).toBe(1); // the bad date is reported, not hidden
    expect(csv).not.toMatch(/Pat Example|Sam Sample|Irwin/);
    expect(csv.split("\n")[0]).toBe("day,hour,item_type,reservations");
  });

  it("says plainly when the file is not the reservations export", () => {
    expect(() => convertReservations("Name,Date\nx,01-01-2026")).toThrow(/no "StartTime" column/);
  });
});

describe("top types and other", () => {
  it("keeps the busiest types, adds the rest up as Other, and keeps every total", async () => {
    const { byMonth, collapseTypes, sampleReservations, typesByVolume } = await import("./reservations");
    const data = sampleReservations();
    const all = new Set(data.types);
    const months = byMonth(data, all);
    const v = collapseTypes(data, months, 4);
    expect(v.types).toHaveLength(5);
    expect(v.types[4]).toBe("Other");
    const busiest = typesByVolume(data).slice(0, 4).map((i) => data.types[i]);
    expect([...v.types.slice(0, 4)].sort()).toEqual([...busiest].sort());
    v.buckets.forEach((b, i) => expect(b.total).toBe(months[i].total));
    // Asking again gives the same answer.
    expect(collapseTypes(data, months, 4)).toEqual(v);
  });

  it("leaves short lists alone", async () => {
    const { collapseTypes } = await import("./reservations");
    const data = { source: "sample" as const, first: "2026-01-01", through: "2026-01-02", types: ["A", "B"], cells: [] };
    const out = collapseTypes(data, [], 4);
    expect(out.types).toEqual(["A", "B"]);
  });

  it("names what drives the peak and what leads a set of buckets", async () => {
    const { driverOf, topTypeIn } = await import("./reservations");
    const b = (key: string, counts: number[]) => ({ key, label: key, axis: key, counts, total: counts.reduce((s, n) => s + n, 0), complete: true });
    const buckets = [b("Jan", [100, 10]), b("Feb", [100, 10]), b("Jul", [120, 300])];
    expect(driverOf(["Gym", "Dock"], buckets, buckets[2])).toBe("Dock");
    expect(topTypeIn(["Gym", "Dock"], buckets.slice(0, 2))).toBe("Gym");
    expect(topTypeIn(["Gym", "Dock"], [])).toBeNull();
  });
});
