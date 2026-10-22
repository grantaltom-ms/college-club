import {
  BAND_ORDER,
  type Band,
  type ClubTotal,
  type DashboardData,
  type DoorCell,
  type DoorMonth,
  type DoorPattern,
  type Member,
} from "./types";

/**
 * Made-up data for development and automated tests. Names are invented and
 * numbers only roughly resemble the real club, so nothing here is real member data.
 */

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Avery", "Blake", "Casey", "Devon", "Ellis", "Finley", "Greer", "Harper", "Indigo", "Jules", "Kendall", "Lennox", "Morgan", "Noel", "Oakley", "Parker", "Quincy", "Reese", "Sasha", "Tatum", "Umber", "Vesper", "Wren", "Yael"];
const LAST = ["Alder", "Birch", "Cedar", "Dunmore", "Elmhurst", "Fairweather", "Grayling", "Hollis", "Ivers", "Juniper", "Kestrel", "Lindqvist", "Marlow", "Northcott", "Oakhurst", "Pennywhistle", "Quill", "Rowan", "Sterling", "Thorne", "Underhill", "Vance", "Wexford", "Yarrow"];

/** 497 invented members: 31 who have not visited, plus 11 new ones who have not started yet. */
const NOT_STARTED = 11;
const BAND_COUNTS: Record<Band, number> = {
  "0 visits": 31 + NOT_STARTED,
  "Under 1/month": 102,
  "1-2/month": 80,
  "2-4/month": 75,
  "4+/month": 198,
};
const TYPE_COUNTS: [string, number][] = [
  ["Resident", 432],
  ["Intermediate", 25],
  ["Non-Resident", 40],
];
const BAND_DAYS: Record<Band, [number, number]> = {
  "0 visits": [0, 0],
  "Under 1/month": [1, 8],
  "1-2/month": [9, 17],
  "2-4/month": [18, 35],
  "4+/month": [36, 150],
};

const DATA_THROUGH = "2026-09-27";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dayOffset(base: string, back: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - back));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** A day in `year` (month 1 to `lastMonth`), spread by `r` between 0 and 1. */
function dayIn(year: number, lastMonth: number, r: number): string {
  const month = 1 + Math.floor(r * lastMonth);
  const day = 1 + Math.floor(((r * lastMonth) % 1) * 27);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The QuickBooks list stamps everyone who joined before it was loaded with the same day. */
function createdOn(r: number, r2: number, notAfter2025: boolean): string {
  if (r < 0.34) return "2019-10-18";
  if (r < 0.5) return dayIn(2020 + Math.floor(r2 * 3), 12, r2);
  if (r < 0.72) return dayIn(2023 + Math.floor(r2 * 2), 12, r2);
  if (r < 0.88 || notAfter2025) return dayIn(2025, 12, r2);
  return dayIn(2026, 8, r2);
}

function buildMembers(): Member[] {
  const rand = rng(1910);
  // Separate stream so the booking fields never shift the rest of the sample data.
  const rand2 = rng(2026);
  // A third stream for the QuickBooks fields, so they never shift the rest of the sample data.
  const rand3 = rng(497);
  const types = TYPE_COUNTS.flatMap(([type, count]) => Array<string>(count).fill(type));
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rand3() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  const members: Member[] = [];
  let n = 0;
  for (const band of BAND_ORDER) {
    for (let i = 0; i < BAND_COUNTS[band]; i++) {
      const [lo, hi] = BAND_DAYS[band];
      const visitDays = lo + Math.floor(rand() * (hi - lo + 1));
      const ownFob = rand() < 0.88;
      const monthly = Array<number>(9).fill(0);
      for (let d = 0; d < visitDays; d++) monthly[Math.floor(rand() * 9)] += 1;
      const first = FIRST[n % FIRST.length];
      const last = LAST[Math.floor(n / FIRST.length) % LAST.length];
      const suffix = Math.floor(n / (FIRST.length * LAST.length));
      const doorEntries = ownFob ? Math.round(visitDays * (1 + rand() * 0.3)) : 0;
      const bookingDays = Math.floor(rand() * Math.min(visitDays, 40));
      // About a third of people who book now and then book twice in a day.
      const bookings = bookingDays + (bookingDays > 0 && rand2() < 0.3 ? 1 + Math.floor(rand2() * 12) : 0);
      const notStarted = band === "0 visits" && i < NOT_STARTED;
      // A few members have a door fob but no reservation record: door entries stand in for visits.
      const doorOnly = !notStarted && visitDays > 0 && rand3() < 0.012;
      const created = notStarted ? dayIn(2026, 8, rand3()) : createdOn(rand3(), rand3(), visitDays === 0);
      members.push({
        // Names are unique and sort predictably; a numeral keeps any repeats apart.
        name: suffix ? `${first} ${last} ${suffix + 1}` : `${first} ${last}`,
        band,
        visitsPerMonth: Math.round((visitDays / 8.8) * 100) / 100,
        visitDays,
        doorEntries: doorOnly ? visitDays : doorEntries,
        bookingDays: doorOnly ? 0 : bookingDays,
        bookings: doorOnly ? 0 : bookings,
        earlyShare: !doorOnly && ownFob && visitDays > 0 ? Math.round(rand2() * 100) / 100 : null,
        weekendShare: !doorOnly && ownFob && visitDays > 0 ? Math.round(rand2() * 60) / 100 : null,
        household: rand2() < 0.03,
        lastVisit: visitDays === 0 ? null : dayOffset(DATA_THROUGH, Math.floor(rand() * (band === "4+/month" ? 70 : 200))),
        ownFob: doorOnly || ownFob,
        joined: created,
        memberType: types[n],
        qbCreatedOn: created,
        notStarted,
        monthly: doorOnly ? Array<number>(9).fill(0) : monthly,
      });
      n += 1;
    }
  }
  return members.sort((a, b) => a.name.localeCompare(b.name));
}

/** Split a total across weights so the pieces add up exactly. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.floor((w / sum) * total));
  parts[parts.indexOf(Math.max(...parts))] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/** Invented door pattern: early-morning weekday rush, quieter weekends, busier summers. */
function buildDoor(): DoorPattern {
  const periods = [
    { year: 2025, firstDay: "2025-01-01", lastDay: "2025-12-31", total: 21000, months: [8, 7, 8, 8, 9, 10, 12, 11, 9, 9, 7, 8] },
    { year: 2026, firstDay: "2026-01-01", lastDay: "2026-10-12", total: 19000, months: [8, 7, 8, 9, 10, 9, 13, 12, 9, 4] },
  ];
  const weekdayHours = [0, 0, 0, 0, 3, 11, 9, 6, 7, 7, 5, 4, 4, 4, 5, 6, 8, 8, 5, 3, 2, 1, 0, 0];
  const weekendHours = [0, 0, 0, 0, 0, 5, 4, 3, 4, 4, 5, 5, 5, 5, 5, 5, 4, 3, 2, 2, 1, 0, 0, 0];
  const dayWeights = [16, 14, 15, 14, 15, 9, 8];
  const cells: DoorCell[] = [];
  const months: DoorMonth[] = [];
  for (const p of periods) {
    const weights: number[] = [];
    const keys: [number, number][] = [];
    for (let w = 0; w < 7; w++)
      for (let h = 0; h < 24; h++) {
        const weight = dayWeights[w] * (w >= 5 ? weekendHours[h] : weekdayHours[h]);
        if (weight > 0) {
          weights.push(weight);
          keys.push([w, h]);
        }
      }
    allocate(p.total, weights).forEach((v, i) =>
      cells.push({ year: p.year, weekday: keys[i][0], hour: keys[i][1], allEntries: v, memberEntries: Math.round(v * 0.94) }),
    );
    allocate(p.total, p.months).forEach((v, i) =>
      months.push({ year: p.year, month: i + 1, allEntries: v, memberEntries: Math.round(v * 0.94), people: Math.round(v / 8) }),
    );
  }
  return { periods: periods.map(({ year, firstDay, lastDay }) => ({ year, firstDay, lastDay })), cells, months };
}

function buildTotals(): ClubTotal[] {
  const rows: ClubTotal[] = [];
  const rand = rng(7);
  const days = 638;
  for (let i = 0; i < days; i++) {
    const day = dayOffset("2026-09-30", days - 1 - i);
    const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
    const month = Number(day.slice(5, 7));
    const season = month >= 5 && month <= 9 ? 1.2 : 0.7;
    rows.push({
      measure: "icrew_bookings_by_day",
      key: day,
      allEntries: Math.round((weekend ? 45 : 110) * season * (0.6 + rand() * 0.8) * (day >= "2026-01-01" ? 0.85 : 1)),
      memberEntries: null,
    });
  }
  return rows;
}

export function sampleData(): DashboardData {
  return {
    source: "sample",
    dataThrough: DATA_THROUGH,
    members: buildMembers(),
    roster: { source: "QuickBooks member list", asOf: "2026-10-21" },
    totals: buildTotals(),
    door: buildDoor(),
  };
}
