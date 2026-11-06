import { readFileSync } from "node:fs";
import path from "node:path";
import type { EventScoreboardRow } from "./supabase";
import { toPromotedEvent } from "./supabase";
import type { EventsData } from "./types";

/** The seed file Grant loads into Supabase, read straight from the repo so a test can hold it to the handoff. */
export const SEED_CSV_PATH = path.resolve(__dirname, "..", "..", "db", "event_scoreboard.csv");
export const SEED_SQL_PATH = path.resolve(__dirname, "..", "..", "db", "event_scoreboard.sql");

/** Splits CSV text into rows of cells: quoted cells may hold commas, and "" is a quotation mark. Enough for this one file. */
export function parseSeedCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/\r/g, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

const NUMBER_COLUMNS = new Set(["capacity", "times_promoted", "rsvp_members", "rsvp_persons", "door_entries_window"]);

/** The seed rows as Supabase would return them: an empty cell is null, the count columns are numbers. */
export function seedRows(): EventScoreboardRow[] {
  const [header, ...rows] = parseSeedCsv(readFileSync(SEED_CSV_PATH, "utf8"));
  return rows.map((cells) => {
    const row: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      const cell = cells[i] ?? "";
      row[name] = cell === "" ? null : NUMBER_COLUMNS.has(name) ? Number(cell) : cell;
    });
    return row as unknown as EventScoreboardRow;
  });
}

/** The seed as the events endpoint answers when the table is loaded: live, in date order. */
export function seedEventsData(): EventsData {
  return { source: "live", events: seedRows().map(toPromotedEvent) };
}
