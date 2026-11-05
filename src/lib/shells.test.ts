import { describe, expect, it } from "vitest";
import { convert, parseCsv, rowerKey, to24h } from "./icrew-import";
import {
  byBoat,
  byStartHour,
  byWeekday,
  memberOutingsBefore,
  memberYearComparable,
  monthCompare,
  monthStacks,
  monthTimeline,
  normalizeShellOwnership,
  outingsForShellCharts,
  sameDateCutoff,
  sampleShells,
  shellOwnershipQuery,
  yearToDate,
  type Outing,
  type ShellData,
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

describe("shell ownership", () => {
  it("treats a blank or unknown choice as club boats", () => {
    expect(normalizeShellOwnership(null)).toEqual(["club"]);
    expect(normalizeShellOwnership("")).toEqual(["club"]);
    expect(normalizeShellOwnership("nope")).toEqual(["club"]);
    expect(normalizeShellOwnership("club")).toEqual(["club"]);
    expect(normalizeShellOwnership(" MEMBER ")).toEqual(["member"]);
    expect(normalizeShellOwnership("member,club")).toEqual(["club", "member"]);
    expect(normalizeShellOwnership(["member", "club", "club"])).toEqual(["club", "member"]);
    expect(shellOwnershipQuery(["member", "club"])).toBe("club,member");
  });

  it("keeps the default sample on the club fleet", () => {
    expect(sampleShells(["club"])).toEqual(sampleShells());
    expect(sampleShells("club")).toEqual(sampleShells());
    expect(sampleShells("nope")).toEqual(sampleShells());
    expect(sampleShells().ownership).toBeUndefined();
    expect(sampleShells().memberFrom).toBeUndefined();
  });

  it("adds member-owned outings only in 2026 and leaves the 2025 club count untouched", () => {
    const club = sampleShells();
    const member = sampleShells("member");
    const both = sampleShells("club,member");
    const clubBoats = new Set(club.outings.map((o) => o.boat));
    expect(member.ownership).toEqual(["member"]);
    expect(member.memberFrom).toBe("2026-01-01");
    expect(member.outings.length).toBeGreaterThan(0);
    expect(member.outings.every((o) => o.day >= "2026-01-01" && !clubBoats.has(o.boat))).toBe(true);
    expect(member.outings.some((o) => o.day.startsWith("2025"))).toBe(false);
    expect(monthCompare(member.outings, member.through).years).toEqual([2026]);
    const in2025 = (rows: Outing[]) => rows.filter((o) => o.day.startsWith("2025")).length;
    expect(in2025(both.outings)).toBe(in2025(club.outings));
    expect(both.outings.filter((o) => o.day.startsWith("2026")).length).toBe(
      club.outings.filter((o) => o.day.startsWith("2026")).length + member.outings.length,
    );
    expect(both.through).toBe(club.through);
    expect(both.rowers.find((r) => r.year === 2025)).toEqual(club.rowers.find((r) => r.year === 2025));
    expect(both.ownership).toEqual(["club", "member"]);
    expect(member.outings.every((o) => o.ownership === "member")).toBe(true);
  });
});

describe("monthly ownership stacks", () => {
  it("stacks club under member-owned and leaves an unfinished month blank", () => {
    const through = "2026-11-04";
    const rows = [
      outing("2025-01-10"),
      outing("2025-01-11"),
      outing("2025-01-12"),
      outing("2025-01-13"),
      outing("2025-11-02"),
      outing("2026-01-08"),
      outing("2026-01-09"),
      outing("2026-01-10", { ownership: "member", boat: "Puffin" }),
      outing("2026-01-11", { ownership: "member", boat: "Puffin" }),
      outing("2026-11-01", { ownership: "member", boat: "Puffin" }),
      outing("2026-11-02"),
    ];
    const stacks = monthStacks(rows, through);
    const jan = stacks.rows[0];
    expect(jan.columns.map((c) => c.segments)).toEqual([
      [4, 0],
      [2, 2],
    ]);
    expect(jan.columns.map((c) => c.total)).toEqual([4, 4]);
    expect(jan.clubChange).toBe(Math.round((2 / 4 - 1) * 100));
    const nov = stacks.rows[10];
    expect(nov.columns[0]).toMatchObject({ total: 1, segments: [1, 0] });
    expect(nov.columns[1]).toEqual({ year: 2026, total: 0, segments: [0, 0] });
    expect(nov.clubChange).toBeNull();
    expect(stacks.rows[11].columns[1].total).toBe(0);
  });

  it("keeps club segments equal to the club-only series on the sample", () => {
    const club = sampleShells();
    const both = sampleShells("club,member");
    const clubStacks = monthStacks(club.outings, club.through);
    const bothStacks = monthStacks(both.outings, both.through);
    expect(bothStacks.years).toEqual([2025, 2026]);
    for (const row of bothStacks.rows) {
      const clubRow = clubStacks.rows[row.month - 1];
      expect(row.columns[0].segments[0]).toBe(clubRow.columns[0].segments[0]);
      expect(row.columns[0].segments[1]).toBe(0);
      expect(row.columns[1].segments[0]).toBe(clubRow.columns[1].segments[0]);
    }
    expect(bothStacks.rows[6].columns[1].segments[1]).toBeGreaterThan(0);
    expect(bothStacks.rows[9].columns[1].total).toBe(0);
  });

  it("uses a real prior member year and does not treat a handful of rows as a fleet", () => {
    const thin = [outing("2025-03-01", { ownership: "member" }), outing("2026-03-01", { ownership: "member" })];
    expect(memberYearComparable(1)).toBe(false);
    expect(memberYearComparable(50)).toBe(true);
    expect(memberOutingsBefore(thin, 2026)).toBe(1);
    const memberOnly: Pick<ShellData, "outings" | "ownership"> = { outings: thin, ownership: ["member"] };
    expect(outingsForShellCharts(memberOnly).map((o) => o.day)).toEqual(["2026-03-01"]);
    const full = [
      ...Array.from({ length: 50 }, (_, i) => outing(`2025-06-${String((i % 28) + 1).padStart(2, "0")}`, { ownership: "member", boat: "Puffin" })),
      outing("2026-06-01", { ownership: "member", boat: "Puffin" }),
    ];
    expect(outingsForShellCharts({ outings: full, ownership: ["member"] })).toHaveLength(51);
    const both: Pick<ShellData, "outings" | "ownership"> = { outings: [outing("2025-01-02"), ...thin], ownership: ["club", "member"] };
    expect(outingsForShellCharts(both)).toHaveLength(3);
    const stacked = monthStacks(both.outings, "2026-04-01");
    expect(stacked.rows[0].columns[0].segments).toEqual([1, 0]);
    expect(stacked.rows[2].columns[0].segments).toEqual([0, 1]);
    expect(stacked.rows[2].columns[1].segments).toEqual([0, 1]);
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
