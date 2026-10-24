import { BILLING_KINDS, MEMBERSHIP_TYPES, type BillingKind, type BillingRules, type BillingRuleValues, type MembershipType } from "../types";
import raw from "./billing-rules.json";

/** A mistake in the billing rules file, worded so someone editing it can fix it. */
export class BillingRulesError extends Error {}

const NUMBERS: Record<"visitorFreePerDay" | "visitorFeeCents" | "visitorsPerEntryMax" | "visitorsPerDayMax" | "invoiceDueDays", { label: string; min: number; max: number }> = {
  visitorFreePerDay: { label: "visitorFreePerDay (visitors a member can bring in a day for free)", min: 0, max: 50 },
  visitorFeeCents: { label: "visitorFeeCents (the fee for each visitor, in cents)", min: 0, max: 100_000 },
  visitorsPerEntryMax: { label: "visitorsPerEntryMax (the most visitors one entry can record)", min: 1, max: 50 },
  visitorsPerDayMax: { label: "visitorsPerDayMax (the most visitors one member can have recorded in a day)", min: 1, max: 200 },
  invoiceDueDays: { label: "invoiceDueDays (days from the invoice date to the due date)", min: 0, max: 120 },
};
const OBJECTS = ["duesCents", "items"];
const LIST = "taxable";
const MOST_DUES_CENTS = 1_000_000;

function whole(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new BillingRulesError(`${label} must be a whole number.`);
  if (value < min) throw new BillingRulesError(`${label} must be ${min} or more.`);
  if (value > max) throw new BillingRulesError(`${label} cannot be more than ${max.toLocaleString("en-US")}.`);
  return value;
}

/** Exactly the names in `names`, nothing more or less, so a typo or a missing entry is caught rather than ignored. */
function exactKeys(value: unknown, names: readonly string[], where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingRulesError(`defaults, ${where} must be a list of entries, one for each of: ${names.join(", ")}.`);
  const entries = value as Record<string, unknown>;
  for (const name of names) if (!(name in entries)) throw new BillingRulesError(`defaults, ${where} is missing "${name}".`);
  for (const key of Object.keys(entries)) if (!names.includes(key)) throw new BillingRulesError(`defaults, ${where}: "${key}" is not one of: ${names.join(", ")}.`);
  return entries;
}

export function parseBillingRules(input: unknown): BillingRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new BillingRulesError("The billing rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new BillingRulesError('The billing rules file needs a "defaults" section.');
  const known = [...Object.keys(NUMBERS), ...OBJECTS, LIST];
  for (const key of known) if (!(key in data.defaults)) throw new BillingRulesError(`defaults is missing "${key}".`);
  for (const key of Object.keys(data.defaults)) {
    if (!known.includes(key)) throw new BillingRulesError(`defaults: "${key}" is not a billing rule. The billing rules are: ${known.join(", ")}.`);
  }

  const numbers = Object.fromEntries(
    (Object.keys(NUMBERS) as (keyof typeof NUMBERS)[]).map((key) => [key, whole(data.defaults![key], `defaults, ${NUMBERS[key].label}`, NUMBERS[key].min, NUMBERS[key].max)]),
  ) as Record<keyof typeof NUMBERS, number>;
  if (numbers.visitorsPerDayMax < numbers.visitorsPerEntryMax) {
    throw new BillingRulesError(`defaults, visitorsPerDayMax (${numbers.visitorsPerDayMax}) cannot be less than visitorsPerEntryMax (${numbers.visitorsPerEntryMax}).`);
  }

  const dues = exactKeys(data.defaults.duesCents, MEMBERSHIP_TYPES, "duesCents (monthly dues in cents)");
  const duesCents = Object.fromEntries(MEMBERSHIP_TYPES.map((type) => [type, whole(dues[type], `defaults, duesCents for ${type} (in cents)`, 0, MOST_DUES_CENTS)])) as Record<MembershipType, number>;

  const names = exactKeys(data.defaults.items, BILLING_KINDS, "items (the QuickBooks product or service name for each kind of line)");
  const items = Object.fromEntries(
    BILLING_KINDS.map((kind) => {
      const name = names[kind];
      if (typeof name !== "string" || name.trim() === "") throw new BillingRulesError(`defaults, items for ${kind} must be a name, such as "Membership Dues".`);
      if (name !== name.trim()) throw new BillingRulesError(`defaults, items for ${kind} has spaces at the start or end of its name ("${name}"). QuickBooks would not match it.`);
      if (name.length > 100) throw new BillingRulesError(`defaults, items for ${kind} must be 100 characters or fewer.`);
      if (/[",\r\n]/.test(name)) throw new BillingRulesError(`defaults, items for ${kind} cannot contain a comma, a quotation mark or a line break.`);
      return [kind, name];
    }),
  ) as Record<BillingKind, string>;

  const taxable = data.defaults[LIST];
  if (!Array.isArray(taxable)) throw new BillingRulesError(`defaults, ${LIST} (kinds of line that carry sales tax) must be a list, such as ["bar", "snack_bar"], or [] for none.`);
  for (const kind of taxable) {
    if (typeof kind !== "string" || !(BILLING_KINDS as readonly string[]).includes(kind)) {
      throw new BillingRulesError(`defaults, ${LIST}: "${String(kind)}" is not a kind of line. The kinds are: ${BILLING_KINDS.join(", ")}.`);
    }
  }
  if (new Set(taxable).size !== taxable.length) throw new BillingRulesError(`defaults, ${LIST} names the same kind of line twice.`);

  const defaults: BillingRuleValues = { ...numbers, duesCents, items, taxable: taxable as BillingKind[] };
  return { placeholder: data.placeholder !== false, defaults };
}

/** The billing rules the charges, visitor sign-in and monthly billing run on, read and checked once. */
export const BILLING_RULES: BillingRules = parseBillingRules(raw);
