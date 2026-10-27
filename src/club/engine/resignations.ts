import { ClubError } from "../errors";
import { RESIGNATION_RULES, type ResignationRules } from "../settings/resignation-rules";
import type { ClubStore } from "../store/memory";
import { formatDay, pacificDate } from "../time";
import type { ClubState } from "../types";
import { monthLabel, monthOf, nextMonth } from "./billing-words";
import { parseCsv } from "./csv";
import { departurePreview, type DeparturePreview } from "./departure";
import { endHouseholdRecords, type BookingLedger, type Ctx } from "./households";
import { fingerprintOf } from "./import";
import { fullName } from "./queries";

/**
 * Move-out day: ending many memberships from a file staff prepared. Two steps, like the roster import: `planResignations`
 * says exactly which households a file would end and what that cancels, and changes nothing; `runResignations` does it, all or
 * nothing, through the same code that ends one household at the front desk. Households are matched by QuickBooks ID. It only
 * ever ends: nothing is added, edited or removed, and a household that has already ended is skipped.
 */

export const MAX_RESIGNATION_BYTES = 200_000;
export const MAX_RESIGNATION_ROWS = 1000;

/** The columns, as the template names them. Only the QuickBooks ID is required. */
export const RESIGNATION_COLUMNS = ["QuickBooks ID", "Household name", "Note"] as const;

/** The two example households in the template. They are refused if they are uploaded, so nobody ends them by accident. */
export const RESIGNATION_EXAMPLE_IDS = ["EXAMPLE-1", "EXAMPLE-2"] as const;

export const RESIGNATION_TEMPLATE =
  [RESIGNATION_COLUMNS.join(","), "EXAMPLE-1,The Example household,Moved out of the area", "EXAMPLE-2,The Sample household,"].join("\r\n") + "\r\n";

const MAX_NAME = 120;
const MAX_NOTE = 200;
const MAX_ID = 100;

type Field = "quickbooksId" | "householdName" | "note";
const LABEL: Record<Field, string> = { quickbooksId: "QuickBooks ID", householdName: "Household name", note: "Note" };
/** Header names as people write them, with spaces, capitals and punctuation ignored. */
const ALIASES: Record<Field, string[]> = {
  quickbooksId: ["quickbooksid", "quickbookscustomerid", "qbid", "qboid"],
  householdName: ["householdname", "household", "customer", "customername"],
  note: ["note", "notes", "reason", "comment", "comments"],
};

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

export interface ResignationRow {
  /** The row in the file, counting the header as row 1. */
  row: number;
  quickbooksId: string;
  /** What the file calls the household; empty when the file has no name for it. */
  householdName: string;
  note: string;
}

export interface ResignationReading {
  rows: ResignationRow[];
  /** Everything wrong with the file, in the order it was found. Anything here means nothing may be ended. */
  problems: string[];
  /** Columns in the file that this tool does not use (a QuickBooks export has many). */
  ignoredColumns: string[];
  /** Rows with something in them, not counting the header. */
  rowCount: number;
  /** Whether the file has a Household name column, which lets each ID be double-checked against a name. */
  hasNames: boolean;
}

export function readResignations(text: string): ResignationReading {
  const empty = (problem: string): ResignationReading => ({ rows: [], problems: [problem], ignoredColumns: [], rowCount: 0, hasNames: false });
  if (text.length > MAX_RESIGNATION_BYTES) return empty(`The file is too big: it can be up to ${MAX_RESIGNATION_BYTES / 1000} KB, which is far more households than one file can end.`);
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
  const ignoredColumns = header.filter((h, i) => h !== "" && !used.has(i));
  const hasNames = column.householdName !== undefined;
  if (column.quickbooksId === undefined) {
    problems.push(
      `The file has no column for "QuickBooks ID". It has: ${header.filter(Boolean).map((h) => `"${h}"`).join(", ") || "no column names"}. It needs a QuickBooks ID for each household (Household name and Note are optional).`,
    );
  }
  if (problems.length > 0) return { rows: [], problems, ignoredColumns, rowCount: 0, hasNames };

  const dataRows = table.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (dataRows.length > MAX_RESIGNATION_ROWS) return { rows: [], problems: [`The file has ${dataRows.length} rows. It can have up to ${MAX_RESIGNATION_ROWS}.`], ignoredColumns, rowCount: dataRows.length, hasNames };

  const get = (cells: string[], field: Field) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
  const rows: ResignationRow[] = [];
  const firstRowOf = new Map<string, number>();
  for (const { cells, row } of dataRows) {
    const quickbooksId = get(cells, "quickbooksId");
    const householdName = get(cells, "householdName").replace(/\s+/g, " ");
    const note = get(cells, "note").replace(/\s+/g, " ");
    const before = problems.length;
    const say = (p: string) => problems.push(`Row ${row}: ${p}`);

    if (quickbooksId === "") say("QuickBooks ID is empty. Every row needs the household's QuickBooks ID.");
    else if (quickbooksId.length > MAX_ID) say(`QuickBooks ID is longer than ${MAX_ID} characters.`);
    else if ((RESIGNATION_EXAMPLE_IDS as readonly string[]).includes(quickbooksId.toUpperCase())) say(`"${quickbooksId}" is one of the template's example rows. Delete the example rows before uploading.`);
    if (householdName.length > MAX_NAME) say(`Household name is longer than ${MAX_NAME} characters.`);
    if (note.length > MAX_NOTE) say(`Note is longer than ${MAX_NOTE} characters.`);
    if (problems.length > before) continue;

    const first = firstRowOf.get(quickbooksId);
    if (first !== undefined) {
      say(`QuickBooks ID ${quickbooksId} is already on row ${first}. List each household once.`);
      continue;
    }
    firstRowOf.set(quickbooksId, row);
    rows.push({ row, quickbooksId, householdName, note });
  }
  return { rows, problems, ignoredColumns, rowCount: dataRows.length, hasNames };
}

export interface PlannedResignation {
  /** The row in the file. */
  row: number;
  quickbooksId: string;
  householdId: string;
  displayName: string;
  /** The adults who will be blocked, by name. */
  adults: string[];
  note: string;
}

export interface ResignationPlan {
  /** Everything wrong with the file. Anything here means nothing can be ended until the file is fixed. */
  problems: string[];
  /** Things worth a look that do not stop it. */
  notices: string[];
  ignoredColumns: string[];
  rowCount: number;
  /** The day the memberships would end: today, on the Pacific clock. */
  endsOn: string;
  /** The households the file would end, in the order of the file. */
  toEnd: PlannedResignation[];
  adultsToBlock: number;
  /** Everything ending all of them would cancel, worked out together so it matches what really happens. */
  preview: DeparturePreview;
  /** Households in the file that had already ended: skipped. */
  alreadyEnded: { quickbooksId: string; displayName: string; endedOn: string }[];
  /** A fingerprint of the exact file, so the confirm step can tell it is the file that was checked. */
  fingerprint: string;
}

function compute(state: ClubState, text: string, now: Date, rules: ResignationRules): ResignationPlan {
  const reading = readResignations(text);
  const problems = [...reading.problems];
  const notices: string[] = [];
  const endsOn = pacificDate(now);
  const byQuickbooks = new Map(state.households.filter((h) => h.quickbooksId !== null).map((h) => [h.quickbooksId!, h]));
  const toEnd: PlannedResignation[] = [];
  const alreadyEnded: ResignationPlan["alreadyEnded"] = [];

  for (const r of reading.rows) {
    const household = byQuickbooks.get(r.quickbooksId);
    if (!household) {
      problems.push(
        `Row ${r.row}: no household in the club has QuickBooks ID ${r.quickbooksId}. Check the ID in QuickBooks (a spreadsheet can drop a leading zero). A household with no QuickBooks ID cannot be named in a file; end it in the household desk.`,
      );
      continue;
    }
    if (r.householdName !== "" && !sameName(r.householdName, household.displayName)) {
      problems.push(`Row ${r.row}: QuickBooks ID ${r.quickbooksId} is "${household.displayName}" in the club, but the file calls it "${r.householdName}". Fix the ID or the name, so the wrong household is never ended.`);
      continue;
    }
    if (household.status === "ended") {
      alreadyEnded.push({ quickbooksId: r.quickbooksId, displayName: household.displayName, endedOn: household.endedOn! });
      continue;
    }
    const adults = state.members.filter((m) => m.householdId === household.id && m.status === "active");
    toEnd.push({ row: r.row, quickbooksId: r.quickbooksId, householdId: household.id, displayName: household.displayName, adults: adults.map(fullName), note: r.note });
  }

  const max = rules.defaults.maxHouseholdsPerFile;
  if (toEnd.length > max) {
    problems.push(`The file would end ${toEnd.length} households, and one file can end at most ${max}. If that is right, split it into files of ${max} or fewer and upload them one after another.`);
  }

  const leaving = new Set(toEnd.map((h) => h.householdId));
  const memberIds = state.members.filter((m) => leaving.has(m.householdId) && m.status === "active").map((m) => m.id);

  if (reading.ignoredColumns.length > 0) notices.push(`The file has columns this tool does not use, and they are ignored: ${reading.ignoredColumns.map((c) => `"${c}"`).join(", ")}.`);
  if (reading.rows.length > 0 && !reading.hasNames) {
    notices.push("The file has no Household name column, so the QuickBooks IDs cannot be double-checked against names. Adding one is the best protection against ending the wrong household.");
  }
  const active = state.households.filter((h) => h.status === "active").length;
  if (toEnd.length > 0 && toEnd.length * 100 >= rules.defaults.warnPercentOfActive * active) {
    notices.push(`This would end ${toEnd.length} of the club's ${active} active households (${Math.round((toEnd.length * 100) / active)}%). If you meant to upload the whole roster, stop here and check the file.`);
  }
  if (toEnd.length > 0) {
    notices.push(
      `The file's dates are not used: these households end today, ${formatDay(endsOn)}. Dues are billed for each month in which a household was a member on the 1st, so no dues are billed from ${monthLabel(nextMonth(monthOf(endsOn)))} on. Months already started are billed as usual when they are closed, along with any bar, snack bar, visitor and event charges not yet billed.`,
    );
  }

  // The file reader's mistakes and the read-back's are listed together in the order a spreadsheet shows them: by row, then anything about the file as a whole.
  const rowOf = (problem: string) => Number(/^Row (\d+):/.exec(problem)?.[1] ?? Infinity);
  problems.sort((a, b) => (rowOf(a) === rowOf(b) ? 0 : rowOf(a) < rowOf(b) ? -1 : 1));

  return {
    problems,
    notices,
    ignoredColumns: reading.ignoredColumns,
    rowCount: reading.rowCount,
    endsOn,
    toEnd,
    adultsToBlock: memberIds.length,
    preview: departurePreview(state, memberIds, now),
    alreadyEnded,
    fingerprint: fingerprintOf(text),
  };
}

/** What a file would do, without doing it. */
export function planResignations(state: ClubState, text: string, now: Date, rules: ResignationRules = RESIGNATION_RULES): ResignationPlan {
  return compute(state, text, now, rules);
}

export interface ResignationResult {
  ended: number;
  adults: number;
  cancelledBookings: number;
  cancelledSignUps: number;
  cancelledRsvps: number;
  alreadyEnded: number;
}

/**
 * Ends every household the file names, in one all-or-nothing change. Staff only. The file is checked again inside the change,
 * so a file with a problem, or one that no longer matches what was previewed (`expect`), ends nothing.
 */
export async function runResignations(
  store: ClubStore,
  ledger: BookingLedger,
  ctx: Ctx,
  text: string,
  expect?: { fingerprint: string; households: number; adults: number },
  rules: ResignationRules = RESIGNATION_RULES,
): Promise<ResignationResult> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can end memberships.");
  return store.transaction(async (s, newId) => {
    const plan = compute(s, text, ctx.now, rules);
    if (plan.problems.length > 0) throw new ClubError("invalid", `The file has ${plan.problems.length} problem${plan.problems.length === 1 ? "" : "s"}, so nothing was ended. Fix the file and check it again.`);
    if (plan.toEnd.length === 0) {
      throw new ClubError("conflict", plan.alreadyEnded.length > 0 ? "Every household in the file has already ended, so there is nothing to do." : "The file has no households to end.");
    }
    if (expect && (expect.fingerprint !== plan.fingerprint || expect.households !== plan.toEnd.length || expect.adults !== plan.adultsToBlock)) {
      throw new ClubError("conflict", "The file, or the club's records, changed since you checked it, so nothing was ended. Check the file again.");
    }
    const result: ResignationResult = { ended: 0, adults: 0, cancelledBookings: 0, cancelledSignUps: 0, cancelledRsvps: 0, alreadyEnded: plan.alreadyEnded.length };
    for (const h of plan.toEnd) {
      const done = await endHouseholdRecords(s, newId, ctx, ledger, h.householdId, { source: "a resignations file", note: h.note || undefined });
      result.ended += 1;
      result.adults += done.blocked.length;
      result.cancelledBookings += done.cancelledBookings.length;
      result.cancelledSignUps += done.cancelledSignUps.length;
      result.cancelledRsvps += done.cancelledRsvps.length;
    }
    return result;
  });
}
