/**
 * Turns the iCrew shell usage export into a file for the `shell_outings` table, with every
 * rower's name replaced by a scrambled code. Run it on your own computer, then import the
 * output in Supabase (see db/shell_outings.sql):
 *
 *   npm run shells:prepare -- ccs_shellusage.csv shell_outings.csv
 *
 * Each run uses a new random scramble, so always replace the whole table with the new file.
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

// Run from the command line: node src/lib/shell-import.ts <icrew export> <output file>
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error("Usage: npm run shells:prepare -- <iCrew shell usage CSV> <output CSV>");
    process.exit(1);
  }
  const { rows, csv } = convert(readFileSync(input, "utf8"));
  writeFileSync(output, csv);
  const team = rows.filter((r) => r.kind === "team").length;
  console.log(`Wrote ${rows.length} outings (${rows.length - team} member rows, ${team} camp/team) to ${output}. No names included.`);
}
