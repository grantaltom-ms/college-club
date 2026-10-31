import { ClubError } from "../errors";
import type { ClubStore } from "../store/memory";
import { pacificDate } from "../time";
import type { Charge, ClubState, SnackRules } from "../types";
import { isBilledDay } from "./billing";
import { formatMoney, monthLabel, monthOf } from "./billing-words";
import type { Ctx } from "./households";
import { fullName, householdOf, memberById } from "./queries";

/**
 * The honor snack bar. The building comparison: the honor box in the lobby. A tenant takes a snack, writes down their name
 * and how many, and it goes on their unit's account for the month. Here the iPad is the notebook: the member picks their own
 * name, says how many, and one charge is added to their household's account, billed with the rest of the month (the Snack
 * Bar line of the invoice). Every snack costs the same. Nothing is taken from anyone: a wrong entry is voided by staff on the
 * Charges screen, with a reason, like any other charge.
 */

/** A token the iPad screen carries, long enough that nobody guesses one. */
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

const invalid = (message: string) => new ClubError("invalid", message);
const conflict = (message: string) => new ClubError("conflict", message);

export interface SnackInput {
  memberId: string;
  /** How many snacks. */
  items: number;
  /** The random token the screen carried when it was drawn. The same token is recorded once, so a double tap is one purchase. */
  entryToken: string;
}

export interface SnackResult {
  charge: Charge;
  items: number;
  totalCents: number;
  /** True when this token had already been recorded: nothing new was added, and the answer is the first one again. */
  repeated: boolean;
}

/** The snacks one member has had recorded on the iPad on one day, voided purchases left out. */
export const snackItemsOnDay = (s: ClubState, memberId: string, day: string): number =>
  s.charges.filter((c) => c.status === "open" && c.category === "snack_bar" && !c.adjustment && c.memberId === memberId && c.day === day).reduce((n, c) => n + (c.quantity ?? 0), 0);

/**
 * A member puts snacks on their own household's account, on the snack bar iPad. Only the member themselves (the iPad acts as
 * whoever was picked, as it does for visitors); club staff enter a charge on the Charges screen instead. Always dated today.
 * One all-or-nothing change under the store's lock, so two quick taps of the same screen are one purchase.
 */
export async function recordSnacks(store: ClubStore, ctx: Ctx, rules: SnackRules, input: SnackInput): Promise<SnackResult> {
  if (ctx.actor.kind !== "member" || ctx.actor.memberId !== input.memberId) {
    throw new ClubError("forbidden", "Snacks can only be put on an account by the member who took them, on the snack bar iPad. Club staff can add a charge on the Charges screen.");
  }
  return store.transaction(async (s, newId) => {
    const member = memberById(s, input.memberId);
    if (!member) throw new ClubError("not_found", "That member no longer exists.");
    const household = householdOf(s, member.householdId);
    if (member.status !== "active" || !household || household.status !== "active") {
      throw conflict(`${fullName(member)} is not an active member, so snacks cannot be put on their account.`);
    }
    if (typeof input.entryToken !== "string" || !TOKEN.test(input.entryToken)) throw invalid("That screen is out of date. Start again from the beginning.");

    // The same screen pressed twice: the first press is the purchase, and the second just gets the same answer.
    const earlier = s.charges.find((c) => c.entryToken === input.entryToken);
    if (earlier) {
      if (earlier.memberId !== member.id || earlier.quantity !== input.items) throw conflict("That purchase was already recorded. Start again if you want to add more.");
      return { charge: structuredClone(earlier), items: earlier.quantity ?? 0, totalCents: earlier.amountCents, repeated: true };
    }

    const { priceCents, itemsPerEntryMax, itemsPerDayMax } = rules.defaults;
    if (!Number.isInteger(input.items) || input.items < 1 || input.items > itemsPerEntryMax) throw invalid(`Choose between 1 and ${itemsPerEntryMax} snacks.`);
    const today = pacificDate(ctx.now);
    if (isBilledDay(s, today)) throw conflict(`${monthLabel(monthOf(today))} was already billed, so nothing can be added to it. Ask club staff.`);
    const already = snackItemsOnDay(s, member.id, today);
    if (already + input.items > itemsPerDayMax) {
      throw invalid(`That would make ${already + input.items} snacks today for ${fullName(member)}. The most that can be recorded in a day is ${itemsPerDayMax}. If that is right, ask club staff.`);
    }

    const charge: Charge = {
      id: newId(),
      householdId: household.id,
      memberId: member.id,
      day: today,
      category: "snack_bar",
      adjustment: false,
      amountCents: input.items * priceCents,
      description: `${snackCountWords(input.items)} at ${formatMoney(priceCents)}`,
      quantity: input.items,
      unitCents: priceCents,
      entryToken: input.entryToken,
      createdAt: ctx.now.toISOString(),
      createdBy: ctx.actor,
      status: "open",
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    };
    s.charges.push(charge);
    return { charge: structuredClone(charge), items: input.items, totalCents: charge.amountCents, repeated: false };
  });
}

/* ---------- Words ---------- */

/** "1 snack" or "3 snacks". */
export const snackCountWords = (items: number): string => `${items} snack${items === 1 ? "" : "s"}`;

/** "Every snack is $1.50." The price is stated first, so the cost is never a surprise. */
export const snackPriceWords = (rules: SnackRules): string => `Every snack is ${formatMoney(rules.defaults.priceCents)}.`;

/** "3 snacks, $4.50": what a count comes to. */
export const snackTotalWords = (items: number, rules: SnackRules): string => `${snackCountWords(items)}, ${formatMoney(items * rules.defaults.priceCents)}`;

/** What the iPad says once a purchase is recorded. */
export function snackThanks(firstName: string, charge: Charge): string {
  const items = charge.quantity ?? 0;
  return `Thanks, ${firstName}! ${snackCountWords(items)}, ${formatMoney(charge.amountCents)}, added to your account for ${monthLabel(monthOf(charge.day))}. Enjoy.`;
}

/* ---------- What staff see ---------- */

export interface SnackBarMonth {
  /** The month, like "October 2026". */
  label: string;
  purchases: number;
  items: number;
  totalCents: number;
}

/** What the iPad took in the month of a day: purchases, snacks and dollars, voided purchases left out. */
export function snackBarMonth(s: ClubState, day: string): SnackBarMonth {
  const month = monthOf(day);
  const mine = s.charges.filter((c) => c.status === "open" && c.category === "snack_bar" && !c.adjustment && c.quantity !== null && monthOf(c.day) === month);
  return { label: monthLabel(month), purchases: mine.length, items: mine.reduce((n, c) => n + (c.quantity ?? 0), 0), totalCents: mine.reduce((n, c) => n + c.amountCents, 0) };
}
