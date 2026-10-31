import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { formatDay, pacificDate } from "../time";
import {
  DAMAGE_PRIORITIES,
  OPEN_DAMAGE,
  type ClubState,
  type DamageLogEntry,
  type DamageLogKind,
  type DamagePriority,
  type DamageReport,
  type DamageRules,
  type DamageStatus,
  type Item,
  type OutOfServicePeriod,
} from "../types";
import { itemVisibleTo } from "./boat-access";
import { addOutOfService, endOutOfService, outOfServiceAt, type AffectedBooking } from "./bookings";
import { blockReasonFor } from "./eligibility";
import type { Ctx } from "./households";

/**
 * Damage reports.
 *
 * The building comparison: the maintenance request box. Anyone with a key can drop a request in (what is wrong, where, how it
 * happened, whether it is serious); the office triages it (how urgent, who is on it), can shut the unit down until it is fixed,
 * and closes it with what was done and what it cost. What the tenant wrote is never rewritten, and every step is a line in the
 * request's own log.
 *
 * Who: any signed-in member (for a boat they are allowed to see) or club staff can file a report; staff do everything else; the
 * person who filed a report can add notes to it while it is open. A major report does not take the boat out of service by itself:
 * staff press a button on it, so one mistaken click cannot lock a boat.
 *
 * What members see: the "what is wrong" and "where" text of every open report on a boat, never who filed it and never how it
 * happened. Staff see all of it.
 */

/* ---------- Words ---------- */

export const STATUS_WORDS: Record<DamageStatus, string> = {
  open: "Open",
  in_progress: "Being fixed",
  repaired: "Repaired",
  dismissed: "Dismissed",
};

export const PRIORITY_WORDS: Record<DamagePriority, string> = { 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "1 hour", "1 hour 30 minutes", "45 minutes". */
export function repairTimeWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? plural(h, "hour") : "", m > 0 || h === 0 ? plural(m, "minute") : ""].filter(Boolean).join(" ");
}

/* ---------- Cleaning what people type ---------- */

/** One line: control characters and runs of spaces become a single space. */
export const oneLine = (v: unknown): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "");
/** Several lines allowed: line breaks stay, other control characters go. */
export const manyLines = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "";

interface TextOptions {
  /** The sentence to show when it is left empty. Without it, empty is fine. */
  needed?: string;
  multiline?: boolean;
}

function clean(value: unknown, label: string, max: number, options: TextOptions = {}): string {
  const text = options.multiline ? manyLines(value) : oneLine(value);
  if (text === "" && options.needed) throw new ClubError("invalid", options.needed);
  if (text.length > max) throw new ClubError("invalid", `${label} must be ${max} characters or fewer. It is ${text.length}.`);
  return text;
}

export const shorten = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);

/* ---------- Helpers ---------- */

function itemOf(state: ClubState, id: string): Item {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new ClubError("not_found", "That boat or space no longer exists.");
  return item;
}

function reportOf(state: ClubState, id: string): DamageReport {
  const report = state.damageReports.find((r) => r.id === id);
  if (!report) throw new ClubError("not_found", "That damage report no longer exists.");
  return report;
}

const isOpen = (r: DamageReport) => OPEN_DAMAGE.includes(r.status);

function mustBeOpen(report: DamageReport): void {
  if (!isOpen(report)) throw new ClubError("conflict", `That report is already ${STATUS_WORDS[report.status].toLowerCase()}, so it cannot change. If the damage is back, file a new report.`);
}

function staffOnly(ctx: Ctx, what: string): void {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", `Only club staff can ${what}.`);
}

function logLine(newId: () => string, ctx: Ctx, reportId: string, kind: DamageLogKind, text: string): DamageLogEntry {
  return { id: newId(), reportId, at: ctx.now.toISOString(), kind, by: ctx.actor, text };
}

/* ---------- Filing a report ---------- */

export interface DamageInput {
  itemId: string;
  /** What is wrong. */
  description: string;
  /** Where on the boat. Optional. */
  location?: string;
  /** How it happened. Optional; staff only see it. */
  howItHappened?: string;
  /** The filer's judgement: the item should not be used until someone has looked. */
  major: boolean;
}

/**
 * Anyone signed in files a report: a member who is still on the club's books, for a boat they are allowed to see, or staff for any.
 * A member is limited to a handful of reports in 24 hours so the box cannot be flooded; staff are not.
 */
export async function fileDamageReport(store: ClubStore, ctx: Ctx, rules: DamageRules, input: DamageInput): Promise<DamageReport> {
  const r = rules.defaults;
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only signed-in members and club staff can report damage.");
  const description = clean(input.description, "What is wrong", r.descriptionMax, { needed: "Say what is wrong with it." });
  const location = clean(input.location ?? "", "Where on the boat", r.locationMax);
  const howItHappened = clean(input.howItHappened ?? "", "How it happened", r.howMax, { multiline: true });
  if (typeof input.major !== "boolean") throw new ClubError("invalid", "Say whether the damage is major or minor.");
  return store.transaction(async (s, newId) => {
    const item = itemOf(s, input.itemId);
    if (ctx.actor.kind === "member") {
      const memberId = ctx.actor.memberId;
      const blocked = blockReasonFor(s, memberId, "they can no longer report damage");
      if (blocked) throw new ClubError("forbidden", blocked);
      // A boat a member is not allowed to see is not theirs to report on; it looks like a boat that does not exist.
      if (!itemVisibleTo(s, item, { kind: "member", memberId })) throw new ClubError("not_found", "That boat or space no longer exists.");
      if (r.filedPerMemberPerDay > 0) {
        const since = ctx.now.getTime() - 86400000;
        const filed = s.damageReports.filter((x) => x.reportedBy.kind === "member" && x.reportedBy.memberId === memberId && Date.parse(x.reportedAt) > since).length;
        if (filed >= r.filedPerMemberPerDay) {
          throw new ClubError("refused", `You have already filed ${plural(filed, "report")} in the last 24 hours, which is the most we take from one person. If something else is broken, please tell club staff.`);
        }
      }
    }
    const now = ctx.now.toISOString();
    const report: DamageReport = {
      id: newId(),
      itemId: item.id,
      reportedBy: ctx.actor,
      reportedAt: now,
      description,
      location,
      howItHappened,
      major: input.major,
      priority: (input.major ? r.majorPriority : r.minorPriority) as DamagePriority,
      status: "open",
      updatedAt: now,
      assignedTo: null,
      closedAt: null,
      repairedOn: null,
      repairedBy: null,
      repairMinutes: null,
      costCents: null,
      repairNotes: null,
      dismissedReason: null,
    };
    s.damageReports.push(report);
    s.damageLog.push(logLine(newId, ctx, report.id, "filed", `Reported by ${ctx.actor.label} as ${input.major ? "major" : "minor"} damage.`));
    return structuredClone(report);
  });
}

/* ---------- Notes ---------- */

/** A note on a report. Staff can add one any time; the person who filed it can add one while it is still open. */
export async function addDamageNote(store: ClubStore, ctx: Ctx, rules: DamageRules, input: { reportId: string; text: string }): Promise<DamageLogEntry> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only club staff, or the person who filed the report, can add a note.");
  const text = clean(input.text, "A note", rules.defaults.noteMax, { needed: "Write the note first.", multiline: true });
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    if (ctx.actor.kind === "member") {
      const memberId = ctx.actor.memberId;
      // Anyone but the filer is told the report does not exist: its words are for staff and the person who wrote it.
      if (report.reportedBy.kind !== "member" || report.reportedBy.memberId !== memberId) throw new ClubError("not_found", "That damage report no longer exists.");
      const blocked = blockReasonFor(s, memberId, "they can no longer add notes");
      if (blocked) throw new ClubError("forbidden", blocked);
      mustBeOpen(report);
    }
    const line = logLine(newId, ctx, report.id, "note", text);
    s.damageLog.push(line);
    return structuredClone(line);
  });
}

/* ---------- Triage (staff) ---------- */

/** Staff say who is fixing it. An empty name clears it. */
export async function assignDamageReport(store: ClubStore, ctx: Ctx, rules: DamageRules, input: { reportId: string; assignedTo: string }): Promise<DamageReport> {
  staffOnly(ctx, "assign damage reports");
  const who = clean(input.assignedTo, "Who is fixing it", rules.defaults.assignedToMax);
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    if ((report.assignedTo ?? "") === who) throw new ClubError("unchanged", who === "" ? "Nobody is assigned to this report." : `${who} is already assigned to this report.`);
    const was = report.assignedTo;
    report.assignedTo = who === "" ? null : who;
    report.updatedAt = ctx.now.toISOString();
    s.damageLog.push(logLine(newId, ctx, report.id, "assigned", who === "" ? `No longer assigned to ${was}.` : was ? `Assigned to ${who} (was ${was}).` : `Assigned to ${who}.`));
    return structuredClone(report);
  });
}

/** Staff change how urgent the report is: 1 is the most urgent, 4 the least. */
export async function setDamagePriority(store: ClubStore, ctx: Ctx, input: { reportId: string; priority: number }): Promise<DamageReport> {
  staffOnly(ctx, "change a report's priority");
  const priority = input.priority as DamagePriority;
  if (!Number.isInteger(input.priority) || !DAMAGE_PRIORITIES.includes(priority)) throw new ClubError("invalid", "Priority is a number from 1 (most urgent) to 4 (least urgent).");
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    if (report.priority === priority) throw new ClubError("unchanged", `This report is already priority ${priority} (${PRIORITY_WORDS[priority].toLowerCase()}).`);
    const was = report.priority;
    report.priority = priority;
    report.updatedAt = ctx.now.toISOString();
    s.damageLog.push(logLine(newId, ctx, report.id, "priority_changed", `Priority changed from ${was} (${PRIORITY_WORDS[was].toLowerCase()}) to ${priority} (${PRIORITY_WORDS[priority].toLowerCase()}).`));
    return structuredClone(report);
  });
}

/** Staff say work has started. Open to being fixed. */
export async function startDamageRepair(store: ClubStore, ctx: Ctx, input: { reportId: string }): Promise<DamageReport> {
  staffOnly(ctx, "start work on a damage report");
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    if (report.status === "in_progress") throw new ClubError("unchanged", "Work on this report has already started.");
    report.status = "in_progress";
    report.updatedAt = ctx.now.toISOString();
    s.damageLog.push(logLine(newId, ctx, report.id, "started", `Work started by ${ctx.actor.label}.`));
    return structuredClone(report);
  });
}

/* ---------- Out of service ---------- */

export interface TakenOutOfService {
  period: OutOfServicePeriod;
  /** Upcoming bookings on the item, so staff can contact the people. Nothing is cancelled. */
  affected: AffectedBooking[];
}

/**
 * Staff take the item out of service because of this report. It is the same step as the Equipment page's, with the reason filled in
 * from the report, and it is written on the report's log in the same all-or-nothing change.
 */
export async function takeOutOfServiceForReport(store: ClubStore, ctx: Ctx, input: { reportId: string; expectedReturn?: string | null }): Promise<TakenOutOfService> {
  staffOnly(ctx, "take something out of service");
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    const item = itemOf(s, report.itemId);
    const already = outOfServiceAt(s, item.id, ctx.now);
    if (already) throw new ClubError("conflict", `${item.name} is already out of service: ${already.reason}`);
    const done = addOutOfService(s, newId, ctx, item.id, { reason: shorten(`Damage reported: ${report.description}`, 200), expectedReturn: input.expectedReturn ?? null });
    const bookings = done.affected.length;
    s.damageLog.push(
      logLine(newId, ctx, report.id, "taken_out_of_service", `${item.name} taken out of service by ${ctx.actor.label}. ${bookings === 0 ? "Nobody has it booked." : `${plural(bookings, "upcoming booking")} stay${bookings === 1 ? "s" : ""}; staff have the list to contact the people.`}`),
    );
    return done;
  });
}

/* ---------- Closing a report ---------- */

export interface RepairInput {
  reportId: string;
  /** YYYY-MM-DD, Pacific. */
  repairedOn: string;
  repairedBy: string;
  /** Time spent, in minutes. Optional. */
  repairMinutes?: number | null;
  /** Cost in cents. Optional. */
  costCents?: number | null;
  notes?: string;
  /** Also bring the item back into service, if it is out of service now. */
  returnToService?: boolean;
}

export interface Repaired {
  report: DamageReport;
  /** True when the item was out of service and was returned to service with this repair. */
  returned: boolean;
  /** Other open reports on the same item that the filer called major, so staff know the item may still need a look. */
  otherOpenMajor: number;
}

const MAX_REPAIR_MINUTES = 60000;
const MAX_COST_CENTS = 10_000_000;

function realDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/** Staff close a report as repaired: when, by whom, how long it took, what it cost, and notes. */
export async function markDamageRepaired(store: ClubStore, ctx: Ctx, rules: DamageRules, input: RepairInput): Promise<Repaired> {
  staffOnly(ctx, "close a damage report");
  const r = rules.defaults;
  const repairedBy = clean(input.repairedBy, "Repaired by", r.repairedByMax, { needed: "Say who did the repair." });
  const notes = clean(input.notes ?? "", "The repair notes", r.repairNotesMax, { multiline: true });
  const minutes = input.repairMinutes ?? null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_REPAIR_MINUTES)) throw new ClubError("invalid", `Time spent must be between 0 and ${MAX_REPAIR_MINUTES / 60} hours.`);
  const cost = input.costCents ?? null;
  if (cost !== null && (!Number.isInteger(cost) || cost < 0 || cost > MAX_COST_CENTS)) throw new ClubError("invalid", `The cost must be between $0 and ${money(MAX_COST_CENTS)}.`);
  if (!realDay(input.repairedOn)) throw new ClubError("invalid", "The repair date is not a real date. Use a day like 2026-11-05.");
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    const item = itemOf(s, report.itemId);
    const today = pacificDate(ctx.now);
    if (input.repairedOn > today) throw new ClubError("invalid", "The repair date cannot be in the future.");
    const filedOn = pacificDate(new Date(report.reportedAt));
    if (input.repairedOn < filedOn) throw new ClubError("invalid", `The repair date cannot be before the report was filed on ${formatDay(filedOn)}.`);
    const now = ctx.now.toISOString();
    report.status = "repaired";
    report.updatedAt = now;
    report.closedAt = now;
    report.repairedOn = input.repairedOn;
    report.repairedBy = repairedBy;
    report.repairMinutes = minutes;
    report.costCents = cost;
    report.repairNotes = notes === "" ? null : notes;
    const bits = [minutes !== null ? `${repairTimeWords(minutes)} spent` : "", cost !== null ? `cost ${money(cost)}` : ""].filter(Boolean);
    s.damageLog.push(logLine(newId, ctx, report.id, "repaired", `Repaired on ${formatDay(input.repairedOn)} by ${repairedBy}${bits.length > 0 ? `; ${bits.join(", ")}` : ""}. Closed by ${ctx.actor.label}.`));
    let returned = false;
    if (input.returnToService) {
      const period = outOfServiceAt(s, item.id, ctx.now);
      if (period) {
        endOutOfService(s, ctx, period.id);
        s.damageLog.push(logLine(newId, ctx, report.id, "returned_to_service", `${item.name} returned to service by ${ctx.actor.label}.`));
        returned = true;
      }
    }
    // This report is already repaired here, so it cannot count itself.
    const otherOpenMajor = s.damageReports.filter((x) => x.itemId === report.itemId && isOpen(x) && x.major).length;
    return { report: structuredClone(report), returned, otherOpenMajor };
  });
}

/** Staff close a report without a repair (a duplicate, or nothing was wrong), with the reason. */
export async function dismissDamageReport(store: ClubStore, ctx: Ctx, rules: DamageRules, input: { reportId: string; reason: string }): Promise<DamageReport> {
  staffOnly(ctx, "dismiss a damage report");
  const reason = clean(input.reason, "The reason", rules.defaults.dismissReasonMax, { needed: "Say why the report is being dismissed." });
  return store.transaction(async (s, newId) => {
    const report = reportOf(s, input.reportId);
    mustBeOpen(report);
    const now = ctx.now.toISOString();
    report.status = "dismissed";
    report.updatedAt = now;
    report.closedAt = now;
    report.dismissedReason = reason;
    s.damageLog.push(logLine(newId, ctx, report.id, "dismissed", `Dismissed by ${ctx.actor.label}: ${reason}`));
    return structuredClone(report);
  });
}

/* ---------- What members see ---------- */

/** What anyone booking the item may read about an open report. Never who filed it, never how it happened. */
export interface DamageNotice {
  reportId: string;
  major: boolean;
  description: string;
  location: string;
  /** YYYY-MM-DD, Pacific. */
  reportedOn: string;
  beingFixed: boolean;
}

const toNotice = (r: DamageReport): DamageNotice => ({
  reportId: r.id,
  major: r.major,
  description: r.description,
  location: r.location,
  reportedOn: pacificDate(new Date(r.reportedAt)),
  beingFixed: r.status === "in_progress",
});

/**
 * What the Book page and My bookings say about an open report. A major one says to check with staff before using the item; a minor
 * one says it can still be used. It quotes what the filer wrote and never says who they are.
 */
export function noticeWords(n: DamageNotice): string {
  const where = n.location === "" ? "" : ` (${n.location})`;
  const fixing = n.beingFixed ? " It is being fixed." : "";
  return n.major
    ? `Major damage reported on ${formatDay(n.reportedOn)}: "${n.description}"${where}.${fixing} Check with club staff before you use it.`
    : `Minor damage reported on ${formatDay(n.reportedOn)}: "${n.description}"${where}.${fixing} You can still use it.`;
}

/** The open reports on an item, major first and then oldest first. */
export function openDamageNotices(state: ClubState, itemId: string): DamageNotice[] {
  return state.damageReports
    .filter((r) => r.itemId === itemId && isOpen(r))
    .sort((a, b) => Number(b.major) - Number(a.major) || a.reportedAt.localeCompare(b.reportedAt) || a.id.localeCompare(b.id))
    .map(toNotice);
}

/** For each of this person's upcoming outings (as booker or crew) on an item with open damage reports: what to know before going. */
export function bookingDamageNotices(state: ClubState, memberId: string, now: Date): Record<string, DamageNotice[]> {
  const out: Record<string, DamageNotice[]> = {};
  for (const b of state.bookings) {
    if (b.status !== "upcoming" || Date.parse(b.endsAt) <= now.getTime()) continue;
    if (b.bookerId !== memberId && !b.crew.includes(memberId)) continue;
    const notices = openDamageNotices(state, b.itemId);
    if (notices.length > 0) out[b.id] = notices;
  }
  return out;
}

export interface MyDamageLine {
  reportId: string;
  itemName: string;
  major: boolean;
  description: string;
  reportedAt: string;
  status: DamageStatus;
  statusWords: string;
  /** YYYY-MM-DD, when repaired. */
  repairedOn: string | null;
  /** Why it was dismissed, when it was. */
  dismissedReason: string | null;
  /** The notes this person added themselves, oldest first. */
  notes: { at: string; text: string }[];
}

/** The reports one member filed, newest first. What staff did with them (priority, who, cost, notes) is staff's. */
export function myDamageReports(state: ClubState, memberId: string): MyDamageLine[] {
  return state.damageReports
    .filter((r) => r.reportedBy.kind === "member" && r.reportedBy.memberId === memberId)
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.id.localeCompare(a.id))
    .map((r) => ({
      reportId: r.id,
      itemName: state.items.find((i) => i.id === r.itemId)?.name ?? "A boat or space",
      major: r.major,
      description: r.description,
      reportedAt: r.reportedAt,
      status: r.status,
      statusWords: STATUS_WORDS[r.status],
      repairedOn: r.repairedOn,
      dismissedReason: r.dismissedReason,
      notes: state.damageLog
        .filter((l) => l.reportId === r.id && l.kind === "note" && l.by.kind === "member" && l.by.memberId === memberId)
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((l) => ({ at: l.at, text: l.text })),
    }));
}

/** The boats and spaces this viewer may report on: everything for staff, and for a member every item they are allowed to see. */
export function reportableItems(state: ClubState, viewer: { kind: "staff" } | { kind: "member"; memberId: string }): { id: string; name: string }[] {
  return state.items
    .filter((i) => itemVisibleTo(state, i, viewer))
    .map((i) => ({ id: i.id, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- What staff see ---------- */

export interface DamageRow {
  reportId: string;
  itemId: string;
  itemName: string;
  description: string;
  location: string;
  major: boolean;
  priority: DamagePriority;
  status: DamageStatus;
  statusWords: string;
  reportedAt: string;
  reporter: string;
  assignedTo: string | null;
  /** Whole days the report has been open (or was open, once closed). */
  daysOpen: number;
  /** True while the item is out of service right now. */
  outOfService: boolean;
  closedAt: string | null;
}

function row(state: ClubState, r: DamageReport, now: Date): DamageRow {
  const end = r.closedAt ? Date.parse(r.closedAt) : now.getTime();
  return {
    reportId: r.id,
    itemId: r.itemId,
    itemName: state.items.find((i) => i.id === r.itemId)?.name ?? "A boat or space",
    description: r.description,
    location: r.location,
    major: r.major,
    priority: r.priority,
    status: r.status,
    statusWords: STATUS_WORDS[r.status],
    reportedAt: r.reportedAt,
    reporter: r.reportedBy.label,
    assignedTo: r.assignedTo,
    daysOpen: Math.max(0, Math.floor((end - Date.parse(r.reportedAt)) / 86400000)),
    outOfService: outOfServiceAt(state, r.itemId, now) !== undefined,
    closedAt: r.closedAt,
  };
}

/**
 * Staff's list. Open reports: major first, then the most urgent priority, then the oldest. Closed reports: the most recently closed
 * first.
 */
export function damageQueue(state: ClubState, now: Date, which: "open" | "closed"): DamageRow[] {
  const wanted = state.damageReports.filter((r) => (which === "open") === isOpen(r));
  const rows = wanted.map((r) => row(state, r, now));
  return which === "open"
    ? rows.sort((a, b) => Number(b.major) - Number(a.major) || a.priority - b.priority || a.reportedAt.localeCompare(b.reportedAt) || a.reportId.localeCompare(b.reportId))
    : rows.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.reportId.localeCompare(a.reportId));
}

export interface DamageLogLine {
  at: string;
  kind: DamageLogKind;
  by: string;
  text: string;
}

export interface DamageDetail {
  report: DamageReport;
  itemName: string;
  reporter: string;
  assignedTo: string | null;
  statusWords: string;
  priorityWords: string;
  /** Newest first. */
  log: DamageLogLine[];
  /** The out-of-service period the item is in right now, if any. */
  outOfService: OutOfServicePeriod | null;
  /** Upcoming bookings on the item. */
  upcomingBookings: number;
  /** Other open reports on the same item. */
  otherOpen: { reportId: string; description: string; major: boolean; priority: DamagePriority }[];
  /** Whether the item is private, so staff know the owners decide who uses it. */
  privateBoat: boolean;
}

export function damageDetail(state: ClubState, reportId: string, now: Date): DamageDetail | null {
  const report = state.damageReports.find((r) => r.id === reportId);
  if (!report) return null;
  const item = state.items.find((i) => i.id === report.itemId);
  return {
    report: structuredClone(report),
    itemName: item?.name ?? "A boat or space",
    reporter: report.reportedBy.label,
    assignedTo: report.assignedTo,
    statusWords: STATUS_WORDS[report.status],
    priorityWords: PRIORITY_WORDS[report.priority],
    log: state.damageLog
      .map((l, written) => ({ l, written }))
      .filter(({ l }) => l.reportId === reportId)
      .sort((a, b) => b.l.at.localeCompare(a.l.at) || b.written - a.written)
      .map(({ l }) => ({ at: l.at, kind: l.kind, by: l.by.label, text: l.text })),
    outOfService: outOfServiceAt(state, report.itemId, now) ?? null,
    upcomingBookings: state.bookings.filter((b) => b.itemId === report.itemId && b.status === "upcoming" && Date.parse(b.endsAt) > now.getTime()).length,
    otherOpen: state.damageReports
      .filter((r) => r.id !== report.id && r.itemId === report.itemId && isOpen(r))
      .sort((a, b) => a.priority - b.priority || a.reportedAt.localeCompare(b.reportedAt))
      .map((r) => ({ reportId: r.id, description: r.description, major: r.major, priority: r.priority })),
    privateBoat: item?.isPrivate === true,
  };
}

export interface OfficeDamage {
  /** Reports still to fix. */
  open: number;
  /** Of those, how many the filer called major. */
  major: number;
  /** Open major reports on an item that is not out of service: the ones staff may want to act on first. */
  majorInService: number;
  /** The most pressing few. */
  top: DamageRow[];
}

const OFFICE_TOP = 5;

/** The staff home page's damage board. */
export function officeDamage(state: ClubState, now: Date): OfficeDamage {
  const open = damageQueue(state, now, "open");
  return {
    open: open.length,
    major: open.filter((r) => r.major).length,
    majorInService: open.filter((r) => r.major && !r.outOfService).length,
    top: open.slice(0, OFFICE_TOP),
  };
}
