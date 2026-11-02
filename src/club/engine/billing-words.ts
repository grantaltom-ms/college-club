import { addDays } from "../time";
import type { BillingRuleValues } from "../types";

/** Money, months and the plain sentences about the fee. Pure, so the engine, the files and the screens all say the same thing. */

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "$1,234.50", or "-$20.00" for a credit. */
export function formatMoney(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}$${whole.toLocaleString("en-US")}.${rest}`;
}

/** The number a spreadsheet or QuickBooks wants: "154.50", or "-20.00". No dollar sign, no thousands comma. */
export function decimal(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100);
  return `${cents < 0 ? "-" : ""}${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/**
 * What staff typed as an amount, in cents, or null when it is not an amount. Accepts 12, 12.5, 12.50, $12.50 and 1,250.00,
 * and a leading minus for a credit. Never guesses: "12.505", "1.2.3", "twelve" and "" are all refused.
 */
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/^(-?)\$/, "$1");
  const match = /^(-?)((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[2].replace(/,/g, ""));
  if (whole > 9_999_999) return null;
  const cents = whole * 100 + Number((match[3] ?? "").padEnd(2, "0") || 0);
  return match[1] ? -cents : cents;
}

/** YYYY-MM, with a real month. */
export const isMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const monthOf = (day: string): string => day.slice(0, 7);
export const firstDayOf = (month: string): string => `${month}-01`;
export const nextMonth = (month: string): string => monthOf(addDays(firstDayOf(month), 32));
export const lastDayOf = (month: string): string => addDays(firstDayOf(nextMonth(month)), -1);

/** "2026-10" becomes "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-10-31" becomes "10/31/2026", the layout QuickBooks Online's import assumes for US companies. */
export function usDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${m}/${d}/${y}`;
}

/** The fee for one member's visitors on one day: free up to the limit, and over it every visitor is charged. */
export function visitorFeeCents(visitors: number, rules: Pick<BillingRuleValues, "visitorFreePerDay" | "visitorFeeCents">): number {
  return visitors > rules.visitorFreePerDay ? visitors * rules.visitorFeeCents : 0;
}

const people = (n: number) => `${n} visitor${n === 1 ? "" : "s"}`;

/** The rule in words, shown where visitors are signed in. */
export function visitorRuleWords(rules: Pick<BillingRuleValues, "visitorFreePerDay" | "visitorFeeCents">): string {
  if (rules.visitorFeeCents === 0) return "There is no fee for visitors.";
  const over = rules.visitorFreePerDay + 1;
  return `A member can bring up to ${people(rules.visitorFreePerDay)} a day for free. With more than that, every visitor that day costs ${formatMoney(rules.visitorFeeCents)}, not just the extra ones: ${people(over)} cost ${formatMoney(over * rules.visitorFeeCents)} in all.`;
}

/** What a day's total means, said back to the member after they sign visitors in. */
export function visitorTotalWords(total: number, rules: Pick<BillingRuleValues, "visitorFreePerDay" | "visitorFeeCents">): string {
  const fee = visitorFeeCents(total, rules);
  if (fee > 0) return `That makes ${people(total)} today. That is over ${rules.visitorFreePerDay}, so each costs ${formatMoney(rules.visitorFeeCents)}: ${formatMoney(fee)}, added to the household's bill.`;
  const left = rules.visitorFreePerDay - total;
  return `That makes ${people(total)} today, with no fee. ${left > 0 ? `${left} more visitor${left === 1 ? "" : "s"} would still be free.` : `One more visitor today and every visitor that day costs ${formatMoney(rules.visitorFeeCents)}.`}`;
}
