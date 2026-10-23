import { ClubError } from "../errors";
import { MEMBERSHIP_TYPES, type MembershipType } from "../types";
import { parseCsv } from "./csv";
import { isRealDay, memberFieldsProblem } from "./households";

/**
 * The roster file staff upload on move-in day: one row per adult, with the household's QuickBooks ID, name, membership type
 * and join date repeated on every row for that household. This reads it and says, in plain words and with row numbers
 * as a spreadsheet shows them (the header is row 1), everything that is wrong, without changing anything.
 */

export const MAX_ROSTER_BYTES = 500_000;
export const MAX_ROSTER_ROWS = 3000;

/** The columns, as the template names them. Phone and Role may be left out; the rest are required. */
export const ROSTER_COLUMNS = ["QuickBooks ID", "Household name", "Membership type", "Joined", "First name", "Last name", "Email", "Phone", "Role"] as const;

type Field = "quickbooksId" | "householdName" | "membershipType" | "joined" | "firstName" | "lastName" | "email" | "phone" | "role";
const REQUIRED: Field[] = ["quickbooksId", "householdName", "membershipType", "joined", "firstName", "lastName", "email"];
const LABEL: Record<Field, string> = {
  quickbooksId: "QuickBooks ID",
  householdName: "Household name",
  membershipType: "Membership type",
  joined: "Joined",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  role: "Role",
};
/** Header names as people write them, with spaces, capitals and punctuation ignored. */
const ALIASES: Record<Field, string[]> = {
  quickbooksId: ["quickbooksid", "quickbookscustomerid", "qbid", "qboid"],
  householdName: ["householdname", "household", "customer", "customername"],
  membershipType: ["membershiptype", "membership", "type"],
  joined: ["joined", "joineddate", "joinedon", "datejoined", "membersince"],
  firstName: ["firstname", "first"],
  lastName: ["lastname", "last", "surname"],
  email: ["email", "emailaddress"],
  phone: ["phone", "phonenumber", "mobile"],
  role: ["role", "adultrole"],
};

/** The two example households in the template. They are refused if they are uploaded, so nobody adds them by accident. */
export const TEMPLATE_EXAMPLE_IDS = ["EXAMPLE-1", "EXAMPLE-2"] as const;

export const ROSTER_TEMPLATE =
  [
    ROSTER_COLUMNS.join(","),
    "EXAMPLE-1,The Example household,Resident,2015-06-01,Pat,Example,pat.example@example.com,206-555-0100,Primary",
    "EXAMPLE-1,The Example household,Resident,2015-06-01,Sam,Example,sam.example@example.com,,Additional",
    "EXAMPLE-2,The Sample household,Intermediate,3/14/2022,Alex,Sample,alex.sample@example.com,206-555-0101,",
  ].join("\r\n") + "\r\n";

export interface RosterAdult {
  /** The row in the file, counting the header as row 1. */
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: "primary" | "additional";
}

export interface RosterHousehold {
  quickbooksId: string;
  displayName: string;
  membershipType: MembershipType;
  /** YYYY-MM-DD. */
  joinedOn: string;
  adults: RosterAdult[];
}

export interface RosterReading {
  households: RosterHousehold[];
  /** Everything wrong with the file, in the order it was found. Anything here means nothing may be imported. */
  problems: string[];
  /** Columns in the file that this import does not use (a QuickBooks export has many). */
  ignoredColumns: string[];
  /** Rows with something in them, not counting the header. */
  rowCount: number;
}

const letters = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A join date as a spreadsheet writes it: 2020-01-15 or 1/15/2020. Returns the date as YYYY-MM-DD, or why not. */
export function parseJoinDate(value: string, today: string): { iso: string } | { problem: string } {
  const typed = `"${value}"`;
  let iso: string;
  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (dashed) iso = value;
  else if (slashed) iso = `${slashed[3]}-${slashed[1].padStart(2, "0")}-${slashed[2].padStart(2, "0")}`;
  else return { problem: `${typed} is not a date. Write it like 2020-01-15 or 1/15/2020.` };
  if (!isRealDay(iso)) return { problem: `${typed} is not a real date.` };
  if (iso < "1900-01-01") return { problem: `${typed} is before 1900. Check the year.` };
  if (iso > today) return { problem: `${typed} is in the future. Check the date.` };
  return { iso };
}

function membershipTypeOf(value: string): MembershipType | null {
  const wanted = letters(value);
  return MEMBERSHIP_TYPES.find((t) => letters(t) === wanted) ?? null;
}

export function readRoster(text: string, today: string): RosterReading {
  const empty = (problem: string): RosterReading => ({ households: [], problems: [problem], ignoredColumns: [], rowCount: 0 });
  if (text.length > MAX_ROSTER_BYTES) return empty(`The file is too big: it can be up to ${MAX_ROSTER_BYTES / 1000} KB, which is about 3,000 people.`);
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
  const missing = REQUIRED.filter((f) => column[f] === undefined);
  if (missing.length > 0) {
    problems.push(
      `The file has no column for ${missing.map((f) => `"${LABEL[f]}"`).join(", ")}. It has: ${header.filter(Boolean).map((h) => `"${h}"`).join(", ") || "no column names"}. It needs: ${REQUIRED.map((f) => LABEL[f]).join(", ")} (Phone and Role are optional).`,
    );
  }
  const ignoredColumns = header.filter((h, i) => h !== "" && !used.has(i));
  if (problems.length > 0) return { households: [], problems, ignoredColumns, rowCount: 0 };

  const dataRows = table.slice(1).map((cells, i) => ({ cells, row: i + 2 })).filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (dataRows.length > MAX_ROSTER_ROWS) return { households: [], problems: [`The file has ${dataRows.length} rows. It can have up to ${MAX_ROSTER_ROWS}.`], ignoredColumns, rowCount: dataRows.length };

  const get = (cells: string[], field: Field) => (column[field] === undefined ? "" : (cells[column[field]!] ?? "").trim());
  const households = new Map<string, RosterHousehold & { roleRows: number[]; firstRow: number }>();
  for (const { cells, row } of dataRows) {
    const quickbooksId = get(cells, "quickbooksId");
    const displayName = get(cells, "householdName");
    const typeText = get(cells, "membershipType");
    const joinedText = get(cells, "joined");
    const roleText = get(cells, "role");
    const person = { firstName: get(cells, "firstName"), lastName: get(cells, "lastName"), email: get(cells, "email"), phone: get(cells, "phone") };
    const before = problems.length;
    const say = (p: string) => problems.push(`Row ${row}: ${p}`);

    if (quickbooksId === "") say("QuickBooks ID is empty. Every row needs the household's QuickBooks ID.");
    else if (quickbooksId.length > 100) say("QuickBooks ID is longer than 100 characters.");
    else if ((TEMPLATE_EXAMPLE_IDS as readonly string[]).includes(quickbooksId.toUpperCase())) say(`"${quickbooksId}" is one of the template's example rows. Delete the example rows before uploading.`);
    if (displayName === "") say("Household name is empty.");
    else if (displayName.length > 120) say("Household name is longer than 120 characters.");
    const type = typeText === "" ? null : membershipTypeOf(typeText);
    if (typeText === "") say("Membership type is empty. Write Resident, Intermediate or Non-Resident.");
    else if (!type) say(`Membership type "${typeText}" is not Resident, Intermediate or Non-Resident.`);
    let joinedOn = "";
    if (joinedText === "") say("Joined is empty. Every household needs the date it joined.");
    else {
      const parsed = parseJoinDate(joinedText, today);
      if ("problem" in parsed) say(`Joined ${parsed.problem}`);
      else joinedOn = parsed.iso;
    }
    const personProblem = memberFieldsProblem(person);
    if (personProblem) say(personProblem);
    let role: "primary" | "additional" | null = null;
    if (roleText !== "") {
      const r = letters(roleText);
      if (r === "primary") role = "primary";
      else if (r === "additional") role = "additional";
      else say(`Role "${roleText}" is not Primary or Additional. Leave it blank if you are not sure.`);
    }
    if (problems.length > before) continue;

    const existing = households.get(quickbooksId);
    if (!existing) {
      households.set(quickbooksId, { quickbooksId, displayName, membershipType: type!, joinedOn, adults: [], roleRows: [], firstRow: row });
    } else {
      const disagree = (what: string, a: string, b: string) => problems.push(`Rows ${existing.firstRow} and ${row} are both QuickBooks ID ${quickbooksId} but give a different ${what} ("${a}" and "${b}"). A household must be the same on every row.`);
      if (existing.displayName !== displayName) disagree("household name", existing.displayName, displayName);
      if (existing.membershipType !== type) disagree("membership type", existing.membershipType, type!);
      if (existing.joinedOn !== joinedOn) disagree("join date", existing.joinedOn, joinedOn);
    }
    const household = households.get(quickbooksId)!;
    const twin = household.adults.find((a) => a.firstName.toLowerCase() === person.firstName.toLowerCase() && a.lastName.toLowerCase() === person.lastName.toLowerCase() && a.email.toLowerCase() === person.email.toLowerCase());
    if (twin) {
      say(`${person.firstName} ${person.lastName} is already listed for this household on row ${twin.row}.`);
      continue;
    }
    if (role === "primary") household.roleRows.push(row);
    household.adults.push({ row, ...person, role: role === "primary" ? "primary" : "additional" });
  }

  const result: RosterHousehold[] = [];
  for (const h of households.values()) {
    if (h.roleRows.length > 1) {
      problems.push(`Rows ${h.roleRows.join(" and ")} are all marked Primary for QuickBooks ID ${h.quickbooksId}. A household has one primary adult.`);
      continue;
    }
    // With no one marked Primary, the first adult listed is the primary.
    if (h.roleRows.length === 0) h.adults[0].role = "primary";
    else for (const a of h.adults) a.role = a.row === h.roleRows[0] ? "primary" : "additional";
    // The primary adult comes first, as the engine expects.
    h.adults.sort((a, b) => (a.role === b.role ? a.row - b.row : a.role === "primary" ? -1 : 1));
    result.push({ quickbooksId: h.quickbooksId, displayName: h.displayName, membershipType: h.membershipType, joinedOn: h.joinedOn, adults: h.adults });
  }
  return { households: result, problems, ignoredColumns, rowCount: dataRows.length };
}
