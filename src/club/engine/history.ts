import { createHash } from "node:crypto";
import { ClubError } from "../errors";
import { pacificDate } from "../time";
import type { Member } from "../types";
import type { HistoryStore, LegacyReservation, NameSummary, NewReservation, PersonRole } from "../store/history";
import type { Ctx } from "./households";
import { readIcrew, type IcrewRow } from "./icrew";
import { keyOwners, memberNameKey, searchPrefix } from "./people-names";

/**
 * Moving the old filing cabinet in: the bookings iCrew kept. Two steps, like the roster import: `planHistoryImport` says
 * exactly what a file would do and changes nothing; `runHistoryImport` does it, all or nothing. It only ever adds, a booking
 * already stored is skipped, and nothing here can reach today's calendar, check-in record or billing.
 */

export const fingerprintOf = (text: string) => createHash("sha256").update(text).digest("hex");

export interface HistoryPlan {
  /** Everything wrong with the file. Anything here means nothing can be added until the file is fixed. */
  problems: string[];
  /** Things worth a look that do not stop the import. */
  notices: string[];
  /** Rows in the file with something in them. */
  rowsInFile: number;
  /** Rows that would be added, and rows already stored. */
  toAdd: number;
  alreadyStored: number;
  futureRows: number;
  repeatedInFile: number;
  /** The days the new rows cover. */
  firstDay: string | null;
  lastDay: string | null;
  byType: { itemType: string; rows: number }[];
  /** The different people named on the new rows, by how well they match the club's members. */
  names: { total: number; matchedOne: number; matchedMany: number; matchedNone: number };
  /** The names on the new rows that match no member, most bookings first (the first few only). */
  unmatched: { name: string; rows: number }[];
  /** A fingerprint of the exact file, so the confirm step can tell it is the file that was checked. */
  fingerprint: string;
}

async function compute(history: HistoryStore, members: Pick<Member, "id" | "firstName" | "lastName">[], text: string, today: string): Promise<{ plan: HistoryPlan; fresh: IcrewRow[]; reading: ReturnType<typeof readIcrew> }> {
  const reading = readIcrew(text, today);
  const plan: HistoryPlan = {
    problems: reading.problems,
    notices: [...reading.notices],
    rowsInFile: reading.rowCount,
    toAdd: 0,
    alreadyStored: 0,
    futureRows: reading.futureRows,
    repeatedInFile: reading.repeatedInFile,
    firstDay: null,
    lastDay: null,
    byType: [],
    names: { total: 0, matchedOne: 0, matchedMany: 0, matchedNone: 0 },
    unmatched: [],
    fingerprint: fingerprintOf(text),
  };
  if (reading.problems.length > 0) return { plan, fresh: [], reading };

  const have = await history.existingKeys(reading.rows.map((r) => r.key));
  const fresh = reading.rows.filter((r) => !have.has(r.key));
  plan.alreadyStored = reading.rows.length - fresh.length;
  plan.toAdd = fresh.length;
  for (const r of fresh) {
    if (plan.firstDay === null || r.day < plan.firstDay) plan.firstDay = r.day;
    if (plan.lastDay === null || r.day > plan.lastDay) plan.lastDay = r.day;
  }
  const types = new Map<string, number>();
  for (const r of fresh) types.set(r.itemType, (types.get(r.itemType) ?? 0) + 1);
  plan.byType = [...types.entries()].map(([itemType, rows]) => ({ itemType, rows })).sort((a, b) => b.rows - a.rows || (a.itemType < b.itemType ? -1 : 1));

  const owners = keyOwners(members);
  const seen = new Map<string, { name: string; rows: Set<number> }>();
  for (const r of fresh) {
    for (const p of r.people) {
      const entry = seen.get(p.key) ?? { name: p.name, rows: new Set<number>() };
      entry.rows.add(r.row);
      seen.set(p.key, entry);
    }
  }
  const none: { name: string; rows: number }[] = [];
  for (const [key, v] of seen) {
    const count = owners.get(key)?.length ?? 0;
    plan.names.total += 1;
    if (count === 1) plan.names.matchedOne += 1;
    else if (count > 1) plan.names.matchedMany += 1;
    else {
      plan.names.matchedNone += 1;
      none.push({ name: v.name, rows: v.rows.size });
    }
  }
  plan.unmatched = none.sort((a, b) => b.rows - a.rows || (a.name < b.name ? -1 : 1)).slice(0, 20);
  if (plan.names.matchedNone > 0) {
    plan.notices.push(`${plan.names.matchedNone} name${plan.names.matchedNone === 1 ? " matches" : "s match"} no member of the club. Those bookings are still kept, with the name as written, and staff can see them under "Names that match no member".`);
  }
  if (plan.names.matchedMany > 0) {
    plan.notices.push(`${plan.names.matchedMany} name${plan.names.matchedMany === 1 ? " matches" : "s match"} more than one member, so ${plan.names.matchedMany === 1 ? "it is" : "they are"} not shown to any of them. Staff can still find those bookings by name.`);
  }
  if (fresh.length === 0 && plan.problems.length === 0) plan.notices.push(reading.rows.length === 0 ? "The file has no past bookings to add." : "Every booking in the file is already stored.");
  return { plan, fresh, reading };
}

/** What a file would do, without doing it. */
export async function planHistoryImport(history: HistoryStore, members: Pick<Member, "id" | "firstName" | "lastName">[], text: string, now: Date): Promise<HistoryPlan> {
  return (await compute(history, members, text, pacificDate(now))).plan;
}

export interface HistoryImportResult {
  added: number;
  skipped: number;
}

const toNew = (r: IcrewRow): NewReservation => ({
  key: r.key,
  sourceId: r.sourceId,
  day: r.day,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  bookedAt: r.bookedAt,
  itemType: r.itemType,
  itemName: r.itemName,
  oars: r.oars,
  bookedBy: r.bookedBy,
  rowers: r.rowers,
  outText: r.outText,
  inText: r.inText,
  people: r.people.map((p) => ({ name: p.name, key: p.key, role: p.role })),
});

/**
 * Adds every booking in the file that is not already stored, in one all-or-nothing change. Staff only. The file is read again
 * here, so a file with a problem, or one that no longer matches what was previewed (`expect`), adds nothing.
 */
export async function runHistoryImport(history: HistoryStore, ctx: Ctx, input: { fileName: string; text: string }, expect?: { fingerprint: string; toAdd: number }): Promise<HistoryImportResult> {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", "Only club staff can import old bookings.");
  const reading = readIcrew(input.text, pacificDate(ctx.now));
  if (reading.problems.length > 0) throw new ClubError("invalid", `The file has ${reading.problems.length} problem${reading.problems.length === 1 ? "" : "s"}, so nothing was added. Fix the file and check it again.`);
  if (expect && expect.fingerprint !== fingerprintOf(input.text)) throw new ClubError("conflict", "That is not the file you checked, so nothing was added. Check the file again.");
  if (reading.rows.length === 0) throw new ClubError("conflict", "The file has no past bookings to add.");
  return history.add(
    { fileName: input.fileName.slice(0, 200) || "history.csv", fingerprint: fingerprintOf(input.text), by: ctx.actor.label, at: ctx.now, rowsInFile: reading.rowCount, rows: reading.rows.map(toNew) },
    expect ? expect.toAdd : null,
  );
}

/* ---------- Looking things up ---------- */

export const HISTORY_PAGE_SIZE = 50;

export interface MemberHistoryItem {
  id: string;
  day: string;
  startsAt: string;
  endsAt: string;
  itemType: string;
  itemName: string;
  /** What the member was on this booking, in words. */
  role: string;
  /** How many other people were named on it. Their names are never shown to a member. */
  others: number;
}

export interface MemberHistoryPage {
  /** False when a member's name cannot be told apart from another member's, so nothing is shown rather than the wrong person's bookings. */
  findable: boolean;
  total: number;
  page: number;
  pages: number;
  items: MemberHistoryItem[];
}

const roleWords = (itemType: string, roles: PersonRole[]): string => {
  if (itemType === "Event") return "You signed up";
  if (roles.includes("booker") && roles.includes("rower")) return "You reserved it and were in the boat";
  if (roles.includes("rower")) return "You were in the boat";
  return "You reserved it";
};

/** One member's own old bookings, newest first. Matched by name at the time of asking, and only when no other member has the same name. */
export async function memberHistory(history: HistoryStore, members: Pick<Member, "id" | "firstName" | "lastName">[], memberId: string, page = 1): Promise<MemberHistoryPage> {
  const me = members.find((m) => m.id === memberId);
  const empty: MemberHistoryPage = { findable: true, total: 0, page: 1, pages: 1, items: [] };
  if (!me) return empty;
  const key = memberNameKey(me.firstName, me.lastName);
  const owners = keyOwners(members).get(key) ?? [];
  if (key === "" || owners.length !== 1) return { ...empty, findable: false };
  let current = Math.max(1, Math.floor(page) || 1);
  let found = await history.forName(key, HISTORY_PAGE_SIZE, (current - 1) * HISTORY_PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(found.total / HISTORY_PAGE_SIZE));
  if (current > pages) {
    current = pages;
    found = await history.forName(key, HISTORY_PAGE_SIZE, (current - 1) * HISTORY_PAGE_SIZE);
  }
  return {
    findable: true,
    total: found.total,
    page: current,
    pages,
    items: found.items.map((i) => ({
      id: i.reservation.id,
      day: i.reservation.day,
      startsAt: i.reservation.startsAt,
      endsAt: i.reservation.endsAt,
      itemType: i.reservation.itemType,
      itemName: i.reservation.itemName,
      role: roleWords(i.reservation.itemType, i.roles),
      others: i.others,
    })),
  };
}

export interface FoundForStaff {
  reservation: LegacyReservation;
  people: { name: string; role: PersonRole; matches: "one" | "many" | "none" }[];
}

export const STAFF_SEARCH_LIMIT = 100;
export const MIN_SEARCH_LETTERS = 3;

/** Staff search by name: bookings naming anyone whose name starts with what was typed, with who each name matches. */
export async function searchHistory(history: HistoryStore, members: Pick<Member, "id" | "firstName" | "lastName">[], typed: string): Promise<{ tooShort: boolean; found: FoundForStaff[] }> {
  const prefix = searchPrefix(typed);
  if (prefix.replace(/[^a-z0-9]/g, "").length < MIN_SEARCH_LETTERS) return { tooShort: typed.trim() !== "", found: [] };
  const owners = keyOwners(members);
  const found = await history.search(prefix, STAFF_SEARCH_LIMIT);
  return {
    tooShort: false,
    found: found.map((f) => ({
      reservation: f.reservation,
      people: f.people.map((p) => {
        const n = owners.get(p.key)?.length ?? 0;
        return { name: p.name, role: p.role, matches: n === 1 ? "one" : n > 1 ? "many" : "none" };
      }),
    })),
  };
}

export interface NameReport {
  total: number;
  matchedOne: number;
  /** Names on no member's record, most bookings first. */
  none: NameSummary[];
  /** Names that two or more members share. */
  many: (NameSummary & { members: number })[];
}

/** Every name in the archive sorted into: one member, more than one member, or none. */
export async function nameReport(history: HistoryStore, members: Pick<Member, "id" | "firstName" | "lastName">[]): Promise<NameReport> {
  const owners = keyOwners(members);
  const report: NameReport = { total: 0, matchedOne: 0, none: [], many: [] };
  for (const n of await history.names()) {
    report.total += 1;
    const count = owners.get(n.key)?.length ?? 0;
    if (count === 1) report.matchedOne += 1;
    else if (count > 1) report.many.push({ ...n, members: count });
    else report.none.push(n);
  }
  return report;
}
