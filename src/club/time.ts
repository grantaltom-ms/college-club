/** Club time is Pacific. Dates are plain YYYY-MM-DD strings; moments are ISO instants. */
const PACIFIC = "America/Los_Angeles";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Pacific calendar date of a moment. */
export function pacificDate(at: Date): string {
  return dayFormat.format(at);
}

/** A moment safely inside the given Pacific day (noon in summer, 11 am in winter), for backdated records. */
export function middayPacific(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 19));
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** "2026-10-03" becomes "Oct 3, 2026". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** A moment as Pacific date and time, for the history list: "Oct 3, 2026, 11:00 am". */
export function formatMoment(iso: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, hour: "numeric", minute: "2-digit" }).format(at);
  return `${formatDay(pacificDate(at))}, ${time.toLowerCase().replace(/\s/g, " ")}`;
}

/* ---------- Pacific wall clock <-> real moments (daylight saving safe) ---------- */

const zoneParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far Pacific time is from UTC at this moment, in minutes: -420 in summer, -480 in winter. */
function pacificOffsetMinutes(ms: number): number {
  const p = Object.fromEntries(zoneParts.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wallAsUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * The real moment when the Pacific clock on `day` reads `minutes` after midnight (0 to 1440).
 * A time the clock repeats (the hour clocks fall back) gives the first one; a time the clock skips
 * (the hour clocks spring forward) gives the first moment after the gap.
 */
export function pacificWall(day: string, minutes: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d) + minutes * 60000;
  const summer = wallAsUtc + 420 * 60000;
  const winter = wallAsUtc + 480 * 60000;
  if (pacificOffsetMinutes(summer) === -420) return new Date(summer);
  return new Date(winter);
}

/** Midnight at the start of a Pacific day. A day is 23, 24 or 25 hours long. */
export function pacificDayStart(day: string): Date {
  return pacificWall(day, 0);
}

/** "05:00" becomes 300; "24:00" becomes 1440. */
export function clockToMinutes(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!m) throw new Error(`"${clock}" is not a time like 05:00.`);
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || minutes > 1440) throw new Error(`"${clock}" is not a time between 00:00 and 24:00.`);
  return minutes;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "Saturday, Oct 31". */
export function formatDayLong(day: string): string {
  return `${weekdayName(day)}, ${formatDay(day).replace(/, \d{4}$/, "")}`;
}

const clockFormat = new Intl.DateTimeFormat("en-US", { timeZone: PACIFIC, hour: "numeric", minute: "2-digit" });

/** The Pacific clock time of a moment: "7:30 am". */
export function formatClock(at: Date | string): string {
  return clockFormat.format(typeof at === "string" ? new Date(at) : at).toLowerCase();
}

/** "7:00 to 8:30 am", or "11:30 am to 12:30 pm" when it crosses noon. */
export function formatRange(start: Date | string, end: Date | string): string {
  const a = formatClock(start);
  const b = formatClock(end);
  const apA = a.slice(-2);
  return apA === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
}

/** 30 becomes "30 minutes", 60 "1 hour", 90 "1 hour 30 minutes", 120 "2 hours". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hours, mins].filter(Boolean).join(" ");
}
