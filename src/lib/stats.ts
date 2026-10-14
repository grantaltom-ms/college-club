import { countWeekdays, daysBetween, formatDay, formatMonth, weekdayIndex, WEEKDAYS, WEEKDAY_NAMES } from "./dates";
import {
  BAND_ORDER,
  type Band,
  type ClubTotal,
  type DashboardData,
  type DoorCell,
  type DoorPattern,
  type DoorPeriod,
  type Member,
} from "./types";

export const BAND_LABELS: Record<Band, string> = {
  "0 visits": "No visits",
  "Under 1/month": "Under 1 a month",
  "1-2/month": "1–2 a month",
  "2-4/month": "2–4 a month",
  "4+/month": "4+ a month",
};

/** One step per band, light to dark: more visits read as a darker mark. */
export const BAND_COLORS: Record<Band, string> = {
  "0 visits": "#90A0A6",
  "Under 1/month": "#73868E",
  "1-2/month": "#536872",
  "2-4/month": "#3E505A",
  "4+/month": "#2B3A42",
};

export function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/* ---------- Overview ---------- */

export interface BandRow {
  band: Band;
  label: string;
  members: number;
  memberShare: number;
  doorEntries: number;
  entryShare: number;
  withoutFob: number;
}

export function bandSummary(members: Member[]): BandRow[] {
  const totalEntries = members.reduce((sum, m) => sum + m.doorEntries, 0);
  return BAND_ORDER.map((band) => {
    const inBand = members.filter((m) => m.band === band);
    const doorEntries = inBand.reduce((sum, m) => sum + m.doorEntries, 0);
    return {
      band,
      label: BAND_LABELS[band],
      members: inBand.length,
      memberShare: percent(inBand.length, members.length),
      doorEntries,
      entryShare: percent(doorEntries, totalEntries),
      withoutFob: inBand.filter((m) => !m.ownFob).length,
    };
  });
}

export interface Headline {
  total: number;
  quiet: number;
  quietShare: number;
  noVisits: number;
  regulars: number;
  regularEntryShare: number;
  withoutFob: number;
}

export function headline(members: Member[]): Headline {
  const rows = bandSummary(members);
  const byBand = (b: Band) => rows.find((r) => r.band === b)!;
  const quiet = byBand("0 visits").members + byBand("Under 1/month").members;
  return {
    total: members.length,
    quiet,
    quietShare: percent(quiet, members.length),
    noVisits: byBand("0 visits").members,
    regulars: byBand("4+/month").members,
    regularEntryShare: byBand("4+/month").entryShare,
    withoutFob: members.filter((m) => !m.ownFob).length,
  };
}

/* ---------- Several reservations in one day ---------- */

/** Extra bookings (beyond one per day) that make a repeat habit rather than a one-off. */
export const OFTEN_EXTRA_BOOKINGS = 5;

export interface MultiBooking {
  total: number;
  /** Members with at least one booking in the period. */
  booked: number;
  /** Booked 2+ times on at least one day. */
  multiDay: number;
  multiDayShare: number;
  /** Did it often: at least OFTEN_EXTRA_BOOKINGS extra bookings. */
  often: number;
  /** Often, weekday daytime or evening door pattern, not a shared account. */
  workFromClub: number;
  workFromClubShareOfBooked: number;
  workFromClubShareOfAll: number;
  /** Often, but mostly early-morning arrivals (rowers booking two boats). */
  earlyBirds: number;
  /** Shared accounts that book twice for two people. */
  households: number;
  /** Often, but no door data, so we can't tell. */
  unknown: number;
}

/**
 * The reservation export has no start times, so "more bookings than booking days" is the only
 * way to see someone booked twice in a day. Door-time shares then separate people who seem to
 * be working from the club from early-morning rowers and shared accounts.
 */
export function multiBooking(members: Member[]): MultiBooking {
  const booked = members.filter((m) => m.bookingDays > 0);
  const extra = (m: Member) => m.bookings - m.bookingDays;
  const multiDay = booked.filter((m) => extra(m) > 0);
  const often = multiDay.filter((m) => extra(m) >= OFTEN_EXTRA_BOOKINGS);
  const households = often.filter((m) => m.household);
  const rest = often.filter((m) => !m.household);
  const known = rest.filter((m) => m.earlyShare !== null && m.weekendShare !== null);
  const earlyBirds = known.filter((m) => (m.earlyShare as number) >= 0.5);
  const workFromClub = known.filter((m) => (m.earlyShare as number) < 0.5 && (m.weekendShare as number) < 0.5);
  return {
    total: members.length,
    booked: booked.length,
    multiDay: multiDay.length,
    multiDayShare: percent(multiDay.length, booked.length),
    often: often.length,
    workFromClub: workFromClub.length,
    workFromClubShareOfBooked: percent(workFromClub.length, booked.length),
    workFromClubShareOfAll: percent(workFromClub.length, members.length),
    earlyBirds: earlyBirds.length,
    households: households.length,
    unknown: rest.length - known.length,
  };
}

/* ---------- When people come ---------- */

function series(totals: ClubTotal[], measure: ClubTotal["measure"]): ClubTotal[] {
  return totals.filter((t) => t.measure === measure);
}

/** Years that have door data, newest first. */
export function doorYears(door: DoorPattern): number[] {
  return door.periods.map((p) => p.year).sort((a, b) => b - a);
}

export function doorPeriod(door: DoorPattern, year: number): DoorPeriod | undefined {
  return door.periods.find((p) => p.year === year);
}

function yearCells(door: DoorPattern, year: number): DoorCell[] {
  return door.cells.filter((c) => c.year === year);
}

/** How many of each weekday (Mon first) the year's data covers. */
function weekdayCounts(door: DoorPattern, year: number): number[] {
  const p = doorPeriod(door, year);
  return p ? countWeekdays(p.firstDay, p.lastDay) : [0, 0, 0, 0, 0, 0, 0];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function monthEnd(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

export interface MonthPoint {
  key: string;
  month: number;
  label: string;
  entries: number;
  memberEntries: number;
  people: number;
  /** False for months the data has not reached the end of (or not reached at all). */
  complete: boolean;
}

/** All twelve months of a year. Months with no data yet have zero entries. */
export function monthSeries(door: DoorPattern, year: number): MonthPoint[] {
  const period = doorPeriod(door, year);
  const byMonth = new Map(door.months.filter((m) => m.year === year).map((m) => [m.month, m]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const row = byMonth.get(month);
    const key = `${year}-${pad2(month)}`;
    return {
      key,
      month,
      label: formatMonth(key),
      entries: row?.allEntries ?? 0,
      memberEntries: row?.memberEntries ?? 0,
      people: row?.people ?? 0,
      complete: !!row && !!period && period.firstDay <= `${key}-01` && period.lastDay >= monthEnd(year, month),
    };
  });
}

export interface MonthCompareRow {
  month: number;
  label: string;
  /** One point per year, oldest year first. */
  years: MonthPoint[];
  /** Percent change from the oldest to the newest year, when both have the month in full. */
  change: number | null;
}

/** Each month with every year's door entries next to each other, oldest year first. */
export function monthComparison(door: DoorPattern): { years: number[]; rows: MonthCompareRow[] } {
  const years = doorYears(door).slice().sort((a, b) => a - b);
  const series = years.map((y) => monthSeries(door, y));
  const rows = Array.from({ length: 12 }, (_, i) => {
    const points = series.map((s) => s[i]);
    const first = points[0];
    const last = points[points.length - 1];
    const comparable = points.length > 1 && first.complete && last.complete && first.entries > 0;
    return {
      month: i + 1,
      label: first?.label ?? "",
      years: points,
      change: comparable ? Math.round((last.entries / first.entries - 1) * 100) : null,
    };
  });
  return { years, rows: series.length ? rows : [] };
}

export interface YearOverYear {
  year: number;
  previousYear: number;
  /** How many months both years have in full. */
  months: number;
  /** The first and last of those months, as short names. */
  fromLabel: string;
  toLabel: string;
  thisYear: number;
  lastYear: number;
  /** Percent change, rounded. */
  change: number;
}

/** Compares the newest year with the one before it, using only months complete in both. */
export function yearOverYear(door: DoorPattern): YearOverYear | null {
  const [year, previousYear] = doorYears(door);
  if (year === undefined || previousYear === undefined) return null;
  const now = monthSeries(door, year);
  const before = monthSeries(door, previousYear);
  const both = now.filter((m, i) => m.complete && before[i].complete);
  if (both.length === 0) return null;
  const thisYear = both.reduce((s, m) => s + m.entries, 0);
  const lastYear = both.reduce((s, m) => s + before[m.month - 1].entries, 0);
  return {
    year,
    previousYear,
    months: both.length,
    fromLabel: both[0].label,
    toLabel: both[both.length - 1].label,
    thisYear,
    lastYear,
    change: lastYear ? Math.round((thisYear / lastYear - 1) * 100) : 0,
  };
}

export interface HourPoint {
  hour: number;
  label: string;
  entries: number;
}

export function hourLabel(hour: number): string {
  if (hour === 0) return "12 am";
  if (hour === 12) return "12 pm";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}

export function hourSeries(door: DoorPattern, year: number): HourPoint[] {
  const byHour = new Map<number, number>();
  for (const c of yearCells(door, year)) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.allEntries);
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: hourLabel(hour),
    entries: byHour.get(hour) ?? 0,
  }));
}

export interface WeekdayPoint {
  index: number;
  short: string;
  name: string;
  entries: number;
  days: number;
  perDay: number;
  /** Percent below the average Monday-to-Friday day (negative means busier). */
  belowWeekday: number;
}

export function weekdaySeries(door: DoorPattern, year: number): WeekdayPoint[] {
  const counts = weekdayCounts(door, year);
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  for (const c of yearCells(door, year)) byDay[c.weekday] += c.allEntries;
  const rows = WEEKDAYS.map((short, index) => {
    const days = counts[index];
    return { index, short, name: WEEKDAY_NAMES[index], entries: byDay[index], days, perDay: days ? byDay[index] / days : 0 };
  });
  const weekdayAvg = rows.slice(0, 5).reduce((s, r) => s + r.perDay, 0) / 5;
  return rows.map((r) => ({
    ...r,
    belowWeekday: weekdayAvg ? Math.round((1 - r.perDay / weekdayAvg) * 100) : 0,
  }));
}

export interface HeatCell {
  hour: number;
  label: string;
  /** Average entries in this hour on this day of the week. */
  perDay: number;
  entries: number;
}

export interface HeatRow {
  index: number;
  name: string;
  short: string;
  days: number;
  cells: HeatCell[];
}

export interface Heatmap {
  /** Consecutive hours from the first to the last one with any entries. */
  hours: number[];
  rows: HeatRow[];
  max: number;
}

export function heatmap(door: DoorPattern, year: number): Heatmap {
  const cells = yearCells(door, year).filter((c) => c.allEntries > 0);
  const counts = weekdayCounts(door, year);
  const lo = cells.length ? Math.min(...cells.map((c) => c.hour)) : 0;
  const hi = cells.length ? Math.max(...cells.map((c) => c.hour)) : 0;
  const hours = cells.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
  const lookup = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.allEntries]));
  const rows = WEEKDAYS.map((short, index) => ({
    index,
    short,
    name: WEEKDAY_NAMES[index],
    days: counts[index],
    cells: hours.map((hour) => {
      const entries = lookup.get(`${index}-${hour}`) ?? 0;
      return { hour, label: hourLabel(hour), entries, perDay: counts[index] ? entries / counts[index] : 0 };
    }),
  }));
  return { hours, rows, max: Math.max(0, ...rows.flatMap((r) => r.cells.map((c) => c.perDay))) };
}

const HEAT_LOW = [243, 240, 232]; // Oyster 50
const HEAT_HIGH = [43, 58, 66]; // dark slate

/** One hue from near-paper to dark slate; zero is the lightest step. */
export function heatColor(value: number, max: number): string {
  const t = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [r, g, b] = HEAT_LOW.map((lo, i) => Math.round(lo + (HEAT_HIGH[i] - lo) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The busiest day-and-hour slots, highest first. */
export function busiestSlots(map: Heatmap, count: number): { day: string; hour: string; perDay: number }[] {
  return map.rows
    .flatMap((r) => r.cells.map((c) => ({ day: r.name, hour: c.label, perDay: c.perDay })))
    .sort((a, b) => b.perDay - a.perDay)
    .slice(0, count);
}

export interface BookingDay {
  day: string;
  bookings: number;
  weekend: boolean;
}

export function bookingSeries(totals: ClubTotal[]): BookingDay[] {
  return series(totals, "icrew_bookings_by_day")
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((t) => ({ day: t.key, bookings: t.allEntries, weekend: weekdayIndex(t.key) >= 5 }));
}

export interface BookingMonth {
  key: string;
  month: number;
  label: string;
  bookings: number;
  /** True when every day of the month is in the data. */
  complete: boolean;
}

/** Years with bookings, newest first. */
export function bookingYears(totals: ClubTotal[]): number[] {
  const years = new Set(series(totals, "icrew_bookings_by_day").map((t) => Number(t.key.slice(0, 4))));
  return [...years].sort((a, b) => b - a);
}

/** All twelve months of a year; months the data has not reached have zero bookings. */
export function bookingMonths(totals: ClubTotal[], year: number): BookingMonth[] {
  const days = series(totals, "icrew_bookings_by_day").filter((t) => t.key.startsWith(`${year}-`));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const key = `${year}-${pad2(month)}`;
    const inMonth = days.filter((t) => t.key.startsWith(key));
    const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      key,
      month,
      label: formatMonth(key),
      bookings: inMonth.reduce((s, t) => s + t.allEntries, 0),
      complete: inMonth.length === length,
    };
  });
}

export interface BookingYearOverYear {
  year: number;
  previousYear: number;
  fromLabel: string;
  toLabel: string;
  thisYear: number;
  lastYear: number;
  change: number;
}

/** Newest year against the one before, over the months complete in both. */
export function bookingYearOverYear(totals: ClubTotal[]): BookingYearOverYear | null {
  const [year, previousYear] = bookingYears(totals);
  if (year === undefined || previousYear === undefined) return null;
  const now = bookingMonths(totals, year);
  const before = bookingMonths(totals, previousYear);
  const both = now.filter((m, i) => m.complete && before[i].complete);
  if (both.length === 0) return null;
  const thisYear = both.reduce((s, m) => s + m.bookings, 0);
  const lastYear = both.reduce((s, m) => s + before[m.month - 1].bookings, 0);
  return {
    year,
    previousYear,
    fromLabel: both[0].label,
    toLabel: both[both.length - 1].label,
    thisYear,
    lastYear,
    change: lastYear ? Math.round((thisYear / lastYear - 1) * 100) : 0,
  };
}

export interface BookingWeekday {
  index: number;
  name: string;
  short: string;
  days: number;
  bookings: number;
  perDay: number;
}

/** Average bookings for each day of the week, over the days in `year`. */
export function bookingWeekdays(totals: ClubTotal[], year: number): BookingWeekday[] {
  const days = series(totals, "icrew_bookings_by_day").filter((t) => t.key.startsWith(`${year}-`));
  return WEEKDAY_NAMES.map((name, index) => {
    const mine = days.filter((t) => weekdayIndex(t.key) === index);
    const bookings = mine.reduce((s, t) => s + t.allEntries, 0);
    return { index, name, short: WEEKDAYS[index], days: mine.length, bookings, perDay: mine.length ? bookings / mine.length : 0 };
  });
}

/* ---------- Members ---------- */

export type Preset = "all" | "no-visits" | "under-one" | "gone-quiet" | "new" | "no-fob";

export const PRESETS: { id: Preset; label: string; hint: string }[] = [
  { id: "all", label: "Everyone", hint: "All adult members" },
  { id: "no-visits", label: "No visits", hint: "No door entry or booking since January" },
  { id: "under-one", label: "Under 1 a month", hint: "Visited, but less than once a month" },
  { id: "gone-quiet", label: "Gone quiet", hint: "Visited at least monthly, but not in the last 45 days" },
  { id: "new", label: "New", hint: "Joined in the last 90 days" },
  { id: "no-fob", label: "No fob", hint: "No door fob on file, so only bookings are counted" },
];

export function matchesPreset(m: Member, preset: Preset, dataThrough: string): boolean {
  switch (preset) {
    case "all":
      return true;
    case "no-visits":
      return m.band === "0 visits";
    case "under-one":
      return m.band === "Under 1/month";
    case "gone-quiet":
      return m.visitsPerMonth >= 1 && m.lastVisit !== null && daysBetween(m.lastVisit, dataThrough) >= 45;
    case "new":
      return m.joined !== null && daysBetween(m.joined, dataThrough) <= 90 && daysBetween(m.joined, dataThrough) >= 0;
    case "no-fob":
      return !m.ownFob;
  }
}

export function presetCounts(members: Member[], dataThrough: string): Record<Preset, number> {
  const counts = {} as Record<Preset, number>;
  for (const p of PRESETS) counts[p.id] = members.filter((m) => matchesPreset(m, p.id, dataThrough)).length;
  return counts;
}

export function filterMembers(members: Member[], opts: { query: string; preset: Preset; dataThrough: string }): Member[] {
  const q = opts.query.trim().toLowerCase();
  return members.filter(
    (m) => matchesPreset(m, opts.preset, opts.dataThrough) && (q === "" || m.name.toLowerCase().includes(q)),
  );
}

export type SortKey = "name" | "band" | "lastVisit" | "joined";
export type SortDir = "asc" | "desc";

export function sortMembers(members: Member[], key: SortKey, dir: SortDir): Member[] {
  const sign = dir === "asc" ? 1 : -1;
  const compare = (a: Member, b: Member): number => {
    switch (key) {
      case "name":
        return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
      case "band":
        return BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || a.visitsPerMonth - b.visitsPerMonth;
      case "lastVisit":
      case "joined": {
        const av = a[key];
        const bv = b[key];
        // Missing dates always sort last, whichever direction is chosen.
        if (av === null && bv === null) return 0;
        if (av === null) return 2 * sign;
        if (bv === null) return -2 * sign;
        return av.localeCompare(bv);
      }
    }
  };
  return [...members].sort((a, b) => sign * compare(a, b) || a.name.localeCompare(b.name));
}

export function paginate<T>(items: T[], page: number, pageSize: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  return { rows: items.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pages };
}

/** Quote a CSV field, and defuse values a spreadsheet would run as a formula. */
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function membersToCsv(members: Member[]): string {
  const header = ["Name", "Usage level", "Visits per month", "Last visit", "Joined", "Own door fob"];
  const lines = members.map((m) =>
    [
      m.name,
      BAND_LABELS[m.band],
      m.visitsPerMonth.toFixed(2),
      m.lastVisit ?? "",
      m.joined ?? "",
      m.ownFob ? "Yes" : "No",
    ]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** "Jan 1 – Sep 27, 2026" for the member data, which starts on January 1. */
export function dataRange(data: DashboardData): string {
  return `${formatDay(`${data.dataThrough.slice(0, 4)}-01-01`)} – ${formatDay(data.dataThrough, true)}`;
}

/** "Jan 1 – Oct 12, 2026" for one year of door data. */
export function periodRange(period: DoorPeriod): string {
  return period.firstDay.slice(0, 4) === period.lastDay.slice(0, 4)
    ? `${formatDay(period.firstDay)} – ${formatDay(period.lastDay, true)}`
    : `${formatDay(period.firstDay, true)} – ${formatDay(period.lastDay, true)}`;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
