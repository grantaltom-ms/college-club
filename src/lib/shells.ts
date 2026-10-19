import { formatMonth, weekdayIndex, WEEKDAY_NAMES, WEEKDAYS } from "./dates";

/** One time a boat went out. Never carries a rower's name. */
export interface Outing {
  boat: string;
  /** 1 = single, 2 = double, 4 = quad or four. */
  seats: number;
  /** YYYY-MM-DD. */
  day: string;
  /** True for camps and team sessions, false for a member's own row. */
  team: boolean;
  minutes: number;
  /** Clock hour the outing started, 0 to 23, or null if unknown. */
  startHour: number | null;
}

/** Different rowers in a year, counted on the server so no rower identity reaches the browser. */
export interface RowerCount {
  year: number;
  /** Whole year (or as far as the data goes). */
  rowers: number;
  /** Jan 1 to the same month and day as the data's last day, so years compare fairly. */
  sameDates: number;
}

export interface ShellData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  /** Last day of shell data, YYYY-MM-DD. */
  through: string;
  outings: Outing[];
  rowers: RowerCount[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function monthEnd(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** The last day of `year` that lines up with `through`, so "so far this year" compares like with like. */
export function sameDateCutoff(year: number, through: string): string {
  return `${year}${through.slice(4)}`;
}

export function shellYears(outings: Outing[]): number[] {
  return [...new Set(outings.map((o) => Number(o.day.slice(0, 4))))].sort((a, b) => a - b);
}

export function changePct(now: number, before: number): number | null {
  return before > 0 ? Math.round((now / before - 1) * 100) : null;
}

export const seatLabel = (seats: number) => (seats === 1 ? "Single" : seats === 2 ? "Double" : seats === 4 ? "Quad/four" : `${seats} seats`);

/* ---------- So far this year ---------- */

export interface YearToDate {
  year: number;
  outings: number;
  member: number;
  team: number;
}

/** Outings from Jan 1 to the same month and day as `through`, for every year. */
export function yearToDate(outings: Outing[], through: string): YearToDate[] {
  return shellYears(outings).map((year) => {
    const from = `${year}-01-01`;
    const to = sameDateCutoff(year, through);
    const inRange = outings.filter((o) => o.day >= from && o.day <= to);
    const team = inRange.filter((o) => o.team).length;
    return { year, outings: inRange.length, member: inRange.length - team, team };
  });
}

/* ---------- Every month ---------- */

export interface MonthPoint {
  /** YYYY-MM. */
  key: string;
  year: number;
  month: number;
  label: string;
  member: number;
  team: number;
  /** False when the data stops partway through the month. */
  complete: boolean;
}

/** Every month from the first outing to `through`, oldest first. */
export function monthTimeline(outings: Outing[], through: string): MonthPoint[] {
  if (outings.length === 0) return [];
  const counts = new Map<string, { member: number; team: number }>();
  for (const o of outings) {
    const key = o.day.slice(0, 7);
    const c = counts.get(key) ?? { member: 0, team: 0 };
    if (o.team) c.team += 1;
    else c.member += 1;
    counts.set(key, c);
  }
  const first = outings.reduce((min, o) => (o.day < min ? o.day : min), outings[0].day);
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  const last = through.slice(0, 7);
  const points: MonthPoint[] = [];
  for (let key = `${year}-${pad2(month)}`; key <= last; ) {
    const c = counts.get(key) ?? { member: 0, team: 0 };
    points.push({ key, year, month, label: formatMonth(key), ...c, complete: monthEnd(year, month) <= through });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    key = `${year}-${pad2(month)}`;
  }
  return points;
}

export interface MonthCompareRow {
  month: number;
  label: string;
  /** One point per year, oldest year first; null where the data has not reached that month. */
  years: (MonthPoint | null)[];
  /** Percent change in all outings from the oldest to the newest year, when both months are complete. */
  change: number | null;
}

/** Each calendar month with every year next to each other. */
export function monthCompare(outings: Outing[], through: string): { years: number[]; rows: MonthCompareRow[] } {
  const timeline = monthTimeline(outings, through);
  const years = shellYears(outings);
  const byKey = new Map(timeline.map((m) => [m.key, m]));
  const rows = Array.from({ length: 12 }, (_, i) => {
    const points = years.map((y) => byKey.get(`${y}-${pad2(i + 1)}`) ?? null);
    const first = points[0];
    const last = points[points.length - 1];
    const comparable = years.length > 1 && !!first?.complete && !!last?.complete;
    return {
      month: i + 1,
      label: formatMonth(`2000-${pad2(i + 1)}`),
      years: points,
      change: comparable ? changePct(last!.member + last!.team, first!.member + first!.team) : null,
    };
  });
  return { years, rows: years.length ? rows : [] };
}

/* ---------- Boats ---------- */

export interface BoatRow {
  boat: string;
  seats: number;
  /** Outings Jan 1 to the matching day, one per year, oldest year first. */
  sameDates: number[];
  change: number | null;
}

/** Each boat's outings so far this year against the same dates in earlier years, busiest first. */
export function byBoat(outings: Outing[], through: string): { years: number[]; rows: BoatRow[] } {
  const years = shellYears(outings);
  const boats = new Map<string, { seats: number; counts: number[] }>();
  for (const o of outings) {
    const year = Number(o.day.slice(0, 4));
    const entry = boats.get(o.boat) ?? { seats: o.seats, counts: years.map(() => 0) };
    if (o.day <= sameDateCutoff(year, through)) entry.counts[years.indexOf(year)] += 1;
    boats.set(o.boat, entry);
  }
  const rows = [...boats.entries()].map(([boat, e]) => ({
    boat,
    seats: e.seats,
    sameDates: e.counts,
    change: years.length > 1 ? changePct(e.counts[e.counts.length - 1], e.counts[0]) : null,
  }));
  rows.sort((a, b) => b.sameDates[b.sameDates.length - 1] - a.sameDates[a.sameDates.length - 1] || a.boat.localeCompare(b.boat));
  return { years, rows };
}

export interface BoatChanges {
  /** Biggest falls and rises in outings against the earlier year, by count, largest first. */
  drops: BoatRow[];
  gains: BoatRow[];
  /** Boats with outings this year and none in the earlier year, and the reverse. Often a new or retired boat, sometimes a renamed one. */
  started: BoatRow[];
  stopped: BoatRow[];
}

/** The boats whose use changed most between the first and last year in `rows`. */
export function boatChanges(rows: BoatRow[], count = 3): BoatChanges {
  const diff = (b: BoatRow) => b.sameDates[b.sameDates.length - 1] - b.sameDates[0];
  const both = rows.filter((b) => b.sameDates.length > 1 && b.sameDates[0] > 0 && b.sameDates[b.sameDates.length - 1] > 0);
  return {
    drops: both.filter((b) => diff(b) < 0).sort((a, b) => diff(a) - diff(b)).slice(0, count),
    gains: both.filter((b) => diff(b) > 0).sort((a, b) => diff(b) - diff(a)).slice(0, count),
    started: rows.filter((b) => b.sameDates.length > 1 && b.sameDates[0] === 0 && b.sameDates[b.sameDates.length - 1] > 0),
    stopped: rows.filter((b) => b.sameDates.length > 1 && b.sameDates[0] > 0 && b.sameDates[b.sameDates.length - 1] === 0),
  };
}

/* ---------- When boats go out ---------- */

export interface HourCount {
  hour: number;
  label: string;
  outings: number;
}

export function hourLabel(hour: number): string {
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** Outings by the hour they started, from the earliest to the latest start hour used. */
export function byStartHour(outings: Outing[], year: number): HourCount[] {
  const hours = outings.filter((o) => o.day.startsWith(`${year}-`) && o.startHour !== null).map((o) => o.startHour as number);
  if (hours.length === 0) return [];
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  return Array.from({ length: hi - lo + 1 }, (_, i) => {
    const hour = lo + i;
    return { hour, label: hourLabel(hour), outings: hours.filter((h) => h === hour).length };
  });
}

export interface WeekdayCount {
  index: number;
  short: string;
  name: string;
  outings: number;
}

export function byWeekday(outings: Outing[], year: number): WeekdayCount[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const o of outings) if (o.day.startsWith(`${year}-`)) counts[weekdayIndex(o.day)] += 1;
  return counts.map((outings, index) => ({ index, short: WEEKDAYS[index], name: WEEKDAY_NAMES[index], outings }));
}

/* ---------- Sample data ---------- */

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_BOATS: [string, number, number][] = [
  // name, seats, how popular
  ["Heron", 1, 9],
  ["Osprey", 1, 8],
  ["Kingfisher", 1, 8],
  ["Cormorant", 1, 6],
  ["Merganser", 1, 5],
  ["Grebe", 1, 3],
  ["Loon", 2, 7],
  ["Pelican", 2, 5],
  ["Tern", 2, 2],
  ["Albatross", 4, 1],
];
const SAMPLE_PER_MONTH: Record<string, number[]> = {
  "2025": [200, 140, 240, 290, 280, 320, 370, 330, 220, 190, 130, 130],
  "2026": [155, 135, 130, 175, 210, 190, 410, 245, 175, 60],
};
const SAMPLE_HOURS = [5, 5, 5, 6, 6, 6, 7, 7, 7, 7, 7, 8, 8, 9, 10, 12, 16, 17, 18];

/** Made-up outings for development and tests. Boats are invented; nothing here is real club data. */
export function sampleShells(): ShellData {
  const rand = rng(77);
  const weights = SAMPLE_BOATS.map((b) => b[2]);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const pickBoat = () => {
    let r = rand() * weightSum;
    for (const b of SAMPLE_BOATS) {
      r -= b[2];
      if (r <= 0) return b;
    }
    return SAMPLE_BOATS[0];
  };
  const through = "2026-10-12";
  const outings: Outing[] = [];
  const rowerDays: { year: number; day: string; rower: number }[] = [];
  for (const [y, perMonth] of Object.entries(SAMPLE_PER_MONTH)) {
    perMonth.forEach((count, i) => {
      const month = i + 1;
      const last = Number(monthEnd(Number(y), month).slice(8));
      const days = `${y}-${pad2(month)}` === through.slice(0, 7) ? Number(through.slice(8)) : last;
      for (let n = 0; n < count; n++) {
        const [boat, seats] = pickBoat();
        const day = `${y}-${pad2(month)}-${pad2(1 + Math.floor(rand() * days))}`;
        const team = month >= 6 && month <= 8 && rand() < 0.25;
        outings.push({
          boat,
          seats,
          day,
          team,
          minutes: team ? 120 : [60, 90, 90, 120][Math.floor(rand() * 4)],
          startHour: team ? 7 : SAMPLE_HOURS[Math.floor(rand() * SAMPLE_HOURS.length)],
        });
        if (!team) rowerDays.push({ year: Number(y), day, rower: Math.floor(rand() * 95) });
      }
    });
  }
  outings.sort((a, b) => a.day.localeCompare(b.day) || a.boat.localeCompare(b.boat));
  const rowers = [2025, 2026].map((year) => {
    const inYear = rowerDays.filter((r) => r.year === year);
    const cutoff = sameDateCutoff(year, through);
    return {
      year,
      rowers: new Set(inYear.map((r) => r.rower)).size,
      sameDates: new Set(inYear.filter((r) => r.day <= cutoff).map((r) => r.rower)).size,
    };
  });
  return { source: "sample", through, outings, rowers };
}
