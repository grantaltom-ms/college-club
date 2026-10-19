import { dayOffset, formatDay, formatMonth, weekdayIndex, WEEKDAY_NAMES, WEEKDAYS } from "./dates";

/** Reservations for one day, start hour and type. */
export type Cell = [day: string, hour: number, type: number, count: number];

export interface ReservationData {
  /** "live" comes from Supabase; "sample" is made-up data for development and tests. */
  source: "live" | "sample";
  /** First and last day with a reservation, YYYY-MM-DD. */
  first: string;
  through: string;
  /** Type names in display order; `cells` refer to them by position. */
  types: string[];
  cells: Cell[];
}

/** The order types are stacked and listed in. Anything new from iCrew goes after these. */
export const TYPE_ORDER = ["Gym Space", "Dock Space", "Shell", "Room Space", "Paddle Board", "Work Space", "Fitness", "Kayak", "Events"];

/**
 * One fixed color per type (never reassigned when you filter). Eight hues from a palette checked
 * for color-blind separation, plus neutral gray for Events, which are sign-ups rather than a thing booked.
 */
const TYPE_COLORS: Record<string, string> = {
  "Gym Space": "#2a78d6",
  "Dock Space": "#eb6834",
  Shell: "#1baf7a",
  "Room Space": "#eda100",
  "Paddle Board": "#e87ba4",
  "Work Space": "#008300",
  Fitness: "#6250d6",
  Kayak: "#e34948",
  Events: "#8b9096",
};
const OTHER_COLOR = "#8b9096";

export const typeColor = (type: string) => TYPE_COLORS[type] ?? OTHER_COLOR;

const pad2 = (n: number) => String(n).padStart(2, "0");

export function orderTypes(names: Iterable<string>): string[] {
  const set = new Set(names);
  return [...TYPE_ORDER.filter((t) => set.has(t)), ...[...set].filter((t) => !TYPE_ORDER.includes(t)).sort()];
}

export interface CountRow {
  day: string;
  hour: number;
  item_type: string;
  reservations: number;
}

/** Builds the data from per-day counts. Days after `today` are left out until they happen. */
export function fromCounts(rows: CountRow[], today: string, source: "live" | "sample" = "live"): ReservationData {
  const kept = rows.filter((r) => r.day <= today && r.reservations > 0);
  const types = orderTypes(kept.map((r) => r.item_type));
  const days = kept.map((r) => r.day).sort();
  return {
    source,
    first: days[0] ?? "",
    through: days[days.length - 1] ?? "",
    types,
    cells: kept.map((r) => [r.day, r.hour, types.indexOf(r.item_type), r.reservations]),
  };
}

/** One column of a chart: counts per type (same order as `data.types`), already limited to the chosen types. */
export interface Bucket {
  key: string;
  label: string;
  /** Short text under the column, or null to skip it. */
  axis: string | null;
  counts: number[];
  total: number;
  /** False for a week or month the data only partly covers. */
  complete: boolean;
}

export function selectedIndexes(data: ReservationData, selected: ReadonlySet<string>): Set<number> {
  return new Set(data.types.flatMap((t, i) => (selected.has(t) ? [i] : [])));
}

function makeBucket(key: string, label: string, axis: string | null, counts: number[], complete: boolean): Bucket {
  return { key, label, axis, counts, total: counts.reduce((s, n) => s + n, 0), complete };
}

/** Adds up cells into buckets named by `keyOf`, keeping only the chosen types. */
function tally(data: ReservationData, selected: ReadonlySet<string>, keyOf: (c: Cell) => string): Map<string, number[]> {
  const keep = selectedIndexes(data, selected);
  const map = new Map<string, number[]>();
  for (const c of data.cells) {
    if (!keep.has(c[2])) continue;
    const key = keyOf(c);
    const counts = map.get(key) ?? data.types.map(() => 0);
    counts[c[2]] += c[3];
    map.set(key, counts);
  }
  return map;
}

/** Monday of the week a day falls in. */
export const weekStart = (day: string) => dayOffset(day, -weekdayIndex(day));

/** Every week from the first day to the last, oldest first, including quiet weeks. */
export function byWeek(data: ReservationData, selected: ReadonlySet<string>): Bucket[] {
  if (!data.first) return [];
  const counts = tally(data, selected, (c) => weekStart(c[0]));
  const buckets: Bucket[] = [];
  for (let start = weekStart(data.first); start <= data.through; start = dayOffset(start, 7)) {
    const end = dayOffset(start, 6);
    const complete = start >= data.first && end <= data.through;
    const firstOfMonth = Number(start.slice(8)) <= 7;
    buckets.push(
      makeBucket(
        start,
        `Week of ${formatDay(start)}${complete ? "" : " (part week)"}`,
        firstOfMonth ? formatMonth(start.slice(0, 7)) : null,
        counts.get(start) ?? data.types.map(() => 0),
        complete,
      ),
    );
  }
  return buckets;
}

function monthEnd(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** Every month from the first day to the last, oldest first. */
export function byMonth(data: ReservationData, selected: ReadonlySet<string>): Bucket[] {
  if (!data.first) return [];
  const counts = tally(data, selected, (c) => c[0].slice(0, 7));
  const buckets: Bucket[] = [];
  let year = Number(data.first.slice(0, 4));
  let month = Number(data.first.slice(5, 7));
  for (let key = `${year}-${pad2(month)}`; key <= data.through.slice(0, 7); key = `${year}-${pad2(month)}`) {
    const complete = `${key}-01` >= data.first && monthEnd(year, month) <= data.through;
    const name = formatMonth(key);
    buckets.push(
      makeBucket(key, `${name} ${year}${complete ? "" : " (so far)"}`, name, counts.get(key) ?? data.types.map(() => 0), complete),
    );
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buckets;
}

/** Monday to Sunday. */
export function byWeekday(data: ReservationData, selected: ReadonlySet<string>): Bucket[] {
  const counts = tally(data, selected, (c) => String(weekdayIndex(c[0])));
  return WEEKDAYS.map((short, i) => makeBucket(String(i), `${WEEKDAY_NAMES[i]}s`, short, counts.get(String(i)) ?? data.types.map(() => 0), true));
}

export function hourLabel(hour: number): string {
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

/** By the hour a reservation starts, from the earliest to the latest hour used by any type. */
export function byHour(data: ReservationData, selected: ReadonlySet<string>): Bucket[] {
  const hours = data.cells.map((c) => c[1]);
  if (hours.length === 0) return [];
  const counts = tally(data, selected, (c) => String(c[1]));
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  return Array.from({ length: hi - lo + 1 }, (_, i) => {
    const hour = lo + i;
    return makeBucket(String(hour), hourLabel(hour), hour % 3 === 0 ? hourLabel(hour) : null, counts.get(String(hour)) ?? data.types.map(() => 0), true);
  });
}

export interface TypeSummary {
  type: string;
  color: string;
  total: number;
  /** Percent of all chosen reservations. */
  share: number;
  peakWeekday: string;
  peakHour: string;
}

/** One line per chosen type: how many, what share, and when it is busiest. */
export function typeSummary(data: ReservationData, selected: ReadonlySet<string>): TypeSummary[] {
  const week = byWeekday(data, selected);
  const hours = byHour(data, selected);
  const totals = data.types.map((_, i) => week.reduce((s, b) => s + b.counts[i], 0));
  const all = totals.reduce((s, n, i) => s + (selected.has(data.types[i]) ? n : 0), 0);
  const peak = (buckets: Bucket[], i: number) => buckets.reduce((best, b) => (b.counts[i] > best.counts[i] ? b : best), buckets[0]);
  return data.types
    .map((type, i) => ({
      type,
      color: typeColor(type),
      total: totals[i],
      share: all ? Math.round((totals[i] / all) * 100) : 0,
      peakWeekday: totals[i] ? (peak(week, i).label.replace(/s$/, "")) : "—",
      peakHour: totals[i] && hours.length ? peak(hours, i).label : "—",
    }))
    .filter((r) => selected.has(r.type))
    .sort((a, b) => b.total - a.total || a.type.localeCompare(b.type));
}

/** Index of every type, busiest first, over the whole period. */
export function typesByVolume(data: ReservationData): number[] {
  const totals = data.types.map(() => 0);
  for (const c of data.cells) totals[c[2]] += c[3];
  return data.types.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b);
}

/**
 * Keeps the `keep` busiest types as they are and adds the rest into one "Other" column, so a chart shows a few
 * colors instead of nine. Returns the type names and colors that go with the new counts.
 */
export function collapseTypes(data: ReservationData, buckets: Bucket[], keep: number): { types: string[]; colors: string[]; buckets: Bucket[] } {
  const order = typesByVolume(data);
  if (order.length <= keep + 1) return { types: data.types, colors: data.types.map(typeColor), buckets };
  const kept = order.slice(0, keep).sort((a, b) => a - b);
  const rest = order.slice(keep);
  return {
    types: [...kept.map((i) => data.types[i]), "Other"],
    colors: [...kept.map((i) => typeColor(data.types[i])), OTHER_COLOR],
    buckets: buckets.map((b) => {
      const counts = [...kept.map((i) => b.counts[i]), rest.reduce((s, i) => s + b.counts[i], 0)];
      return { ...b, counts, total: counts.reduce((s, n) => s + n, 0) };
    }),
  };
}

/** The type that adds the most to `peak` above the average of the other buckets: what drives a busy month or hour. */
export function driverOf(types: string[], buckets: Bucket[], peak: Bucket): string | null {
  const others = buckets.filter((b) => b.key !== peak.key && b.complete);
  if (others.length === 0) return null;
  const lift = types.map((_, i) => peak.counts[i] - others.reduce((s, b) => s + b.counts[i], 0) / others.length);
  const best = lift.reduce((bi, v, i) => (v > lift[bi] ? i : bi), 0);
  return lift[best] > 0 ? types[best] : null;
}

/** The type with the most reservations in a set of buckets, for example morning hours or weekend days. */
export function topTypeIn(types: string[], buckets: Bucket[]): string | null {
  if (buckets.length === 0) return null;
  const sums = types.map((_, i) => buckets.reduce((s, b) => s + b.counts[i], 0));
  const best = sums.reduce((bi, v, i) => (v > sums[bi] ? i : bi), 0);
  return sums[best] > 0 ? types[best] : null;
}

/** Percent of each column's total, so every column is the same height and shows the mix. */
export function asShare(counts: number[], total: number): number[] {
  return counts.map((n) => (total ? (n / total) * 100 : 0));
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

/** [type, reservations a day in the busy season, hours people start (weighted by repeats), weekend weight] */
const SAMPLE_TYPES: [string, number, number[], number][] = [
  ["Gym Space", 30, [6, 6, 7, 12, 17, 17, 18, 18], 0.5],
  ["Dock Space", 20, [10, 12, 16, 17, 17, 18, 19], 1.4],
  ["Shell", 17, [5, 5, 6, 6, 6, 7, 7, 8], 0.9],
  ["Room Space", 9, [10, 12, 13, 17, 18, 19], 0.8],
  ["Paddle Board", 8, [9, 10, 11, 17, 18], 1.8],
  ["Work Space", 4, [9, 10, 13, 14], 0.2],
  ["Fitness", 4, [6, 7, 17, 18], 0.5],
  ["Kayak", 3, [10, 11, 17], 1.7],
  ["Events", 2, [17, 18, 18], 0.8],
];

/** Made-up reservations for development and tests. Nothing here is real club data. */
export function sampleReservations(): ReservationData {
  const rand = rng(404);
  const through = "2026-10-12";
  const rows: CountRow[] = [];
  for (let day = "2026-01-01"; day <= through; day = dayOffset(day, 1)) {
    const month = Number(day.slice(5, 7));
    const season = month >= 6 && month <= 9 ? 1 : 0.4;
    const weekend = weekdayIndex(day) >= 5;
    const tally = new Map<string, number>();
    for (const [type, perDay, hours, weekendWeight] of SAMPLE_TYPES) {
      const n = Math.round(perDay * season * (weekend ? weekendWeight : 1) * (0.6 + rand() * 0.8));
      for (let i = 0; i < n; i++) {
        const key = `${hours[Math.floor(rand() * hours.length)]}|${type}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    for (const [key, reservations] of tally) {
      const [hour, item_type] = key.split("|");
      rows.push({ day, hour: Number(hour), item_type, reservations });
    }
  }
  return fromCounts(rows, through, "sample");
}
