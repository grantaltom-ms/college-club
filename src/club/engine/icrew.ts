import { createHash } from "node:crypto";
import { ClubError } from "../errors";
import { pacificWall } from "../time";
import { parseCsv } from "./csv";
import { isRealDay } from "./households";
import { peopleIn } from "./people-names";

/**
 * The old reservation system's report, read for the club's history. iCrew's "Reservations" report has one row per booking
 * (and, for events, one row per person signed up), with these columns:
 *
 *   Date, Day, StartTime, EndTime, BookedOnDate, BookedAtTime, ID, ItemType, Shell/Item, Oars, ReservedBy, Rower(s), OutAt, InAt
 *
 * This reads such a file and says, in plain words and with row numbers as a spreadsheet shows them (the header is row 1),
 * everything that is wrong, without changing anything. Only days that have already passed are kept.
 */

/** A little under Vercel's 4.5 MB limit on what one request can carry. A year of iCrew bookings is about 3.4 MB. */
export const MAX_HISTORY_BYTES = 4_000_000;
export const MAX_HISTORY_ROWS = 60_000;
/** The most problems listed; past this the list says how many more there were. */
export const MAX_HISTORY_PROBLEMS = 200;

export const ICREW_COLUMNS = ["Date", "Day", "StartTime", "EndTime", "BookedOnDate", "BookedAtTime", "ID", "ItemType", "Shell/Item", "Oars", "ReservedBy", "Rower(s)", "OutAt", "InAt"] as const;

type Field = "date" | "startTime" | "endTime" | "bookedOnDate" | "bookedAtTime" | "id" | "itemType" | "itemName" | "oars" | "reservedBy" | "rowers" | "outAt" | "inAt";
const REQUIRED: Field[] = ["date", "startTime", "endTime", "id", "itemType", "itemName", "reservedBy"];
const LABEL: Record<Field, string> = {
  date: "Date",
  startTime: "StartTime",
  endTime: "EndTime",
  bookedOnDate: "BookedOnDate",
  bookedAtTime: "BookedAtTime",
  id: "ID",
  itemType: "ItemType",
  itemName: "Shell/Item",
  oars: "Oars",
  reservedBy: "ReservedBy",
  rowers: "Rower(s)",
  outAt: "OutAt",
  inAt: "InAt",
};
/** Header names as people write them, with spaces, capitals and punctuation ignored. */
const ALIASES: Record<Field, string[]> = {
  date: ["date"],
  startTime: ["starttime", "start"],
  endTime: ["endtime", "end"],
  bookedOnDate: ["bookedondate"],
  bookedAtTime: ["bookedattime"],
  id: ["id", "reservationid"],
  itemType: ["itemtype", "type"],
  itemName: ["shellitem", "item", "itemname", "shell"],
  oars: ["oars"],
  reservedBy: ["reservedby", "bookedby"],
  rowers: ["rowers", "rower"],
  outAt: ["outat"],
  inAt: ["inat"],
};
/** The columns this import has no use for but that are normal in the report. They are not mentioned. */
const KNOWN_UNUSED = ["day"];

/** The blank file. Its example rows are refused if they are uploaded, so nobody adds them by accident. */
export const ICREW_TEMPLATE =
  [
    ICREW_COLUMNS.join(","),
    "01-05-2026,Monday,7:00am,8:00am,01-02-2026,09:15:00,EXAMPLE-1,Shell,Example Single,,Pat Example,Pat Example (1),7:05am,7:58am",
    "01-05-2026,Monday,9:00am,9:30am,01-04-2026,18:40:12,EXAMPLE-2,Gym Space,Gym Space 01,,Sam Sample,,9:00am,9:30am",
    "01-10-2026,Saturday,6:00pm,8:00pm,,,EXAMPLE-3,,Example Social Evening,,Alex Sample,,,",
  ].join("\r\n") + "\r\n";

export interface IcrewPerson {
  name: string;
  key: string;
  role: "booker" | "rower";
}

export interface IcrewRow {
  /** The row in the file, counting the header as row 1. */
  row: number;
  /** Identifies this booking so it is only ever stored once. */
  key: string;
  sourceId: string;
  /** The Pacific day, YYYY-MM-DD. */
  day: string;
  startsAt: string;
  endsAt: string;
  bookedAt: string | null;
  itemType: string;
  itemName: string;
  oars: string;
  bookedBy: string;
  rowers: string;
  outText: string;
  inText: string;
  people: IcrewPerson[];
}

export interface IcrewReading {
  rows: IcrewRow[];
  problems: string[];
  notices: string[];
  ignoredColumns: string[];
  /** Rows with something in them, not counting the header. */
  rowCount: number;
  /** Rows for today or a later day: history only holds days that have passed, so they are left out. */
  futureRows: number;
  /** Rows that repeat another row in the same file (same ID and same person): kept once. */
  repeatedInFile: number;
}

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const rowKeyOf = (sourceId: string, bookedBy: string) => createHash("sha256").update(`${sourceId}\u0000${bookedBy.trim().toLowerCase().replace(/\s+/g, " ")}`).digest("hex");

/** A day as iCrew writes it (09-08-2026) or as a spreadsheet may (9/8/2026, 2026-09-08). Returns YYYY-MM-DD, or why not. */
export function parseIcrewDay(value: string): { iso: string } | { problem: string } {
  const typed = `"${value}"`;
  let iso: string;
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(value);
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (us) iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  else if (dashed) iso = value;
  else return { problem: `${typed} is not a date. Write it like 09-08-2026.` };
  if (!isRealDay(iso)) return { problem: `${typed} is not a real date.` };
  if (iso < "2000-01-01") return { problem: `${typed} is before 2000. Check the year.` };
  return { iso };
}

/** A time of day as iCrew writes it (4:00pm), or in 24-hour form (16:00). Returns minutes after midnight, or why not. */
export function parseIcrewClock(value: string): { minutes: number } | { problem: string } {
  const typed = `"${value}"`;
  const ampm = /^(\d{1,2}):(\d{2})\s*([ap])m$/i.exec(value);
  if (ampm) {
    const hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    if (hour < 1 || hour > 12 || minute > 59) return { problem: `${typed} is not a time of day.` };
    return { minutes: (hour % 12) * 60 + (ampm[3].toLowerCase() === "p" ? 720 : 0) + minute };
  }
  const plain = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (plain) {
    const hour = Number(plain[1]);
    const minute = Number(plain[2]);
    if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return { problem: `${typed} is not a time of day.` };
    return { minutes: hour * 60 + minute };
  }
  return { problem: `${typed} is not a time. Write it like 4:00pm.` };
}

const emptyReading = (problem: string): IcrewReading => ({ rows: [], problems: [problem], notices: [], ignoredColumns: [], rowCount: 0, futureRows: 0, repeatedInFile: 0 });

/** `today` is the Pacific date, YYYY-MM-DD: rows on or after it are left out. */
export function readIcrew(text: string, today: string): IcrewReading {
  if (text.length > MAX_HISTORY_BYTES) return emptyReading(`The file is too big: it can be up to ${MAX_HISTORY_BYTES / 1_000_000} MB, which is about 30,000 rows. Export a shorter date range from iCrew and upload the pieces one after another.`);
  if (text.startsWith("PK")) return emptyReading("That looks like an Excel file, not a CSV. In Excel choose Save As, then CSV (Comma delimited), and upload that.");
  if (text.includes("\u0000")) return emptyReading("That is not a plain CSV text file. In your spreadsheet choose Save As, then CSV (Comma delimited), and upload that.");

  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    if (e instanceof ClubError) return emptyReading(e.message);
    throw e;
  }
  while (table.length > 0 && table[table.length - 1].every((c) => c.trim() === "")) table.pop();
  if (table.length === 0) return emptyReading("The file is empty.");

  const header = table[0].map((h) => h.trim());
  const column: Partial<Record<Field, number>> = {};
  const problems: string[] = [];
  const used = new Set<number>();
  for (const field of Object.keys(ALIASES) as Field[]) {
    const matches = header.map((h, i) => [h, i] as const).filter(([h]) => ALIASES[field].includes(letters(h)));
    if (matches.length > 1) problems.push(`Two columns both mean "${LABEL[field]}": ${matches.map(([h]) => `"${h}"`).join(" and ")}. Keep only one.`);
    if (matches.length >= 1) {
      column[field] = matches[0][1];
      for (const [, i] of matches) used.add(i);
    }
  }
  const missing = REQUIRED.filter((f) => column[f] === undefined);
  if (missing.length > 0) {
    problems.push(
      `The file has no column for ${missing.map((f) => `"${LABEL[f]}"`).join(", ")}. It has: ${header.filter(Boolean).map((h) => `"${h}"`).join(", ") || "no column names"}. Is this iCrew's Reservations report? It needs: ${REQUIRED.map((f) => LABEL[f]).join(", ")}.`,
    );
  }
  const ignoredColumns = header.filter((h, i) => h !== "" && !used.has(i) && !KNOWN_UNUSED.includes(letters(h)));
  if (problems.length > 0) return { ...emptyReading(""), problems, ignoredColumns };

  const dataRows = table.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (dataRows.length > MAX_HISTORY_ROWS) return { ...emptyReading(`The file has ${dataRows.length} rows. It can have up to ${MAX_HISTORY_ROWS}. Export a shorter date range from iCrew and upload the pieces one after another.`), ignoredColumns, rowCount: dataRows.length };

  const get = (cells: string[], field: Field) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
  const rows: IcrewRow[] = [];
  const seen = new Map<string, number>();
  let problemCount = 0;
  let futureRows = 0;
  let repeatedInFile = 0;
  const say = (row: number, p: string) => {
    problemCount += 1;
    if (problems.length < MAX_HISTORY_PROBLEMS) problems.push(`Row ${row}: ${p}`);
  };

  for (const { cells, row } of dataRows) {
    const before = problemCount;
    const sourceId = get(cells, "id");
    const dateText = get(cells, "date");
    const startText = get(cells, "startTime");
    const endText = get(cells, "endTime");
    const itemType = get(cells, "itemType") || "Event";
    const itemName = get(cells, "itemName");
    const bookedBy = get(cells, "reservedBy");
    const rowers = get(cells, "rowers");
    const oars = get(cells, "oars");

    if (sourceId === "") say(row, "ID is empty. Every booking has an ID in iCrew's report.");
    else if (/^example/i.test(sourceId)) say(row, `"${sourceId}" is one of the template's example rows. Delete the example rows before uploading.`);
    else if (!/^\d{1,12}$/.test(sourceId)) say(row, `ID "${sourceId}" should be a number, like 123456.`);

    let day = "";
    if (dateText === "") say(row, "Date is empty.");
    else {
      const parsed = parseIcrewDay(dateText);
      if ("problem" in parsed) say(row, `Date ${parsed.problem}`);
      else day = parsed.iso;
    }
    let startMin = -1;
    let endMin = -1;
    if (startText === "") say(row, "StartTime is empty.");
    else {
      const parsed = parseIcrewClock(startText);
      if ("problem" in parsed) say(row, `StartTime ${parsed.problem}`);
      else startMin = parsed.minutes;
    }
    if (endText === "") say(row, "EndTime is empty.");
    else {
      const parsed = parseIcrewClock(endText);
      if ("problem" in parsed) say(row, `EndTime ${parsed.problem}`);
      else endMin = parsed.minutes;
    }
    if (startMin >= 0 && endMin >= 0 && endMin <= startMin) {
      // 12:00am as an end time means the midnight at the end of the day.
      if (endMin === 0) endMin = 1440;
      else say(row, `It ends at ${endText}, which is not after it starts at ${startText}.`);
    }
    if (itemName === "") say(row, "Shell/Item is empty.");
    else if (itemName.length > 120) say(row, "Shell/Item is longer than 120 characters.");
    if (itemType.length > 60) say(row, "ItemType is longer than 60 characters.");
    if (bookedBy === "") say(row, "ReservedBy is empty.");
    else if (bookedBy.length > 120) say(row, "ReservedBy is longer than 120 characters.");
    if (rowers.length > 200) say(row, "Rower(s) is longer than 200 characters.");
    if (oars.length > 120) say(row, "Oars is longer than 120 characters.");

    let bookedAt: string | null = null;
    const bookedDayText = get(cells, "bookedOnDate");
    const bookedClockText = get(cells, "bookedAtTime");
    if (bookedDayText !== "" || bookedClockText !== "") {
      const bookedDay = bookedDayText === "" ? null : parseIcrewDay(bookedDayText);
      const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(bookedClockText);
      if (bookedDay === null) say(row, "BookedAtTime is filled in but BookedOnDate is empty.");
      else if ("problem" in bookedDay) say(row, `BookedOnDate ${bookedDay.problem}`);
      else if (bookedClockText !== "" && (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59)) say(row, `BookedAtTime "${bookedClockText}" is not a time like 14:05:33.`);
      else bookedAt = new Date(pacificWall(bookedDay.iso, clock ? Number(clock[1]) * 60 + Number(clock[2]) : 0).getTime() + (clock ? Number(clock[3] ?? 0) * 1000 : 0)).toISOString();
    }
    if (problemCount > before) continue;

    if (day >= today) {
      futureRows += 1;
      continue;
    }
    const key = rowKeyOf(sourceId, bookedBy);
    if (seen.has(key)) {
      repeatedInFile += 1;
      continue;
    }
    seen.set(key, row);
    const people: IcrewPerson[] = [];
    const add = (name: string, k: string, role: "booker" | "rower") => {
      if (!people.some((p) => p.key === k && p.role === role)) people.push({ name, key: k, role });
    };
    for (const p of peopleIn(bookedBy, "booker")) add(p.name, p.key, "booker");
    for (const p of peopleIn(rowers, "rowers")) add(p.name, p.key, "rower");
    rows.push({
      row,
      key,
      sourceId,
      day,
      startsAt: pacificWall(day, startMin).toISOString(),
      endsAt: pacificWall(day, endMin).toISOString(),
      bookedAt,
      itemType,
      itemName,
      oars,
      bookedBy,
      rowers,
      outText: get(cells, "outAt").slice(0, 20),
      inText: get(cells, "inAt").slice(0, 20),
      people,
    });
  }
  if (problemCount > problems.length) problems.push(`...and ${problemCount - problems.length} more problems after these.`);

  const notices: string[] = [];
  if (futureRows > 0) notices.push(`${futureRows} row${futureRows === 1 ? " is" : "s are"} for today or a later day. History only holds days that have passed, so ${futureRows === 1 ? "it is" : "they are"} left out.`);
  if (repeatedInFile > 0) notices.push(`${repeatedInFile} row${repeatedInFile === 1 ? " repeats" : "s repeat"} another row in the file (same ID and same person), so each is kept once.`);
  if (ignoredColumns.length > 0) notices.push(`The file has columns this import does not use, and they are ignored: ${ignoredColumns.map((c) => `"${c}"`).join(", ")}.`);
  return { rows, problems, notices, ignoredColumns, rowCount: dataRows.length, futureRows, repeatedInFile };
}
