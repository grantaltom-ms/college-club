import { pacificDate } from "../time";
import type { BillingRules, BillingRun, ClubState, VisitVia } from "../types";
import type { PlannedInvoice, PlannedLine } from "./billing";
import { KIND_LABEL, householdEarnedLines, isBilledDay, suggestedMonth, visitorsOnDay } from "./billing";
import { isMonth, monthLabel, monthOf, nextMonth, visitorFeeCents } from "./billing-words";
import { fullName, householdOf, memberById } from "./queries";

/** What the staff billing screens list: charges, visitor entries and closed months, newest first. Read only; nothing here changes anything. */

export interface ChargeRowView {
  id: string;
  householdName: string;
  day: string;
  kindLabel: string;
  adjustment: boolean;
  amountCents: number;
  description: string;
  /** Whose tab, when staff said. */
  memberName: string | null;
  enteredBy: string;
  status: "open" | "voided";
  voidReason: string | null;
  /** "September 2026" once that month was closed, otherwise null. */
  billedIn: string | null;
  /** Open, and its month is still open. */
  canVoid: boolean;
}

/** The latest charges, by the day they happened and then by when they were entered. */
export function chargeRows(s: ClubState, limit = 100): ChargeRowView[] {
  return [...s.charges]
    .map((c, written) => ({ c, written }))
    .sort((a, b) => b.c.day.localeCompare(a.c.day) || b.c.createdAt.localeCompare(a.c.createdAt) || b.written - a.written)
    .slice(0, limit)
    .map(({ c }) => {
      const billed = isBilledDay(s, c.day);
      const member = c.memberId ? memberById(s, c.memberId) : undefined;
      return {
        id: c.id,
        householdName: householdOf(s, c.householdId)?.displayName ?? "A household that no longer exists",
        day: c.day,
        kindLabel: c.adjustment ? `Adjustment, ${KIND_LABEL[c.category].toLowerCase()}` : KIND_LABEL[c.category],
        adjustment: c.adjustment,
        amountCents: c.amountCents,
        description: c.description,
        memberName: member ? fullName(member) : null,
        enteredBy: c.createdBy.kind === "member" ? `${c.createdBy.label} on the snack bar iPad` : c.createdBy.label,
        status: c.status,
        voidReason: c.voidReason,
        billedIn: billed ? monthLabel(monthOf(c.day)) : null,
        canVoid: c.status === "open" && !billed,
      };
    });
}

export interface VisitorRowView {
  id: string;
  memberName: string;
  householdName: string;
  day: string;
  visitors: number;
  via: VisitVia;
  enteredBy: string;
  status: "recorded" | "voided";
  voidReason: string | null;
  /** The member's recorded visitors that whole day, and what that day costs. */
  dayTotal: number;
  dayFeeCents: number;
  billedIn: string | null;
  canVoid: boolean;
}

export function visitorRows(s: ClubState, rules: BillingRules, limit = 100): VisitorRowView[] {
  return [...s.visitors]
    .map((v, written) => ({ v, written }))
    .sort((a, b) => b.v.day.localeCompare(a.v.day) || b.v.createdAt.localeCompare(a.v.createdAt) || b.written - a.written)
    .slice(0, limit)
    .map(({ v }) => {
      const member = memberById(s, v.memberId);
      const dayTotal = visitorsOnDay(s, v.memberId, v.day);
      const billed = isBilledDay(s, v.day);
      return {
        id: v.id,
        memberName: member ? fullName(member) : "A member who no longer exists",
        householdName: member ? (householdOf(s, member.householdId)?.displayName ?? "") : "",
        day: v.day,
        visitors: v.visitors,
        via: v.via,
        enteredBy: v.createdBy.label,
        status: v.status,
        voidReason: v.voidReason,
        dayTotal,
        dayFeeCents: visitorFeeCents(dayTotal, rules.defaults),
        billedIn: billed ? monthLabel(monthOf(v.day)) : null,
        canVoid: v.status === "recorded" && !billed,
      };
    });
}

export interface ClosedMonthView {
  month: string;
  label: string;
  createdAt: string;
  closedBy: string;
  invoiceCount: number;
  totalCents: number;
}

/** Every closed month, newest first. */
export function closedMonths(s: ClubState): ClosedMonthView[] {
  return [...s.billingRuns]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((r) => ({ month: r.month, label: monthLabel(r.month), createdAt: r.createdAt, closedBy: r.createdBy.label, invoiceCount: r.invoiceCount, totalCents: r.totalCents }));
}

/** Every household, by name, for a picker. A household whose membership ended is marked, because its last bill still has to be sent. */
export function householdChoices(s: ClubState): { id: string; name: string }[] {
  return [...s.households]
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id))
    .map((h) => ({ id: h.id, name: h.status === "ended" ? `${h.displayName} (membership ended)` : h.displayName }));
}

/** Every active adult of an active household, by last name, for a picker. Two with the same name are told apart by household. */
export function memberChoices(s: ClubState): { id: string; name: string }[] {
  const active = s.members
    .filter((m) => m.status === "active" && householdOf(s, m.householdId)?.status === "active")
    .sort((a, b) => a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" }) || a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id));
  const counts = new Map<string, number>();
  for (const m of active) counts.set(fullName(m), (counts.get(fullName(m)) ?? 0) + 1);
  return active.map((m) => ({ id: m.id, name: (counts.get(fullName(m)) ?? 0) > 1 ? `${fullName(m)} (${householdOf(s, m.householdId)!.displayName})` : fullName(m) }));
}

/** A closed month's invoices, rebuilt from its frozen lines, in the order they were written. */
export function closedInvoices(s: ClubState, run: BillingRun): PlannedInvoice[] {
  const byInvoice = new Map<string, PlannedInvoice>();
  for (const l of s.billingLines) {
    if (l.runId !== run.id) continue;
    const household = householdOf(s, l.householdId);
    const invoice = byInvoice.get(l.invoiceNo) ?? { householdId: l.householdId, householdName: household?.displayName ?? "", quickbooksId: household?.quickbooksId ?? null, invoiceNo: l.invoiceNo, lines: [], totalCents: 0 };
    invoice.lines.push({ kind: l.kind, description: l.description, quantity: l.quantity, unitCents: l.unitCents, amountCents: l.amountCents, taxable: l.taxable, adjustment: l.adjustment });
    invoice.totalCents += l.amountCents;
    byInvoice.set(l.invoiceNo, invoice);
  }
  return [...byInvoice.values()];
}

/**
 * Whether all of a closed month's lines are loaded. The Postgres store loads only the lines of the latest months, so for a
 * much older month the lines can be missing; files made from a missing part would look complete and be wrong, so the screens
 * check this first and say so instead.
 */
export function linesComplete(s: ClubState, run: BillingRun): boolean {
  const invoices = new Set(s.billingLines.filter((l) => l.runId === run.id).map((l) => l.invoiceNo));
  return invoices.size === run.invoiceCount;
}

/** One month on a household's My bill screen: either the open running total or a frozen closed invoice. */
export interface HouseholdBillMonth {
  month: string;
  label: string;
  /** "open" is still accruing (or finished but not yet closed); "closed" is frozen. */
  status: "open" | "closed";
  lines: PlannedLine[];
  totalCents: number;
  invoiceNo: string | null;
  closedAt: string | null;
  closedBy: string | null;
}

/** What one household sees on My bill. Read only; built from the same lines staff close into QuickBooks. */
export interface HouseholdBillView {
  householdId: string;
  householdName: string;
  /** This Pacific calendar month, even when there is nothing on it yet. */
  current: HouseholdBillMonth;
  /** Earlier months that have not been closed yet and have something for this household, newest first. */
  awaiting: HouseholdBillMonth[];
  /** Closed months that had an invoice for this household, newest first. */
  closed: HouseholdBillMonth[];
  placeholder: boolean;
}

const openMonthView = (s: ClubState, rules: BillingRules, householdId: string, month: string): HouseholdBillMonth => {
  const lines = householdEarnedLines(s, rules, householdId, month);
  return {
    month,
    label: monthLabel(month),
    status: "open",
    lines,
    totalCents: lines.reduce((n, l) => n + l.amountCents, 0),
    invoiceNo: null,
    closedAt: null,
    closedBy: null,
  };
};

/** Every YYYY-MM from `from` up to but not including `until`, oldest first. */
function monthsUntil(from: string, until: string): string[] {
  if (!isMonth(from) || !isMonth(until) || from >= until) return [];
  const out: string[] = [];
  for (let m = from; m < until; m = nextMonth(m)) out.push(m);
  return out;
}

/**
 * One household's bill: this month so far, any earlier months not yet closed, and every closed invoice. Changes nothing.
 * Staff and members both read through this so the words and totals match the staff billing screen.
 */
export function householdBill(s: ClubState, rules: BillingRules, householdId: string, now: Date): HouseholdBillView | null {
  const household = householdOf(s, householdId);
  if (!household) return null;
  const currentMonth = monthOf(pacificDate(now));
  // Only months staff can still close in order: after the last closed month, or the month the staff
  // screen would offer first. Older finished months are left out on purpose (staff pick the starting
  // month; anything before that is never billed).
  const latestClosed = s.billingRuns.reduce<string | null>((m, r) => (m === null || r.month > m ? r.month : m), null);
  const firstOpen = latestClosed !== null ? nextMonth(latestClosed) : suggestedMonth(s, now);
  const awaiting = monthsUntil(firstOpen, currentMonth)
    .map((m) => openMonthView(s, rules, householdId, m))
    .filter((m) => m.lines.length > 0)
    .reverse();

  // Only months that have this household's frozen invoice among the lines loaded on this screen. An older closed month
  // whose lines were not loaded simply does not appear (same limit the staff billing files already have).
  const closed: HouseholdBillMonth[] = [...s.billingRuns]
    .sort((a, b) => b.month.localeCompare(a.month))
    .flatMap((run) => {
      const invoice = closedInvoices(s, run).find((i) => i.householdId === householdId);
      if (!invoice) return [];
      return [
        {
          month: run.month,
          label: monthLabel(run.month),
          status: "closed" as const,
          lines: invoice.lines,
          totalCents: invoice.totalCents,
          invoiceNo: invoice.invoiceNo,
          closedAt: run.createdAt,
          closedBy: run.createdBy.label,
        },
      ];
    });

  return {
    householdId: household.id,
    householdName: household.displayName,
    current: openMonthView(s, rules, householdId, currentMonth),
    awaiting,
    closed,
    placeholder: rules.placeholder,
  };
}

/** One month from a household's bill, or null when that month has nothing for them (and is not the open current month). */
export function householdBillMonth(view: HouseholdBillView, month: string): HouseholdBillMonth | null {
  if (!isMonth(month)) return null;
  if (view.current.month === month) return view.current;
  return view.awaiting.find((m) => m.month === month) ?? view.closed.find((m) => m.month === month) ?? null;
}
