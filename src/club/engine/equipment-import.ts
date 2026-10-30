import { normalizeEmail } from "../auth/email";
import { ClubError } from "../errors";
import { QUALIFICATIONS } from "../qualifications";
import { RULE_BOOK } from "../settings/rulebook";
import type { ClubStore } from "../store/memory";
import type { BoatAccess, ClubState, Item, OutOfServicePeriod } from "../types";
import { parseCsv } from "./csv";
import { blockReasonFor } from "./eligibility";
import type { Ctx } from "./households";
import { fingerprintOf } from "./import";
import { fullName } from "./queries";

/**
 * The unit list: loading the club's boats, kayaks, paddle boards and work rooms from a sheet staff prepared. Two steps, like the
 * roster import: `planEquipment` says exactly what a file would do and changes nothing; `runEquipment` does it, all or nothing.
 * It only ever adds. An item already here (same name) is left alone, so a second upload cannot change or remove anything.
 *
 * A row marked Private is added as a private boat: only its owners and the people they invite can use it (see boat-access.ts). The
 * optional Owner emails column names its owners, each as an email address or a full name, separated by semicolons. A private
 * boat with no owner is added anyway and starts locked, so nobody can book it until staff add an owner.
 *
 * A Dock Space, Room Space or Gym Space row is a pool: one item with a number of places (the Places column), counted rather than
 * numbered. Members book a time and see how many places are left; nobody is given a place number (see pools.ts).
 */

export const MAX_EQUIPMENT_BYTES = 200_000;
export const MAX_EQUIPMENT_ROWS = 1000;

/** The columns, as the starter sheet names them. Name, Type, Seats and Owned by are required; the rest are optional. */
export const EQUIPMENT_COLUMNS = ["Name", "Type", "Seats", "Skill level needed", "Owned by", "In service", "Places", "Notes", "Owner emails"] as const;

/** The example rows in the template. They are refused if they are uploaded, so nobody loads them by accident. */
export const EQUIPMENT_EXAMPLE_NAMES = ["EXAMPLE-1", "EXAMPLE-2", "EXAMPLE-3", "EXAMPLE-4", "EXAMPLE-5"] as const;

export const EQUIPMENT_TEMPLATE =
  [
    EQUIPMENT_COLUMNS.join(","),
    "EXAMPLE-1,Shell,1,,Club,Yes,,",
    "EXAMPLE-2,Kayak,2,None,Club,No,,Paddle needs mending",
    "EXAMPLE-3,Work Space,,,Club,Yes,,",
    "EXAMPLE-4,Shell,2,,Private,Yes,,,someone@example.org; Pat Example",
    "EXAMPLE-5,Gym Space,,,Club,Yes,8,",
  ].join("\r\n") + "\r\n";

const MAX_NAME = 80;
const MAX_NOTE = 200;
const MAX_PLACES = 500;
const MAX_OWNERS = 10;
const MAX_OWNER_TOKEN = 120;

/** The kinds of thing the sheet can name. Three are pools: one item with a number of places. */
export const EQUIPMENT_TYPES = ["Shell", "Kayak", "Paddle Board", "Work Space", "Dock Space", "Room Space", "Gym Space"] as const;
type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
const POOL_TYPES: readonly EquipmentType[] = ["Dock Space", "Room Space", "Gym Space"];

type Field = "name" | "type" | "seats" | "skill" | "ownedBy" | "inService" | "places" | "notes" | "owners" | "privateHint";
const LABEL: Record<Field, string> = { name: "Name", type: "Type", seats: "Seats", skill: "Skill level needed", ownedBy: "Owned by", inService: "In service", places: "Places", notes: "Notes", owners: "Owner emails", privateHint: "Hint: name looks like a private boat" };
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
  owners: ["owneremails", "owneremail", "owners", "ownersemails", "ownernames"],
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
  /** A pool is one of the three pooled spaces: one item with a number of places. */
  pool: boolean;
  /** Pools only: the number of places the sheet gives. Null for everything else. */
  places: number | null;
  classCode: string | null;
  seats: number | null;
  skill: EquipmentSkill;
  ownedBy: "club" | "private" | null;
  inService: boolean;
  notes: string;
  /** Private rows only: the owners as written (an email address or a full name each), before they are looked up. */
  owners: string[];
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

    // In service: Yes or empty, or No. A No item is added out of service.
    const readInService = (): boolean => {
      if (serviceText === "") return true;
      const t = serviceText.toLowerCase();
      if (["yes", "y", "true"].includes(t)) return true;
      if (["no", "n", "false"].includes(t)) return false;
      say(`In service "${serviceText}" is not Yes or No.`);
      return true;
    };
    // The same name twice in one file is a mistake.
    const listedOnce = (): boolean => {
      const first = firstRowOf.get(name.toLowerCase());
      if (first !== undefined) {
        say(`${name} is already on row ${first}. List each item once.`);
        return false;
      }
      firstRowOf.set(name.toLowerCase(), row);
      return true;
    };

    // A pool: one item with a number of places, counted rather than numbered. It is the club's, has no seats and no owners.
    if (POOL_TYPES.includes(type)) {
      let places = 0;
      if (placesText === "") say(`Places is empty. A ${type.toLowerCase()} pool needs its number of places, from 1 to ${MAX_PLACES}.`);
      else if (!/^\d{1,4}$/.test(placesText) || Number(placesText) < 1 || Number(placesText) > MAX_PLACES) say(`Places must be a whole number from 1 to ${MAX_PLACES}.`);
      else places = Number(placesText);
      if (seatsText !== "" && seatsText !== "1") say("Seats does not apply to a pool: leave it empty. Use Places for how many people it holds at once.");
      const poolSkill = readSkill(skillText);
      if (!poolSkill) say(`Skill level needed "${clean(skillText)}" is not one the system knows. ${SKILL_HELP}`);
      if (ownedText.toLowerCase() === "private") say("A pool cannot be private. Leave Owned by empty or write Club.");
      else if (ownedText !== "" && ownedText.toLowerCase() !== "club") say(`Owned by "${ownedText}" is not Club.`);
      if (get(cells, "owners") !== "") say("Owner emails is only for Private boats. Clear it.");
      const poolInService = readInService();
      if (problems.length > before) continue;
      if (!listedOnce()) continue;
      const poolClass = type === "Dock Space" ? "dock-space" : type === "Gym Space" ? "gym-space" : "room-space";
      rows.push({ row, name, type, pool: true, places, classCode: poolClass, seats: 1, skill: poolSkill!, ownedBy: "club", inService: poolInService, notes, owners: [], hintedPrivate: false });
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

    const owners: string[] = [];
    const ownersText = get(cells, "owners");
    if (ownersText !== "") {
      if (ownedBy === "club") say("Owner emails is only for Private boats. Clear it, or change Owned by to Private.");
      else {
        const seen = new Set<string>();
        for (const raw of ownersText.split(/[;\n]/)) {
          const token = clean(raw);
          if (token === "") continue;
          if (token.length > MAX_OWNER_TOKEN || /[\u0000-\u001f\u007f]/.test(token)) {
            say(`An owner "${token.slice(0, 30)}..." is not an email address or a name. Write each owner as an email address or a full name, separated by semicolons.`);
            continue;
          }
          const key = token.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          owners.push(token);
        }
        if (owners.length > MAX_OWNERS) say(`Owner emails lists ${owners.length} people. A boat can have up to ${MAX_OWNERS} owners here; add the rest on the Private boats screen.`);
      }
    }

    const inService = readInService();
    if (problems.length > before) continue;
    if (!listedOnce()) continue;

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
      owners,
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
  /** A pool: one item with a number of places, counted rather than numbered. */
  pool: boolean;
  /** How many people can hold it at once: one unless it is a pool. */
  places: number;
  /** A private boat: only its owners and the people they invite can use it. */
  private: boolean;
  /** Private boats only: the owners the file names, found among the club's members. Empty means it starts locked. */
  owners: { memberId: string; name: string }[];
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

/** The spreadsheet row a problem is about ("Row 7: ..."), or 0 for a problem about the whole file. */
const rowOfProblem = (problem: string) => Number(/^Row (\d+):/.exec(problem)?.[1] ?? 0);

/**
 * Finds the club members an owners cell names. Each owner is an email address or a full name. Only active members can own a boat.
 * An address two partners share, or two members with one name, is a problem: the sheet must say which person it means.
 */
function findOwners(state: ClubState, row: EquipmentRow): { owners: PlannedItem["owners"]; problems: string[] } {
  const active = state.members.filter((m) => blockReasonFor(state, m.id) === null);
  const owners: PlannedItem["owners"] = [];
  const problems: string[] = [];
  for (const token of row.owners) {
    const email = token.includes("@") ? normalizeEmail(token) : null;
    if (token.includes("@") && !email) {
      problems.push(`Row ${row.row}: "${token}" does not look like an email address. Write each owner as an email address or a full name, separated by semicolons.`);
      continue;
    }
    const wanted = email ?? clean(token).toLowerCase();
    const found = active.filter((m) => (email ? m.email.trim().toLowerCase() === email : clean(fullName(m)).toLowerCase() === wanted));
    if (found.length === 0) {
      problems.push(`Row ${row.row}: no active member has ${email ? `the email address ${token}` : `the name ${token}`}. Check the spelling, or leave it out and add the owner on the Private boats screen.`);
    } else if (found.length > 1) {
      problems.push(
        email
          ? `Row ${row.row}: the email address ${token} is shared by ${found.map(fullName).join(" and ")}. Write the owner's full name instead.`
          : `Row ${row.row}: more than one member is called ${token}. Write the owner's email address instead.`,
      );
    } else if (!owners.some((o) => o.memberId === found[0].id)) {
      owners.push({ memberId: found[0].id, name: fullName(found[0]) });
    }
  }
  return { owners, problems };
}

function compute(state: ClubState, text: string): EquipmentPlan {
  const reading = readEquipment(text);
  const problems = [...reading.problems];
  const notices: string[] = [];
  const here = new Set(state.items.map((i) => clean(i.name).toLowerCase()));
  const toAdd: PlannedItem[] = [];
  const alreadyHere: EquipmentPlan["alreadyHere"] = [];
  const hintedButClub: number[] = [];

  for (const r of reading.rows) {
    if (here.has(r.name.toLowerCase())) {
      alreadyHere.push({ row: r.row, name: r.name });
      continue;
    }
    if (r.hintedPrivate && r.ownedBy === "club") hintedButClub.push(r.row);
    const cls = RULE_BOOK.classes.find((c) => c.code === r.classCode)!;
    const isPrivate = r.ownedBy === "private";
    const skill = isPrivate ? "not checked on a private boat" : skillWords(r.skill, cls.requiredQualification);
    const owners = isPrivate ? findOwners(state, r) : { owners: [], problems: [] };
    problems.push(...owners.problems);
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
      pool: r.pool,
      places: r.places ?? 1,
      private: isPrivate,
      owners: owners.owners,
    });
  }
  // The reader's problems and the owner lookups' come from two places; list them all in the order of the file.
  problems.sort((a, b) => rowOfProblem(a) - rowOfProblem(b));

  if (reading.ignoredColumns.length > 0) notices.push(`The file has columns this tool does not use, and they are ignored: ${reading.ignoredColumns.map((c) => `"${c}"`).join(", ")}.`);
  const pools = toAdd.filter((i) => i.pool);
  if (pools.length > 0) {
    notices.push(
      `${plural(pools.length, "pool")} will be added: ${pools.slice(0, 5).map((p) => `${p.name} (${plural(p.places, "place")})`).join(", ")}${pools.length > 5 ? `, and ${pools.length - 5} more` : ""}. Members book a time and see how many places are left; nobody is given a place number.`,
    );
  }
  const privates = toAdd.filter((i) => i.private);
  if (privates.length > 0) {
    notices.push(`${plural(privates.length, "private boat")} will be added. Only a private boat's owners and the people they invite can see or book it, and its skill level is not checked.`);
    const locked = privates.filter((i) => i.owners.length === 0);
    if (locked.length > 0) {
      notices.push(
        `${plural(locked.length, "private boat")} ${locked.length === 1 ? "has" : "have"} no owner in the file (${locked.slice(0, 5).map((i) => i.name).join(", ")}${locked.length > 5 ? ", ..." : ""}), so ${locked.length === 1 ? "it" : "they"} will start locked: nobody can book ${locked.length === 1 ? "it" : "them"} until staff add an owner on the Private boats screen.`,
      );
    }
  }
  if (hintedButClub.length > 0) {
    notices.push(
      `${plural(hintedButClub.length, "row")} marked Club ${hintedButClub.length === 1 ? "has" : "have"} a name that looks like a private boat in the sheet's hint column (${hintedButClub.slice(0, 10).map((n) => `row ${n}`).join(", ")}${hintedButClub.length > 10 ? ", ..." : ""}). If any are really private, mark them Private before loading, or they will be bookable by everyone.`,
    );
  }
  if (alreadyHere.length > 0) notices.push(`${plural(alreadyHere.length, "item")} already in the club ${alreadyHere.length === 1 ? "is" : "are"} left alone: an upload never changes or removes anything that is already here.`);
  const out = toAdd.filter((i) => i.outOfService).length;
  if (out > 0) notices.push(`${plural(out, "item")} will be added out of service. Staff can return ${out === 1 ? "it" : "them"} to service on the Equipment page.`);

  return { problems, notices, ignoredColumns: reading.ignoredColumns, rowCount: reading.rowCount, toAdd, alreadyHere, fingerprint: fingerprintOf(text) };
}

/** What a file would do, without doing it. */
export function planEquipment(state: ClubState, text: string): EquipmentPlan {
  return compute(state, text);
}

export interface EquipmentResult {
  added: number;
  outOfService: number;
  alreadyHere: number;
  /** How many of the items added are pools (a dock, the club room, the gym). */
  pools: number;
  /** How many of the items added are private boats. */
  privateBoats: number;
  /** How many of those private boats start locked because the file named no owner. */
  locked: number;
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
        plan.alreadyHere.length > 0 ? "Everything in the file is already here, so there is nothing to add." : "The file has no equipment to add.",
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
      if (p.private) item.isPrivate = true;
      if (p.pool && p.places > 1) item.places = p.places;
      s.items.push(item);
      for (const owner of p.owners) {
        const line: BoatAccess = { id: newId(), itemId: item.id, memberId: owner.memberId, kind: "owner", addedAt: ctx.now.toISOString(), addedBy: ctx.actor, endedAt: null, endedBy: null, endedReason: null };
        s.boatAccess.push(line);
      }
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
    return {
      added: plan.toAdd.length,
      outOfService,
      alreadyHere: plan.alreadyHere.length,
      pools: plan.toAdd.filter((i) => i.pool).length,
      privateBoats: plan.toAdd.filter((i) => i.private).length,
      locked: plan.toAdd.filter((i) => i.private && i.owners.length === 0).length,
    };
  });
}
