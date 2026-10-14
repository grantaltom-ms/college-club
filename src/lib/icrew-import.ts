/**
 * Turns iCrew exports into files for the dashboard's tables, with no rower or member names.
 * Run it on your own computer, then import the output in Supabase (see db/*.sql):
 *
 *   npm run shells:prepare -- ccs_shellusage.csv shell_outings.csv
 *   npm run reservations:prepare -- ccs_Reservations.csv reservation_counts.csv
 *
 * Shell names are replaced with scrambled codes (new random scramble every run) and every
 * row is kept. Reservations are reduced to counts per day, start hour and type.
 * Always replace the whole table with the new file.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const OUTPUT_COLUMNS = ["boat", "seats", "rigging", "day", "kind", "team", "minutes", "start_time", "end_time", "rower_key"] as const;

type OutputRow = Record<(typeof OUTPUT_COLUMNS)[number], string>;

/** Minimal CSV reader: commas, double quotes and "" inside quotes, as iCrew writes them. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ""));
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** "4:00pm" -> "16:00"; anything else -> "". */
export function to24h(time: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(time.trim());
  if (!m) return "";
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hour += 12;
  return `${String(hour).padStart(2, "0")}:${m[2]}`;
}

/** Scrambles a name with a secret that is thrown away, so the code can't be turned back into the name. */
export function rowerKey(name: string, secret: string): string {
  return createHash("sha256").update(`${secret}|${name.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

export function convert(text: string, secret = randomBytes(32).toString("hex")): { rows: OutputRow[]; csv: string } {
  const [header, ...lines] = parseCsv(text);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`The export has no "${name}" column. Is this the iCrew shell usage export?`);
    return i;
  };
  const idx = {
    name: col("Name"),
    seats: col("Seats"),
    rigging: col("Rigging"),
    date: col("Date"),
    team: col("Team"),
    usage: col("UsageType"),
    minutes: col("MinutesUsed"),
    start: col("StartTime"),
    end: col("EndTime"),
  };
  const rows = lines.map((f): OutputRow => {
    const usage = f[idx.usage] ?? "";
    const rower = /^Rowed by\s+(.+)$/i.exec(usage)?.[1] ?? "";
    const rigging = (f[idx.rigging] ?? "").trim();
    return {
      boat: (f[idx.name] ?? "").trim(),
      seats: (f[idx.seats] ?? "").trim(),
      rigging: rigging === "Scull" || rigging === "Sweep" ? rigging : "",
      day: (f[idx.date] ?? "").trim(),
      kind: rower ? "member" : "team",
      team: (f[idx.team] ?? "").trim(),
      minutes: (f[idx.minutes] ?? "").trim(),
      start_time: to24h(f[idx.start] ?? ""),
      end_time: to24h(f[idx.end] ?? ""),
      rower_key: rower ? rowerKey(rower, secret) : "",
    };
  });
  const csv = [OUTPUT_COLUMNS.join(","), ...rows.map((r) => OUTPUT_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
  return { rows, csv };
}

/* ---------- Reservations by type ---------- */

export const RESERVATION_COLUMNS = ["day", "hour", "item_type", "reservations"] as const;

/** Rows with no item type are club events (parties, talks, orientations): one row per person signed up. */
export const EVENTS = "Events";

/** "09-08-2026" (month-day-year) -> "2026-09-08"; anything else -> "". */
export function toIsoDay(date: string): string {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(date.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

export interface ReservationCount {
  day: string;
  hour: number;
  item_type: string;
  reservations: number;
}

/**
 * Counts reservations per day, start hour and type. The names of who booked and who rowed are
 * never read into the result. Rows with a date or start time that can't be understood are
 * reported, not dropped silently.
 */
export function convertReservations(text: string): { counts: ReservationCount[]; csv: string; total: number; skipped: number } {
  const [header, ...lines] = parseCsv(text);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`The export has no "${name}" column. Is this the iCrew reservations export?`);
    return i;
  };
  const idx = { date: col("Date"), start: col("StartTime"), type: col("ItemType") };
  const tally = new Map<string, ReservationCount>();
  let skipped = 0;
  for (const f of lines) {
    const day = toIsoDay(f[idx.date] ?? "");
    const start = to24h(f[idx.start] ?? "");
    if (!day || !start) {
      skipped += 1;
      continue;
    }
    const hour = Number(start.slice(0, 2));
    const item_type = (f[idx.type] ?? "").trim() || EVENTS;
    const key = `${day}|${hour}|${item_type}`;
    const row = tally.get(key) ?? { day, hour, item_type, reservations: 0 };
    row.reservations += 1;
    tally.set(key, row);
  }
  const counts = [...tally.values()].sort((a, b) => a.day.localeCompare(b.day) || a.hour - b.hour || a.item_type.localeCompare(b.item_type));
  const csv =
    [RESERVATION_COLUMNS.join(","), ...counts.map((c) => RESERVATION_COLUMNS.map((k) => csvCell(String(c[k]))).join(","))].join("\n") + "\n";
  return { counts, csv, total: counts.reduce((s, c) => s + c.reservations, 0), skipped };
}

// Run from the command line: node src/lib/icrew-import.ts <shells|reservations> <iCrew export> <output file>
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [kind, input, output] = process.argv.slice(2);
  if ((kind !== "shells" && kind !== "reservations") || !input || !output) {
    console.error("Usage: npm run shells:prepare -- <iCrew shell usage CSV> <output CSV>\n       npm run reservations:prepare -- <iCrew reservations CSV> <output CSV>");
    process.exit(1);
  }
  const text = readFileSync(input, "utf8");
  if (kind === "shells") {
    const { rows, csv } = convert(text);
    writeFileSync(output, csv);
    const team = rows.filter((r) => r.kind === "team").length;
    console.log(`Wrote ${rows.length} outings (${rows.length - team} member rows, ${team} camp/team) to ${output}. No names included.`);
  } else {
    const { counts, csv, total, skipped } = convertReservations(text);
    writeFileSync(output, csv);
    console.log(`Wrote ${counts.length} count rows covering ${total} reservations to ${output}. No names included.`);
    if (skipped) console.warn(`Skipped ${skipped} rows with a date or start time that could not be read.`);
  }
}
