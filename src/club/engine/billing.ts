import { createHash } from "node:crypto";
import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { formatDay, pacificDate, pacificDayStart } from "../time";
import {
  BILLING_KINDS,
  MEMBERSHIP_TYPES,
  type Actor,
  type BillingKind,
  type BillingLine,
  type BillingRules,
  type BillingRun,
  type Charge,
  type ClubState,
  type Household,
  type MembershipType,
  type RsvpStatus,
  type VisitVia,
  type VisitorEntry,
} from "../types";
import { firstDayOf, formatMoney, isMonth, monthLabel, monthOf, nextMonth, visitorFeeCents } from "./billing-words";
import { isRealDay, type Ctx } from "./households";
import { fullName, householdOf, memberById } from "./queries";

/**
 * Charges, visitors and the monthly billing run. The building comparison: the rent ledger. Staff write bar and snack-bar
 * sales and adjustments into it, the front-desk iPad logs visitors, and once a month the office closes the month: every
 * household's statement is worked out, previewed, then frozen. A closed month is never reopened; a mistake found later is
 * put right with an adjustment dated in an open month, so nothing is ever billed twice.
 */

/** What each kind of line is called on screen. */
export const KIND_LABEL: Record<BillingKind, string> = {
  dues: "Dues",
  event_tickets: "Event tickets",
  visitor_fees: "Visitor fees",
  bar: "Bar",
  snack_bar: "Snack bar",
};

/** The kinds a plain sale (not an adjustment) can be. */
export const SALE_KINDS: readonly BillingKind[] = ["bar", "snack_bar"];

/** An RSVP is billed if it held spots when the event ended: it came, did not come, or cancelled too late. */
export const BILLABLE_RSVP: readonly RsvpStatus[] = ["going", "attended", "no_show", "late_cancelled"];

/** The most one charge can be, in cents ($100,000). The database says the same. */
export const MAX_CHARGE_CENTS = 10_000_000;

const FORBIDDEN = "Only club staff can do that.";
const EARLIEST_DAY = "2000-01-01";

function requireStaff(actor: Actor) {
  if (actor.kind !== "staff") throw new ClubError("forbidden", FORBIDDEN);
}

const invalid = (message: string) => new ClubError("invalid", message);
const conflict = (message: string) => new ClubError("conflict", message);

/** Whether a day falls in a month that was already closed. */
export const isBilledDay = (s: ClubState, day: string): boolean => s.billingRuns.some((r) => r.month === monthOf(day));

/** A day staff may put a record on: a real date, not in the future, and in a month that is still open. */
function openDay(s: ClubState, day: string, today: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRealDay(day)) throw invalid("That is not a real date.");
  if (day < EARLIEST_DAY) throw invalid("That date is too long ago.");
  if (day > today) throw invalid("That date is in the future.");
  if (isBilledDay(s, day)) throw conflict(`${monthLabel(monthOf(day))} was already billed, so nothing can be dated in it. Date it today instead, as an adjustment.`);
}

/* ---------- Charges ---------- */

export interface ChargeInput {
  householdId: string;
  /** Whose tab it was, when staff say. Must be someone in the household. */
  memberId?: string | null;
  /** YYYY-MM-DD, Pacific. Today when left out. */
  day?: string;
  category: BillingKind;
  /** An adjustment may be a credit and may go under any line. A sale is bar or snack bar and is never negative. */
  adjustment: boolean;
  amountCents: number;
  description?: string;
}

/** Staff enter a bar or snack-bar sale, or an adjustment, on a household's account. */
export async function recordCharge(store: ClubStore, ctx: Ctx, input: ChargeInput): Promise<Charge> {
  requireStaff(ctx.actor);
  return store.transaction(async (s, newId) => {
    const today = pacificDate(ctx.now);
    const household = householdOf(s, input.householdId);
    if (!household) throw new ClubError("not_found", "That household no longer exists.");
    const memberId = input.memberId || null;
    if (memberId) {
      const member = memberById(s, memberId);
      if (!member || member.householdId !== household.id) throw invalid(`That person is not in ${household.displayName}.`);
    }
    const day = input.day ?? today;
    openDay(s, day, today);
    if (!(BILLING_KINDS as readonly string[]).includes(input.category)) throw invalid("Choose which line of the invoice this goes under.");
    const amount = input.amountCents;
    if (!Number.isInteger(amount) || amount === 0) throw invalid("Enter an amount that is not zero.");
    if (Math.abs(amount) > MAX_CHARGE_CENTS) throw invalid(`An amount cannot be more than ${formatMoney(MAX_CHARGE_CENTS)}.`);
    let description = (input.description ?? "").trim();
    if (input.adjustment) {
      if (!description) throw invalid("Say what the adjustment is for.");
    } else {
      if (!SALE_KINDS.includes(input.category)) throw invalid("A sale is a bar or snack-bar charge. Use an adjustment for anything else.");
      if (amount < 0) throw invalid("A sale cannot be negative. Use an adjustment for a credit.");
      if (!description) description = KIND_LABEL[input.category];
    }
    if (description.length > 200) throw invalid("The note must be 200 characters or fewer.");
    const charge: Charge = {
      id: newId(),
      householdId: household.id,
      memberId,
      day,
      category: input.category,
      adjustment: input.adjustment,
      amountCents: amount,
      description,
      quantity: null,
      unitCents: null,
      entryToken: null,
      createdAt: ctx.now.toISOString(),
      createdBy: ctx.actor,
      status: "open",
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    };
    s.charges.push(charge);
    return structuredClone(charge);
  });
}

function reasonOf(value: string | undefined): string {
  const reason = (value ?? "").trim();
  if (!reason) throw invalid("Say why it is being voided.");
  if (reason.length > 300) throw invalid("The reason must be 300 characters or fewer.");
  return reason;
}

/** A wrong charge is voided with a reason, never deleted. Only while its month is still open. */
export async function voidCharge(store: ClubStore, ctx: Ctx, chargeId: string, reason: string): Promise<Charge> {
  requireStaff(ctx.actor);
  return store.transaction(async (s) => {
    const charge = s.charges.find((c) => c.id === chargeId);
    if (!charge) throw new ClubError("not_found", "That charge no longer exists.");
    const why = reasonOf(reason);
    if (charge.status === "voided") throw conflict("That charge was already voided.");
    if (isBilledDay(s, charge.day)) throw conflict(`That charge was billed in ${monthLabel(monthOf(charge.day))}. Add an adjustment dated today instead.`);
    charge.status = "voided";
    charge.voidedAt = ctx.now.toISOString();
    charge.voidedBy = ctx.actor;
    charge.voidReason = why;
    return structuredClone(charge);
  });
}

/* ---------- Visitors ---------- */

export interface VisitorsInput {
  memberId: string;
  visitors: number;
  /** On the iPad the member signs their own visitors in; at the front desk staff enter them. */
  via: VisitVia;
  /** Staff only: the day, when it is not today. */
  day?: string;
}

export interface VisitorsResult {
  entry: VisitorEntry;
  /** All the member's recorded visitors that day, this entry included. */
  dayTotal: number;
  /** What that day's visitors cost in all. */
  feeCents: number;
}

/** The visitors one member brought on one day, voided entries left out. */
export const visitorsOnDay = (s: ClubState, memberId: string, day: string): number =>
  s.visitors.filter((v) => v.memberId === memberId && v.day === day && v.status === "recorded").reduce((n, v) => n + v.visitors, 0);

/** A member signs in the visitors they are bringing (on the iPad), or staff enter them. Only a count is kept. */
export async function recordVisitors(store: ClubStore, ctx: Ctx, rules: BillingRules, input: VisitorsInput): Promise<VisitorsResult> {
  if (input.via === "staff") requireStaff(ctx.actor);
  else if (ctx.actor.kind !== "member" || ctx.actor.memberId !== input.memberId) throw new ClubError("forbidden", "Visitors can only be signed in by the member who brought them, or by club staff.");
  return store.transaction(async (s, newId) => {
    const member = memberById(s, input.memberId);
    if (!member) throw new ClubError("not_found", "That member no longer exists.");
    const household = householdOf(s, member.householdId);
    if (member.status !== "active" || !household || household.status !== "active") throw conflict(`${fullName(member)} is not an active member, so visitors cannot be recorded for them.`);
    const today = pacificDate(ctx.now);
    // On the iPad it is always today. Staff may enter an earlier day that is still open.
    const day = input.via === "ipad" ? today : (input.day ?? today);
    openDay(s, day, today);
    const most = rules.defaults.visitorsPerEntryMax;
    if (!Number.isInteger(input.visitors) || input.visitors < 1 || input.visitors > most) throw invalid(`Enter between 1 and ${most} visitors.`);
    const already = visitorsOnDay(s, member.id, day);
    if (already + input.visitors > rules.defaults.visitorsPerDayMax) {
      throw invalid(`That would make ${already + input.visitors} visitors in one day for ${fullName(member)}. The most that can be recorded is ${rules.defaults.visitorsPerDayMax}. If it is right, ask club staff.`);
    }
    const entry: VisitorEntry = {
      id: newId(),
      memberId: member.id,
      day,
      visitors: input.visitors,
      createdAt: ctx.now.toISOString(),
      createdBy: ctx.actor,
      via: input.via,
      status: "recorded",
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    };
    s.visitors.push(entry);
    const dayTotal = already + input.visitors;
    return { entry: structuredClone(entry), dayTotal, feeCents: visitorFeeCents(dayTotal, rules.defaults) };
  });
}

/** A wrong visitor entry is voided with a reason (staff only), while its month is still open. */
export async function voidVisitors(store: ClubStore, ctx: Ctx, entryId: string, reason: string): Promise<VisitorEntry> {
  requireStaff(ctx.actor);
  return store.transaction(async (s) => {
    const entry = s.visitors.find((v) => v.id === entryId);
    if (!entry) throw new ClubError("not_found", "That visitor entry no longer exists.");
    const why = reasonOf(reason);
    if (entry.status === "voided") throw conflict("That entry was already voided.");
    if (isBilledDay(s, entry.day)) throw conflict(`That entry was billed in ${monthLabel(monthOf(entry.day))}. Add an adjustment dated today instead.`);
    entry.status = "voided";
    entry.voidedAt = ctx.now.toISOString();
    entry.voidedBy = ctx.actor;
    entry.voidReason = why;
    return structuredClone(entry);
  });
}

/* ---------- The month's statements ---------- */

export interface PlannedLine {
  kind: BillingKind;
  description: string;
  quantity: number;
  unitCents: number;
  /** Negative for a credit. */
  amountCents: number;
  taxable: boolean;
  adjustment: boolean;
}

export interface PlannedInvoice {
  householdId: string;
  householdName: string;
  quickbooksId: string | null;
  invoiceNo: string;
  lines: PlannedLine[];
  totalCents: number;
}

export interface BillingPlan {
  /** The month, YYYY-MM. */
  month: string;
  /** Everything wrong. Anything here means the month cannot be closed. */
  problems: string[];
  /** Things worth a look that do not stop the month being closed. */
  notices: string[];
  invoices: PlannedInvoice[];
  /** Every line added up, credits included. */
  totalCents: number;
  /** The credit lines added up (zero or negative). QuickBooks' invoice import cannot take these. */
  creditCents: number;
  creditLines: number;
  /** A fingerprint of exactly what would be closed, so the confirm step can tell it is what was previewed. */
  fingerprint: string;
}

/** A household's membership type on a day: what it is now, with every later change in its file rolled back. */
export function typeOnDay(s: ClubState, household: Household, day: string): MembershipType {
  let type = household.membershipType;
  const changes = s.history.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.householdId === household.id && entry.kind === "type_changed");
  changes.sort((a, b) => (a.entry.at < b.entry.at ? 1 : a.entry.at > b.entry.at ? -1 : b.index - a.index));
  for (const { entry } of changes) {
    const from = entry.details.from;
    if (pacificDate(new Date(entry.at)) > day && typeof from === "string" && (MEMBERSHIP_TYPES as readonly string[]).includes(from)) type = from as MembershipType;
  }
  return type;
}

/** The lines every household earns in a month, from the records. Nothing is saved. */
function earnedLines(s: ClubState, rules: BillingRules, month: string): Map<string, PlannedLine[]> {
  const out = new Map<string, PlannedLine[]>();
  const add = (householdId: string, line: Omit<PlannedLine, "taxable" | "amountCents"> & { amountCents?: number }) => {
    const planned: PlannedLine = { ...line, amountCents: line.amountCents ?? line.quantity * line.unitCents, taxable: rules.defaults.taxable.includes(line.kind) };
    out.set(householdId, [...(out.get(householdId) ?? []), planned]);
  };
  const first = firstDayOf(month);

  // Dues: a full month for every household that was a member on the 1st, at the rate for the type it had then.
  for (const h of s.households) {
    if (h.joinedOn > first || (h.endedOn !== null && h.endedOn < first)) continue;
    const type = typeOnDay(s, h, first);
    const cents = rules.defaults.duesCents[type];
    if (cents > 0) add(h.id, { kind: "dues", description: `${monthLabel(month)} dues (${type})`, quantity: 1, unitCents: cents, adjustment: false });
  }

  // Event tickets: everyone who held spots when an event ended in the month, for the whole party.
  for (const e of s.events) {
    if (e.status !== "scheduled" || monthOf(pacificDate(new Date(e.endsAt))) !== month) continue;
    for (const r of s.rsvps) {
      if (r.eventId !== e.id || !BILLABLE_RSVP.includes(r.status) || !r.priceCents || r.priceCents <= 0) continue;
      const member = memberById(s, r.memberId);
      if (!member) continue;
      const party = 1 + r.guests;
      add(member.householdId, {
        kind: "event_tickets",
        description: `${e.title}, ${formatDay(pacificDate(new Date(e.startsAt)))}: ${fullName(member)}, ${party === 1 ? "1 person" : `party of ${party}`}`,
        quantity: party,
        unitCents: r.priceCents,
        adjustment: false,
      });
    }
  }

  // Visitor fees: for each member and day, free up to the limit, and over it every visitor that day is charged.
  const perDay = new Map<string, { memberId: string; day: string; total: number }>();
  for (const v of s.visitors) {
    if (v.status !== "recorded" || monthOf(v.day) !== month) continue;
    const key = `${v.memberId}|${v.day}`;
    perDay.set(key, { memberId: v.memberId, day: v.day, total: (perDay.get(key)?.total ?? 0) + v.visitors });
  }
  for (const { memberId, day, total } of perDay.values()) {
    if (visitorFeeCents(total, rules.defaults) === 0) continue;
    const member = memberById(s, memberId);
    if (!member) continue;
    add(member.householdId, { kind: "visitor_fees", description: `Visitor fee: ${total} visitors on ${formatDay(day)} (${fullName(member)})`, quantity: total, unitCents: rules.defaults.visitorFeeCents, adjustment: false });
  }

  // Bar and snack-bar sales add up to one line each per household; every adjustment is its own line.
  const sales = new Map<string, { householdId: string; kind: BillingKind; cents: number; count: number }>();
  for (const c of s.charges) {
    if (c.status !== "open" || monthOf(c.day) !== month) continue;
    if (c.adjustment) {
      add(c.householdId, { kind: c.category, description: `Adjustment: ${c.description}`, quantity: 1, unitCents: c.amountCents, adjustment: true });
      continue;
    }
    const key = `${c.householdId}|${c.category}`;
    const sale = sales.get(key) ?? { householdId: c.householdId, kind: c.category, cents: 0, count: 0 };
    sale.cents += c.amountCents;
    sale.count += 1;
    sales.set(key, sale);
  }
  for (const sale of sales.values()) {
    add(sale.householdId, { kind: sale.kind, description: `${KIND_LABEL[sale.kind]}: ${sale.count} charge${sale.count === 1 ? "" : "s"} in ${monthLabel(month)}`, quantity: 1, unitCents: sale.cents, adjustment: false });
  }
  return out;
}

const KIND_ORDER = new Map(BILLING_KINDS.map((k, i) => [k, i]));

/**
 * What closing a month would do, without doing it: each household's invoice, and everything that stops it (a month that
 * has not ended, one already closed, out of order, a household with charges but no QuickBooks ID). Changes nothing.
 */
export function planBilling(s: ClubState, rules: BillingRules, month: string, now: Date): BillingPlan {
  const empty = (problem: string): BillingPlan => ({ month, problems: [problem], notices: [], invoices: [], totalCents: 0, creditCents: 0, creditLines: 0, fingerprint: fingerprintOf(month, []) });
  if (!isMonth(month)) return empty("Choose a month, like 2026-09.");
  const label = monthLabel(month);

  const problems: string[] = [];
  const closed = s.billingRuns.find((r) => r.month === month);
  const latest = s.billingRuns.reduce<string | null>((m, r) => (m === null || r.month > m ? r.month : m), null);
  if (closed) return empty(`${label} was already billed on ${formatDay(pacificDate(new Date(closed.createdAt)))}. Its files are below.`);
  if (latest !== null && month < latest) return empty(`${label} comes before ${monthLabel(latest)}, which was already billed. Months are billed in order.`);
  if (latest !== null && month !== nextMonth(latest)) return empty(`Months are billed in order. ${monthLabel(nextMonth(latest))} comes next.`);
  const endsAt = pacificDayStart(firstDayOf(nextMonth(month)));
  if (now.getTime() < endsAt.getTime()) return empty(`${label} has not finished yet. It can be billed from ${formatDay(firstDayOf(nextMonth(month)))}.`);
  if (s.dataSince !== null && pacificDayStart(firstDayOf(month)).getTime() < Date.parse(s.dataSince)) {
    return empty(`${label} starts before the records this screen has loaded, so it cannot be billed safely from here. Pick a more recent month, or ask for help.`);
  }

  const notices: string[] = [];
  const lines = earnedLines(s, rules, month);
  const households = [...lines.keys()]
    .map((id) => householdOf(s, id)!)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
  const prefix = month.slice(2, 4) + month.slice(5, 7);
  const invoices: PlannedInvoice[] = households.map((h, i) => {
    const mine = [...lines.get(h.id)!].sort((a, b) => KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! || Number(a.adjustment) - Number(b.adjustment) || a.description.localeCompare(b.description));
    return { householdId: h.id, householdName: h.displayName, quickbooksId: h.quickbooksId, invoiceNo: `${prefix}-${String(i + 1).padStart(4, "0")}`, lines: mine, totalCents: mine.reduce((n, l) => n + l.amountCents, 0) };
  });
  for (const inv of invoices) {
    if (inv.quickbooksId === null) problems.push(`${inv.householdName} has charges but no QuickBooks ID. Add it on the household's page.`);
  }

  const endedDuring = s.households.filter((h) => h.endedOn !== null && monthOf(h.endedOn) === month && h.endedOn >= firstDayOf(month));
  if (endedDuring.length > 0) notices.push(`${endedDuring.length} household${endedDuring.length === 1 ? "" : "s"} that ended during ${label} ${endedDuring.length === 1 ? "is" : "are"} billed dues for the whole month, because ${endedDuring.length === 1 ? "it was" : "they were"} members on the 1st.`);
  const unmarked = s.rsvps.filter((r) => r.status === "going" && s.events.some((e) => e.id === r.eventId && e.status === "scheduled" && monthOf(pacificDate(new Date(e.endsAt))) === month) && (r.priceCents ?? 0) > 0);
  if (unmarked.length > 0) notices.push(`${unmarked.length} event RSVP${unmarked.length === 1 ? " is" : "s are"} billed although nobody marked attendance. Held spots are billed whether or not they were marked.`);
  const credits = invoices.flatMap((i) => i.lines).filter((l) => l.amountCents < 0);
  if (credits.length > 0) notices.push(`${credits.length} credit line${credits.length === 1 ? "" : "s"} (${formatMoney(credits.reduce((n, l) => n + l.amountCents, 0))}) cannot go in QuickBooks' invoice file, because QuickBooks does not import negative amounts. They are in the plain charges file, to enter in QuickBooks by hand.`);
  if (rules.placeholder) notices.push("The dues, the visitor fee and the QuickBooks names are placeholders until staff confirm them.");

  return {
    month,
    problems,
    notices,
    invoices,
    totalCents: invoices.reduce((n, i) => n + i.totalCents, 0),
    creditCents: credits.reduce((n, l) => n + l.amountCents, 0),
    creditLines: credits.length,
    fingerprint: fingerprintOf(month, invoices),
  };
}

function fingerprintOf(month: string, invoices: PlannedInvoice[]): string {
  const body = invoices.map((i) => [i.householdId, i.invoiceNo, i.lines.map((l) => [l.kind, l.description, l.quantity, l.unitCents, l.amountCents, l.taxable, l.adjustment])]);
  return createHash("sha256").update(JSON.stringify([month, body])).digest("hex");
}

export interface BillingRunResult {
  run: BillingRun;
  invoiceCount: number;
  totalCents: number;
}

/**
 * Closes a month: one all-or-nothing change that works the month out again from the records, refuses it if anything is
 * wrong or if it no longer matches what staff previewed (`expect`), and then freezes every household's lines. Staff only.
 */
export async function runBilling(store: ClubStore, ctx: Ctx, rules: BillingRules, month: string, expect?: { fingerprint: string }): Promise<BillingRunResult> {
  requireStaff(ctx.actor);
  return store.transaction(async (s, newId) => {
    const plan = planBilling(s, rules, month, ctx.now);
    if (plan.problems.length > 0) {
      throw invalid(plan.problems.length === 1 ? `${plan.problems[0]} Nothing was billed.` : `The preview has ${plan.problems.length} problems, so nothing was billed. Fix them and preview the month again.`);
    }
    if (expect && expect.fingerprint !== plan.fingerprint) {
      throw conflict("The month's charges changed since you previewed it, so nothing was billed. Preview it again.");
    }
    const run: BillingRun = { id: newId(), month, createdAt: ctx.now.toISOString(), createdBy: ctx.actor, invoiceCount: plan.invoices.length, totalCents: plan.totalCents };
    s.billingRuns.push(run);
    for (const inv of plan.invoices) {
      for (const l of inv.lines) {
        const line: BillingLine = { id: newId(), runId: run.id, householdId: inv.householdId, invoiceNo: inv.invoiceNo, kind: l.kind, description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, taxable: l.taxable, adjustment: l.adjustment };
        s.billingLines.push(line);
      }
    }
    return { run: structuredClone(run), invoiceCount: run.invoiceCount, totalCents: run.totalCents };
  });
}

/** The month staff would most likely close next: the one after the last, or the most recent finished month when none has been closed. */
export function suggestedMonth(s: ClubState, now: Date): string {
  const latest = s.billingRuns.reduce<string | null>((m, r) => (m === null || r.month > m ? r.month : m), null);
  if (latest !== null) return nextMonth(latest);
  const today = pacificDate(now);
  const thisMonth = monthOf(today);
  return monthOf(pacificDate(new Date(pacificDayStart(firstDayOf(thisMonth)).getTime() - 86400000)));
}

