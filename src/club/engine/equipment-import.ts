import { ClubError } from "../errors";
import { QUALIFICATIONS } from "../qualifications";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import type { ClubState, Item, OutOfServicePeriod } from "../types";
import { parseCsv } from "./csv";
import type { Ctx } from "./households";
import { fingerprintOf } from "./import";

/**
 * The unit list: loading the club's boats, kayaks, paddle boards and work rooms from a sheet staff prepared. Two steps, like the
 * roster import: `planEquipment` says exactly what a file would do and changes nothing; `runEquipment` does it, all or nothing.
 * It only ever adds. An item already here (same name) is left alone, so a second upload cannot change or remove anything.
 *
 * Left out on purpose, and said so in the read-back: the pooled spaces (Dock Space, Room Space and Gym Space become one pool
 * with a number of places, a later step) and Private boats (who may book them, owners plus the people they name, is a later
 * step, so nothing private can become bookable by everyone by mistake).
 */

export const MAX_EQUIPMENT_BYTES = 200_000;
export const MAX_EQUIPMENT_ROWS = 1000;

/** The columns, as the starter sheet names them. Name, Type, Seats and Owned by are required; the rest are optional. */
export const EQUIPMENT_COLUMNS = ["Name", "Type", "Seats", "Skill level needed", "Owned by", "In service", "Places", "Notes"] as const;

/** The example rows in the template. They are refused if they are uploaded, so nobody loads them by accident. */
export const EQUIPMENT_EXAMPLE_NAMES = ["EXAMPLE-1", "EXAMPLE-2", "EXAMPLE-3"] as const;

export const EQUIPMENT_TEMPLATE =
  [
    EQUIPMENT_COLUMNS.join(","),
    "EXAMPLE-1,Shell,1,,Club,Yes,,",
    "EXAMPLE-2,Kayak,2,None,Club,No,,Paddle needs mending",
    "EXAMPLE-3,Work Space,,,Club,Yes,,",
  ].join("\r\n") + "\r\n";

const MAX_NAME = 80;
const MAX_NOTE = 200;
const MAX_PLACES = 500;

/** The kinds of thing the sheet can name. Three are pools and are not loaded yet. */
export const EQUIPMENT_TYPES = ["Shell", "Kayak", "Paddle Board", "Work Space", "Dock Space", "Room Space", "Gym Space"] as const;
type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
const POOL_TYPES: readonly EquipmentType[] = ["Dock Space", "Room Space", "Gym Space"];

type Field = "name" | "type" | "seats" | "skill" | "ownedBy" | "inService" | "places" | "notes" | "privateHint";
const LABEL: Record<Field, string> = { name: "Name", type: "Type", seats: "Seats", skill: "Skill level needed", ownedBy: "Owned by", inService: "In service", places: "Places", notes: "Notes", privateHint: "Hint: name looks like a private boat" };
const REQUIRED: Field[] = ["name", "type", "seats", "ownedBy"];
/** Header names as people write them, with spaces, capitals and punctuation ignored. */
const ALIASES: Record<Field, string[]> = {
  name: ["name", "itemname", "boatname", "equipmentname"],
  type: ["type", "itemtype", "kind"],
  seats: ["seats", "seatcount", "numberofseats"],
  skill: ["skilllevelneeded", "skilllevel", "skill", "qualification", "qualificationneeded", "levelneeded"],
  ownedBy: ["ownedby", "owner", "ownership"],
  inService: ["inservice"],
  places: ["places", "capacity"],
  notes: ["notes", "note", "comment", "comments"],
  privateHint: ["hintnamelookslikeaprivateboat"],
};

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const TYPE_BY_LETTERS = new Map<string, EquipmentType>(EQUIPMENT_TYPES.map((t) => [letters(t), t]));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How an item's skill level is set: the class's own, none at all, or one named qualification. */
export type EquipmentSkill = { mode: "class" } | { mode: "none" } | { mode: "code"; code: string };

export interface EquipmentRow {
  /** The row in the file, counting the header as row 1. */
  row: number;
  name: string;
  type: EquipmentType;
  /** A pool is one of the three pooled spaces: described by the sheet, not loaded yet. */
  pool: boolean;
  /** Pools only: the number of places the sheet gives, if any. */
  places: number | null;
  classCode: string | null;
  seats: number | null;
  skill: EquipmentSkill;
  ownedBy: "club" | "private" | null;
  inService: boolean;
  notes: string;
  /** The sheet's own hint column said the name looks like a private boat. */
  hintedPrivate: boolean;
}

export interface EquipmentReading {
  rows: EquipmentRow[];
  /** Everything wrong with the file, in the order it was found. Anything here means nothing may be loaded. */
  problems: string[];
  /** Columns in the file that this tool does not use. The sheet's own "Hint" columns are not listed. */
  ignoredColumns: string[];
  /** Rows with something in them, not counting the header. */
  rowCount: number;
}

/** What the sheet can say a skill level is: a qualification's code or its name, or "none" for a boat anyone may use. */
function readSkill(text: string): EquipmentSkill | null {
  const t = clean(text);
  if (t === "") return { mode: "class" };
  if (["none", "anyone", "any", "no"].includes(t.toLowerCase())) return { mode: "none" };
  const key = letters(t.replace(/\(placeholder\)/i, ""));
  const q = QUALIFICATIONS.find((x) => letters(x.code) === key || letters(x.name.replace(/\(placeholder\)/i, "")) === key);
  return q ? { mode: "code", code: q.code } : null;
}

const SKILL_HELP = `Leave it empty to use the boat class's usual level, write None if anyone may use it, or use one of: ${QUALIFICATIONS.map((q) => q.code).join(", ")}.`;

export function readEquipment(text: string): EquipmentReading {
  const empty = (problem: string): EquipmentReading => ({ rows: [], problems: [problem], ignoredColumns: [], rowCount: 0 });
  if (text.length > MAX_EQUIPMENT_BYTES) return empty(`The file is too big: it can be up to ${MAX_EQUIPMENT_BYTES / 1000} KB, which is far more equipment than the club has.`);
  if (text.startsWith("PK")) return empty("That looks like an Excel file, not a CSV. In Excel choose Save As, then CSV (Comma delimited), and upload that.");
  if (text.includes("\u0000")) return empty("That is not a plain CSV text file. In your spreadsheet choose Save As, then CSV (Comma delimited), and upload that.");

  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    if (e instanceof ClubError) return empty(e.message);
    throw e;
  }
  while (table.length > 0 && table[table.length - 1].every((c) => c.trim() === "")) table.pop();
  if (table.length === 0) return empty("The file is empty.");

  // The header: which column is which.
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
  const ignoredColumns = header.filter((h, i) => h !== "" && !used.has(i) && !letters(h).startsWith("hint"));
  const missing = REQUIRED.filter((f) => column[f] === undefined);
  if (missing.length > 0) {
    problems.push(
      `The file has no column for ${missing.map((f) => `"${LABEL[f]}"`).join(", ")}. It has: ${header.filter(Boolean).map((h) => `"${h}"`).join(", ") || "no column names"}. Start from the starter sheet or the blank template, which have every column.`,
    );
  }
  if (problems.length > 0) return { rows: [], problems, ignoredColumns, rowCount: 0 };

  const dataRows = table.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (dataRows.length > MAX_EQUIPMENT_ROWS) return { rows: [], problems: [`The file has ${dataRows.length} rows. It can have up to ${MAX_EQUIPMENT_ROWS}.`], ignoredColumns, rowCount: dataRows.length };

  const get = (cells: string[], field: Field) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
  const rows: EquipmentRow[] = [];
  const firstRowOf = new Map<string, number>();
  for (const { cells, row } of dataRows) {
    const name = clean(get(cells, "name"));
    const typeText = clean(get(cells, "type"));
    const seatsText = get(cells, "seats");
    const skillText = get(cells, "skill");
    const ownedText = clean(get(cells, "ownedBy"));
    const serviceText = clean(get(cells, "inService"));
    const placesText = get(cells, "places");
    const notes = clean(get(cells, "notes"));
    const before = problems.length;
    const say = (p: string) => problems.push(`Row ${row}: ${p}`);

    if (name === "") say("Name is empty. Every row needs the item's name.");
    else if (name.length > MAX_NAME) say(`Name is longer than ${MAX_NAME} characters.`);
    else if (/[\u0000-\u001f\u007f]/.test(name)) say("Name has a character that cannot be saved. Retype it.");
    else if ((EQUIPMENT_EXAMPLE_NAMES as readonly string[]).includes(name.toUpperCase())) say(`"${name}" is one of the template's example rows. Delete the example rows before uploading.`);
    if (notes.length > MAX_NOTE) say(`Notes is longer than ${MAX_NOTE} characters.`);

    const type = TYPE_BY_LETTERS.get(letters(typeText));
    if (typeText === "") say("Type is empty. Use one of: " + EQUIPMENT_TYPES.join(", ") + ".");
    else if (!type) {
      if (letters(typeText) === "fitness" || letters(typeText) === "cardio") say(`Type "${typeText}": cardio machines are not reserved in the new system, so remove this row.`);
      else say(`Type "${typeText}" is not one of: ${EQUIPMENT_TYPES.join(", ")}.`);
    }
    if (problems.length > before || !type) continue;

    // The pooled spaces are described, not loaded: only their name and place count are checked.
    if (POOL_TYPES.includes(type)) {
      let places: number | null = null;
      if (placesText !== "") {
        if (!/^\d{1,4}$/.test(placesText) || Number(placesText) < 1 || Number(placesText) > MAX_PLACES) say(`Places must be a whole number from 1 to ${MAX_PLACES}, or empty.`);
        else places = Number(placesText);
      }
      if (problems.length > before) continue;
      rows.push({ row, name, type, pool: true, places, classCode: null, seats: null, skill: { mode: "class" }, ownedBy: null, inService: true, notes, hintedPrivate: false });
      continue;
    }

    // An individual item: boat, kayak, paddle board or work room.
    let seats: number | null = null;
    if (seatsText === "") {
      if (type === "Shell" || type === "Kayak") say(`Seats is empty. A ${type.toLowerCase()} needs its number of seats (${type === "Shell" ? "1, 2 or 4" : "1 or 2"}).`);
    } else if (!/^\d{1,2}$/.test(seatsText)) say(`Seats "${seatsText}" is not a number.`);
    else seats = Number(seatsText);
    if (seats !== null) {
      if (type === "Shell" && ![1, 2, 4].includes(seats)) say(`Seats ${seats} does not fit a shell: use 1 (single), 2 (double) or 4 (quad or four).`);
      if (type === "Kayak" && ![1, 2].includes(seats)) say(`Seats ${seats} does not fit a kayak: use 1 or 2.`);
      if ((type === "Paddle Board" || type === "Work Space") && seats !== 1) say(`Seats ${seats} does not fit a ${type.toLowerCase()}: leave it empty or use 1.`);
    }

    const skill = readSkill(skillText);
    if (!skill) say(`Skill level needed "${clean(skillText)}" is not one the system knows. ${SKILL_HELP}`);

    let ownedBy: "club" | "private" | null = null;
    if (ownedText === "") say("Owned by is empty. Write Club or Private.");
    else if (ownedText.toLowerCase() === "club") ownedBy = "club";
    else if (ownedText.toLowerCase() === "private") ownedBy = "private";
    else say(`Owned by "${ownedText}" is not Club or Private.`);

    let inService = true;
    if (serviceText !== "") {
      const s = serviceText.toLowerCase();
      if (["yes", "y", "true"].includes(s)) inService = true;
      else if (["no", "n", "false"].includes(s)) inService = false;
      else say(`In service "${serviceText}" is not Yes or No.`);
    }
    if (problems.length > before) continue;

    const key = name.toLowerCase();
    const first = firstRowOf.get(key);
    if (first !== undefined) {
      say(`${name} is already on row ${first}. List each item once.`);
      continue;
    }
    firstRowOf.set(key, row);

    let classCode: string;
    if (type === "Shell") classCode = seats === 1 ? "shell-single" : seats === 2 ? "shell-double" : "shell-quad";
    else if (type === "Kayak") classCode = seats === 2 ? "kayak-double" : "kayak";
    else if (type === "Paddle Board") classCode = "paddle-board";
    else classCode = "work-space";
    rows.push({
      row,
      name,
      type,
      pool: false,
      places: null,
      classCode,
      seats: seats ?? 1,
      skill: skill!,
      ownedBy,
      inService,
      notes,
      hintedPrivate: letters(get(cells, "privateHint")) === "yes",
    });
  }
  return { rows, problems, ignoredColumns, rowCount: dataRows.length };
}

export interface PlannedItem {
  /** The row in the file. */
  row: number;
  name: string;
  type: string;
  classCode: string;
  /** The boat class's name, for example "Double". */
  className: string;
  seats: number;
  /** In words: "the usual level for this class", "none needed", or the qualification's name. */
  skill: string;
  skillMode: EquipmentSkill["mode"];
  outOfService: boolean;
  /** Why it starts out of service; empty when it does not. */
  reason: string;
}

export interface EquipmentPlan {
  /** Everything wrong with the file. Anything here means nothing can be loaded until the file is fixed. */
  problems: string[];
  /** Things worth a look that do not stop it. */
  notices: string[];
  ignoredColumns: string[];
  rowCount: number;
  /** The items the file would add, in the order of the file. */
  toAdd: PlannedItem[];
  /** Items in the file whose name is already in the club: left alone. */
  alreadyHere: { row: number; name: string }[];
  /** Pool rows: described by the sheet, not loaded yet. */
  pools: { row: number; name: string; type: string; places: number | null }[];
  /** Rows marked Private: not loaded yet. */
  privateBoats: { row: number; name: string; type: string }[];
  /** A fingerprint of the exact file, so the confirm step can tell it is the file that was checked. */
  fingerprint: string;
}

const qualificationName = (code: string) => QUALIFICATIONS.find((q) => q.code === code)?.name ?? code;

/** An item's skill level in words, for the read-back. */
function skillWords(skill: EquipmentSkill, classLevel: string | null): string {
  if (skill.mode === "code") return qualificationName(skill.code);
  if (skill.mode === "none") return "none needed";
  return classLevel ? `the usual level for this class (${qualificationName(classLevel)})` : "none needed";
}

const NOT_IN_SERVICE_REASON = "Not in service when the equipment list was loaded.";

function compute(state: ClubState, text: string): EquipmentPlan {
  const reading = readEquipment(text);
  const problems = reading.problems;
  const notices: string[] = [];
  const here = new Set(state.items.map((i) => clean(i.name).toLowerCase()));
  const toAdd: PlannedItem[] = [];
  const alreadyHere: EquipmentPlan["alreadyHere"] = [];
  const pools: EquipmentPlan["pools"] = [];
  const privateBoats: EquipmentPlan["privateBoats"] = [];
  const hintedButClub: number[] = [];

  for (const r of reading.rows) {
    if (r.pool) {
      pools.push({ row: r.row, name: r.name, type: r.type, places: r.places });
      continue;
    }
    if (r.ownedBy === "private") {
      privateBoats.push({ row: r.row, name: r.name, type: r.type });
      continue;
    }
    if (here.has(r.name.toLowerCase())) {
      alreadyHere.push({ row: r.row, name: r.name });
      continue;
    }
    if (r.hintedPrivate) hintedButClub.push(r.row);
    const cls = RULE_BOOK.classes.find((c) => c.code === r.classCode)!;
    const skill = skillWords(r.skill, cls.requiredQualification);
    toAdd.push({
      row: r.row,
      name: r.name,
      type: r.type,
      classCode: r.classCode!,
      className: cls.name,
      seats: cls.seats,
      skill,
      skillMode: r.skill.mode,
      outOfService: !r.inService,
      reason: r.inService ? "" : r.notes || NOT_IN_SERVICE_REASON,
    });
  }

  if (reading.ignoredColumns.length > 0) notices.push(`The file has columns this tool does not use, and they are ignored: ${reading.ignoredColumns.map((c) => `"${c}"`).join(", ")}.`);
  if (pools.length > 0) {
    const kinds = [...new Set(pools.map((p) => p.type))].join(", ");
    notices.push(`${plural(pools.length, "row")} (${kinds}) describe pools of places. Pools are a later step, so they are not loaded now. Upload the file again then.`);
  }
  if (privateBoats.length > 0) {
    notices.push(
      `${plural(privateBoats.length, "row")} ${privateBoats.length === 1 ? "is" : "are"} marked Private and ${privateBoats.length === 1 ? "is" : "are"} not loaded now. Who may book a private boat (its owners and the people they name) is a later step, and loading them now would let everyone book them. Upload the file again then; items already here are skipped.`,
    );
  }
  if (hintedButClub.length > 0) {
    notices.push(
      `${plural(hintedButClub.length, "row")} marked Club ${hintedButClub.length === 1 ? "has" : "have"} a name that looks like a private boat in the sheet's hint column (${hintedButClub.slice(0, 10).map((n) => `row ${n}`).join(", ")}${hintedButClub.length > 10 ? ", ..." : ""}). If any are really private, mark them Private before loading, or they will be bookable by everyone.`,
    );
  }
  if (alreadyHere.length > 0) notices.push(`${plural(alreadyHere.length, "item")} already in the club ${alreadyHere.length === 1 ? "is" : "are"} left alone: an upload never changes or removes anything that is already here.`);
  const out = toAdd.filter((i) => i.outOfService).length;
  if (out > 0) notices.push(`${plural(out, "item")} will be added out of service. Staff can return ${out === 1 ? "it" : "them"} to service on the Equipment page.`);

  return { problems, notices, ignoredColumns: reading.ignoredColumns, rowCount: reading.rowCount, toAdd, alreadyHere, pools, privateBoats, fingerprint: fingerprintOf(text) };
}

/** What a file would do, without doing it. */
export function planEquipment(state: ClubState, text: string): EquipmentPlan {
  return compute(state, text);
}

export interface EquipmentResult {
  added: number;
  outOfService: number;
  alreadyHere: number;
  pools: number;
  privateBoats: number;
}

/**
 * Adds every item the file names, in one all-or-nothing change. Staff only. The file is checked again inside the change, so a
 * file with a problem, or one that no longer matches what was previewed (`expect`), adds nothing.
 */
export async function runEquipment(store: ClubStore, ctx: Ctx, text: string, expect?: { fingerprint: string; items: number }): Promise<EquipmentResult> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can load the equipment list.");
  return store.transaction(async (s, newId) => {
    const plan = compute(s, text);
    if (plan.problems.length > 0) throw new ClubError("invalid", `The file has ${plan.problems.length} problem${plan.problems.length === 1 ? "" : "s"}, so nothing was added. Fix the file and check it again.`);
    if (plan.toAdd.length === 0) {
      throw new ClubError(
        "conflict",
        plan.alreadyHere.length > 0 || plan.pools.length > 0 || plan.privateBoats.length > 0
          ? "Everything in the file is already here or waiting for a later step, so there is nothing to add."
          : "The file has no equipment to add.",
      );
    }
    if (expect && (expect.fingerprint !== plan.fingerprint || expect.items !== plan.toAdd.length)) {
      throw new ClubError("conflict", "The file, or the club's records, changed since you checked it, so nothing was added. Check the file again.");
    }
    const rows = new Map(readEquipment(text).rows.map((r) => [r.row, r]));
    let outOfService = 0;
    for (const p of plan.toAdd) {
      const source = rows.get(p.row)!;
      const item: Item = { id: newId(), name: p.name, classCode: p.classCode, ruleOverrides: {} };
      if (source.skill.mode === "none") item.requiredQualification = null;
      else if (source.skill.mode === "code") item.requiredQualification = source.skill.code;
      s.items.push(item);
      if (p.outOfService) {
        const period: OutOfServicePeriod = {
          id: newId(),
          itemId: item.id,
          from: ctx.now.toISOString(),
          until: null,
          reason: p.reason,
          expectedReturn: null,
          createdBy: ctx.actor,
          createdAt: ctx.now.toISOString(),
        };
        s.outOfService.push(period);
        outOfService += 1;
      }
    }
    return { added: plan.toAdd.length, outOfService, alreadyHere: plan.alreadyHere.length, pools: plan.pools.length, privateBoats: plan.privateBoats.length };
  });
}
