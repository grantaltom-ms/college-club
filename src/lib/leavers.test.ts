import { describe, expect, it } from "vitest";
import { analyzeLeavers, ENOUGH_TO_COMPARE, MONTHS_BEFORE, sampleLeavers, seasonSplit, type ResignationRecord } from "./leavers";
import type { Member, MembershipMonth } from "./types";

const THROUGH = "2026-11-10";

/** An invented member. `monthly` is visit days Jan..Nov. */
function member(name: string, monthly: number[], overrides: Partial<Member> = {}): Member {
  const visitDays = monthly.reduce((a, b) => a + b, 0);
  const perMonth = visitDays / 10.3;
  const lastIdx = monthly.map((v, i) => (v > 0 ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  return {
    name,
    band: visitDays === 0 ? "0 visits" : perMonth < 1 ? "Under 1/month" : perMonth < 2 ? "1-2/month" : perMonth < 4 ? "2-4/month" : "4+/month",
    visitsPerMonth: perMonth,
    visitDays,
    doorEntries: visitDays,
    bookingDays: 0,
    bookings: 0,
    earlyShare: null,
    weekendShare: visitDays > 0 ? 0.2 : null,
    household: false,
    lastVisit: lastIdx < 0 ? null : `2026-${String(lastIdx + 1).padStart(2, "0")}-15`,
    ownFob: true,
    joined: "2019-10-18",
    memberType: "Resident",
    qbCreatedOn: "2019-10-18",
    notStarted: false,
    monthly: [...monthly, ...Array(11 - monthly.length).fill(0)],
    ...overrides,
  };
}

const zero = () => Array(11).fill(0);
const ghost = (name: string, o: Partial<Member> = {}) => member(name, zero(), o);
const summer = (name: string, o: Partial<Member> = {}) => member(name, [0, 0, 0, 0, 0, 2, 3, 1, 0, 0, 0], o);
const regular = (name: string) => member(name, [8, 8, 9, 9, 10, 10, 10, 9, 8, 8, 3]);
const light = (name: string) => member(name, [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);

/** Five invented leavers and a small invented roster of stayers. */
function club() {
  const leavers = [ghost("Ann Leaver"), summer("Bo Leaver", { memberType: "Non-Resident" }), summer("Cy Leaver"), ghost("Di Mover"), regular("Ed Mover")];
  const stayers = [...Array.from({ length: 6 }, (_, i) => light(`Low Stayer ${i}`)), ghost("Zero Stayer"), ...Array.from({ length: 8 }, (_, i) => regular(`Reg ${i}`))];
  const resignations: ResignationRecord[] = [
    { name: "Ann Leaver", resignedOn: "2026-11-17", reason: "not_using" },
    { name: "Bo Leaver", resignedOn: "2026-11-17", reason: "not_using" },
    { name: "Cy Leaver", resignedOn: "2026-11-17", reason: "not_using" },
    { name: "Di Mover", resignedOn: "2026-11-17", reason: "moved" },
    { name: "Ed Mover", resignedOn: "2026-11-17", reason: "other" },
  ];
  return { usage: [...leavers, ...stayers], stayers, resignations };
}

describe("analyzeLeavers", () => {
  it("sorts people into the four groups and never counts a resigned name as a stayer", () => {
    const { usage, stayers, resignations } = club();
    // A leaver whose roster row has not been taken off yet is still a leaver.
    const a = analyzeLeavers(resignations, usage, [...stayers, usage[0]], THROUGH, "live");
    const people = Object.fromEntries(a.groups.map((g) => [g.key, g.people]));
    expect(people).toEqual({ notUsing: 3, otherReasons: 2, lowStayed: 7, allStayed: 15 });
    expect(a.resignations).toBe(5);
    expect(a.matched).toBe(5);
    expect(a.from).toBe("2026-11-17");
  });

  it("counts a resignation with no usage record but leaves it out of the comparisons", () => {
    const { usage, stayers, resignations } = club();
    const a = analyzeLeavers([...resignations, { name: "Nobody Known", resignedOn: "2026-10-20", reason: "not_using" }], usage, stayers, THROUGH, "live");
    expect(a.resignations).toBe(6);
    expect(a.matched).toBe(5);
    expect(a.from).toBe("2026-10-20");
    expect(a.groups.find((g) => g.key === "notUsing")?.people).toBe(3);
  });

  it("averages visit days counted back from the resignation month, most distant first", () => {
    const { usage, stayers, resignations } = club();
    const a = analyzeLeavers(resignations, usage, stayers, THROUGH, "live");
    const notUsing = a.groups.find((g) => g.key === "notUsing")!;
    expect(notUsing.monthsBefore).toHaveLength(MONTHS_BEFORE);
    // Resigned in November (counted from Nov, the data end's month): 6 months before is May, 1 month before is October.
    // May 0, Jun (0+2+2)/3, Jul (0+3+3)/3, Aug (0+1+1)/3, Sep 0, Oct 0.
    expect(notUsing.monthsBefore).toEqual([0, 1.3, 2, 0.7, 0, 0]);
  });

  it("leaves a month before the data starts as no figure, not zero", () => {
    const early = [member("Early Leaver", [2, 0, 0])];
    const a = analyzeLeavers([{ name: "Early Leaver", resignedOn: "2026-03-05", reason: "not_using" }], early, [], THROUGH, "live");
    // March: 6..3 months before fall in 2025, which this data does not hold.
    expect(a.groups.find((g) => g.key === "notUsing")!.monthsBefore).toEqual([null, null, null, null, 2, 0]);
  });

  it("works out the traits as shares of each group", () => {
    const { usage, stayers, resignations } = club();
    const a = analyzeLeavers(resignations, usage, stayers, THROUGH, "live");
    const trait = (key: string) => a.traits.find((t) => t.key === key)!.values;
    expect(trait("none")).toEqual({ notUsing: 33, otherReasons: 50, lowStayed: 14, allStayed: 7 });
    expect(trait("summer")).toEqual({ notUsing: 67, otherReasons: 0, lowStayed: 0, allStayed: 0 });
    expect(trait("nonresident").notUsing).toBe(33);
    // The weekend share only counts people with door data: the zero-visit leaver has none.
    expect(trait("weekend").notUsing).toBe(0);
  });

  it("gives each usage group its resignations and the share who left", () => {
    const { usage, stayers, resignations } = club();
    const a = analyzeLeavers(resignations, usage, stayers, THROUGH, "live");
    const none = a.bands.find((b) => b.band === "0 visits")!;
    expect(none).toMatchObject({ people: 3, resignedNotUsing: 1, resignedOther: 1, rate: 67 });
    const weekly = a.bands.find((b) => b.band === "4+/month")!;
    expect(weekly).toMatchObject({ people: 9, resignedNotUsing: 0, resignedOther: 1, rate: 11 });
  });

  it("says where resignations come from, flags 'moved' that looks like not using, and marks small groups as early hints", () => {
    const { usage, stayers, resignations } = club();
    const a = analyzeLeavers(resignations, usage, stayers, THROUGH, "live");
    expect(a.enough).toBe(false);
    expect(a.insights[0]).toBe("4 of 5 resignations came from members who visited less than once a month, a group that is 55% of members.");
    expect(a.insights).toContain(
      '1 member who gave another reason (usually moving) had also not visited in the 3 months before resigning, so "not using it" may be undercounted.',
    );
    expect(a.insights.some((l) => l.startsWith("Early hint (only 3 people): Came only in summer"))).toBe(true);
  });

  it("drops the early-hint label once enough people have resigned for not using it", () => {
    const leavers = Array.from({ length: ENOUGH_TO_COMPARE }, (_, i) => summer(`Leaver ${i}`));
    const stayers = Array.from({ length: 20 }, (_, i) => light(`Stayer ${i}`));
    const a = analyzeLeavers(
      leavers.map((m) => ({ name: m.name, resignedOn: "2026-11-17", reason: "not_using" as const })),
      [...leavers, ...stayers],
      stayers,
      THROUGH,
      "live",
    );
    expect(a.enough).toBe(true);
    expect(a.insights.some((l) => l.includes("Early hint"))).toBe(false);
    expect(a.insights).toContain("Came only in summer (June to August): 100% of those who resigned for not using it, against 0% of low-use members who stayed.");
  });

  it("has no insights and no shares when nothing is loaded", () => {
    const a = analyzeLeavers([], [], [], THROUGH, "live");
    expect(a.insights).toEqual([]);
    expect(a.traits.every((t) => t.values.notUsing === null)).toBe(true);
  });

  it("never sends a name: the answer holds only counts, averages, percentages and labels", () => {
    const { usage, stayers, resignations } = club();
    const text = JSON.stringify(analyzeLeavers(resignations, usage, stayers, THROUGH, "live"));
    for (const m of usage) expect(text).not.toContain(m.name);
  });
});

describe("seasonSplit", () => {
  const month = (m: number, notUsing: number | null) => ({ year: 2026, month: m, resignationsNotUsing: notUsing }) as MembershipMonth;
  it("adds 'not using it' resignations in Oct to Mar against Apr to Sep, skipping months with no split", () => {
    expect(seasonSplit([month(1, 3), month(4, 1), month(9, 2), month(10, 4), month(6, null)])).toEqual({
      darkMonths: 7,
      lightMonths: 3,
      darkCount: 2,
      lightCount: 2,
    });
  });
  it("is null when no month has a split", () => {
    expect(seasonSplit([month(1, null)])).toBeNull();
  });
});

describe("sampleLeavers", () => {
  it("is labelled sample and has resigners in every reason group", () => {
    const s = sampleLeavers();
    expect(s.source).toBe("sample");
    expect(s.groups.find((g) => g.key === "notUsing")!.people).toBeGreaterThan(0);
    expect(s.groups.find((g) => g.key === "otherReasons")!.people).toBeGreaterThan(0);
    expect(s.insights.length).toBeGreaterThan(0);
  });
});

describe("db/resignations.sql", () => {
  it("turns row level security on, adds no policy and holds no real rows", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("db/resignations.sql", "utf8");
    expect(sql).toMatch(/alter table public\.resignations enable row level security;/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/insert into/i);
    expect(sql).toMatch(/check \(reason in \('moved', 'not_using', 'other'\)\)/);
  });
});
