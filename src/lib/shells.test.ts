import { describe, expect, it } from "vitest";
import { convert, parseCsv, rowerKey, to24h } from "./icrew-import";
import {
  byBoat,
  byStartHour,
  byWeekday,
  monthCompare,
  monthTimeline,
  sameDateCutoff,
  sampleShells,
  yearToDate,
  type Outing,
} from "./shells";
import { countRowers, toOuting, toShellData, type ShellRow } from "./supabase";

const data = sampleShells();
const outing = (day: string, extra: Partial<Outing> = {}): Outing => ({
  boat: "Heron",
  seats: 1,
  day,
  team: false,
  minutes: 90,
  startHour: 7,
  ...extra,
});

describe("shell stats", () => {
  it("compares the same dates in each year", () => {
    expect(sameDateCutoff(2025, "2026-10-12")).toBe("2025-10-12");
    const outings = [outing("2025-03-01"), outing("2025-10-12"), outing("2025-10-13"), outing("2026-01-05", { team: true }), outing("2026-10-12")];
    expect(yearToDate(outings, "2026-10-12")).toEqual([
      { year: 2025, outings: 2, member: 2, team: 0 },
      { year: 2026, outings: 2, member: 1, team: 1 },
    ]);
  });

  it("lists every month to the last day, with empty months and the unfinished one marked", () => {
    const outings = [outing("2025-11-03"), outing("2026-01-10", { team: true }), outing("2026-02-14")];
    const t = monthTimeline(outings, "2026-02-14");
    expect(t.map((m) => m.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(t[1]).toMatchObject({ member: 0, team: 0, complete: true });
    expect(t[2]).toMatchObject({ member: 0, team: 1 });
    expect(t[3].complete).toBe(false);
    expect(monthTimeline([], "2026-01-01")).toEqual([]);
  });

  it("lines up months across years and only gives a change when both are finished", () => {
    const c = monthCompare(data.outings, data.through);
    expect(c.years).toEqual([2025, 2026]);
    expect(c.rows).toHaveLength(12);
    const jul = c.rows[6];
    const total = (i: number) => jul.years[i]!.member + jul.years[i]!.team;
    expect(jul.change).toBe(Math.round((total(1) / total(0) - 1) * 100));
    expect(c.rows[9].change).toBeNull(); // October 2026 is not finished
    expect(c.rows[11].years[1]).toBeNull(); // December 2026 has not happened
  });

  it("counts each boat over the same dates, busiest this year first", () => {
    const b = byBoat(data.outings, data.through);
    const latest = b.rows.map((r) => r.sameDates[1]);
    expect(latest).toEqual([...latest].sort((x, y) => y - x));
    const ytd = yearToDate(data.outings, data.through);
    expect(b.rows.reduce((s, r) => s + r.sameDates[0], 0)).toBe(ytd[0].outings);
    expect(b.rows.reduce((s, r) => s + r.sameDates[1], 0)).toBe(ytd[1].outings);
  });

  it("counts outings by start hour and weekday for one year", () => {
    const hours = byStartHour(data.outings, 2026);
    const in2026 = data.outings.filter((o) => o.day.startsWith("2026-"));
    expect(hours.reduce((s, h) => s + h.outings, 0)).toBe(in2026.length);
    expect(hours[0].label).toBe("5 am");
    expect(byWeekday(data.outings, 2026).reduce((s, w) => s + w.outings, 0)).toBe(in2026.length);
    expect(byStartHour([], 2026)).toEqual([]);
  });

  it("gives the same answers on repeated use", () => {
    const first = [yearToDate(data.outings, data.through), monthCompare(data.outings, data.through), byBoat(data.outings, data.through)];
    for (let i = 0; i < 5; i++) {
      expect([yearToDate(data.outings, data.through), monthCompare(data.outings, data.through), byBoat(data.outings, data.through)]).toEqual(first);
    }
    expect(sampleShells()).toEqual(data);
  });
});

describe("shell rows from the database", () => {
  const row = (day: string, rower: string | null, extra: Partial<ShellRow> = {}): ShellRow => ({
    boat: "Heron",
    seats: 1,
    day,
    kind: rower ? "member" : "team",
    minutes: 90,
    start_time: "07:30:00",
    rower_key: rower,
    ...extra,
  });

  it("sends the boat, day and time but never the rower code", () => {
    const o = toOuting(row("2026-05-01", "abc123"));
    expect(o).toEqual({ boat: "Heron", seats: 1, day: "2026-05-01", team: false, minutes: 90, startHour: 7 });
    expect(JSON.stringify(o)).not.toContain("abc123");
    expect(toOuting(row("2026-05-01", null, { start_time: null })).startHour).toBeNull();
    expect(toOuting(row("2026-05-01", null)).team).toBe(true);
  });

  it("counts different rowers per year and over the same dates", () => {
    const rows = [row("2025-02-01", "a"), row("2025-11-01", "b"), row("2026-01-01", "a"), row("2026-01-02", "a"), row("2026-01-03", null)];
    expect(countRowers(rows, "2026-03-01")).toEqual([
      { year: 2025, rowers: 2, sameDates: 1 },
      { year: 2026, rowers: 1, sameDates: 1 },
    ]);
  });

  it("leaves out bookings after today and stops the data on the last real day", () => {
    const d = toShellData([row("2026-10-10", "a"), row("2026-10-20", "b")], "2026-10-14");
    expect(d.through).toBe("2026-10-10");
    expect(d.outings).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/rower_key|"a"|"b"/);
  });
});

describe("preparing the iCrew export", () => {
  const exportText = [
    "﻿Name,Seats,Rigging,Date,Team,UsageType,TimeUsed (hh:mm),MinutesUsed,MetersRowed,StartTime,EndTime",
    '"#204",2,Scull,2026-10-11,"","Rowed by Pat Example",01:30,90,0.00,4:00pm,5:30pm',
    '"Gone, Fishin\'",1,un,2026-10-12,"","Rowed by Pat Example",01:00,60,,12:30am,1:30am',
    '"Blue",2,Sweep,2025-07-01,"Summer Camp 6/16-7/4","Team Session",02:00,120,,7:00am,9:00am',
  ].join("\r\n");

  it("reads quoted fields with commas", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
  });

  it("converts clock times", () => {
    expect(to24h("4:00pm")).toBe("16:00");
    expect(to24h("12:30am")).toBe("00:30");
    expect(to24h("12:00pm")).toBe("12:00");
    expect(to24h("")).toBe("");
  });

  it("replaces names with a code, marks camps, and keeps every row", () => {
    const { rows, csv } = convert(exportText, "test-secret");
    expect(rows).toHaveLength(3);
    expect(csv).not.toContain("Pat Example");
    expect(rows[0]).toMatchObject({ boat: "#204", kind: "member", start_time: "16:00", end_time: "17:30", rigging: "Scull" });
    expect(rows[0].rower_key).toBe(rowerKey("Pat Example", "test-secret"));
    expect(rows[1].rower_key).toBe(rows[0].rower_key); // same person, same code
    expect(rows[1]).toMatchObject({ boat: "Gone, Fishin'", rigging: "" });
    expect(rows[2]).toMatchObject({ kind: "team", team: "Summer Camp 6/16-7/4", rower_key: "" });
    expect(parseCsv(csv)[0]).toEqual(["boat", "seats", "rigging", "day", "kind", "team", "minutes", "start_time", "end_time", "rower_key"]);
    expect(parseCsv(csv)[2][0]).toBe("Gone, Fishin'");
  });

  it("uses a new scramble each run unless given one", () => {
    expect(convert(exportText).rows[0].rower_key).not.toBe(convert(exportText).rows[0].rower_key);
  });

  it("says plainly when the file is not the shell export", () => {
    expect(() => convert("Name,Date\nx,2026-01-01")).toThrow(/no "Seats" column/);
  });
});

describe("boatChanges", () => {
  it("sorts drops and gains by count and finds boats that started or stopped", async () => {
    const { boatChanges } = await import("./shells");
    const row = (boat: string, a: number, b: number) => ({ boat, seats: 1, sameDates: [a, b], change: null });
    const c = boatChanges([row("A", 242, 156), row("B", 183, 105), row("C", 61, 149), row("D", 0, 75), row("E", 148, 0), row("F", 10, 10), row("G", 98, 15)], 2);
    expect(c.drops.map((r) => r.boat)).toEqual(["A", "G"]);
    expect(c.gains.map((r) => r.boat)).toEqual(["C"]);
    expect(c.started.map((r) => r.boat)).toEqual(["D"]);
    expect(c.stopped.map((r) => r.boat)).toEqual(["E"]);
  });

  it("has nothing to compare with a single year", async () => {
    const { boatChanges } = await import("./shells");
    const c = boatChanges([{ boat: "A", seats: 1, sameDates: [12], change: null }]);
    expect(c).toEqual({ drops: [], gains: [], started: [], stopped: [] });
  });
});
