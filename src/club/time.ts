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
