const DAY_MS = 86_400_000;

/** Parse YYYY-MM-DD as a UTC timestamp so results never shift with time zones. */
export function parseDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** How many of each weekday fall between two dates, inclusive. Index 0 = Monday. */
export function countWeekdays(start: string, end: string): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const total = daysBetween(start, end);
  const first = weekdayIndex(start);
  for (let i = 0; i <= total; i++) counts[(first + i) % 7] += 1;
  return counts;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(day: string | null, withYear = false): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-").map(Number);
  const base = `${MONTHS[m - 1]} ${d}`;
  return withYear ? `${base}, ${y}` : base;
}

export function formatMonth(key: string): string {
  const [, m] = key.split("-").map(Number);
  return MONTHS[m - 1];
}

/** The day `days` after `day` (negative goes back), as YYYY-MM-DD. */
export function dayOffset(day: string, days: number): string {
  return new Date(parseDay(day) + days * DAY_MS).toISOString().slice(0, 10);
}
