import type { SnackRules, SnackRuleValues } from "../types";
import raw from "./snack-rules.json";

/** A mistake in the snack bar rules file, worded so someone editing it can fix it. */
export class SnackRulesError extends Error {}

const RULES: Record<keyof SnackRuleValues, { label: string; min: number; max: number }> = {
  priceCents: { label: "priceCents (the price of one snack, in cents: 150 is $1.50)", min: 1, max: 100_000 },
  itemsPerEntryMax: { label: "itemsPerEntryMax (the most snacks one press of the button can record)", min: 1, max: 100 },
  itemsPerDayMax: { label: "itemsPerDayMax (the most snacks one member can have recorded in a day)", min: 1, max: 500 },
  thankYouSeconds: { label: "thankYouSeconds (how long the thank-you shows before the iPad goes back to the start)", min: 2, max: 60 },
  idleSeconds: { label: "idleSeconds (how long the iPad waits, untouched, before it goes back to the start)", min: 10, max: 600 },
};

/**
 * The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. A day's
 * limit smaller than one press's limit would make the bigger numbers on the screen impossible, so that is refused too, and
 * the biggest purchase can never come to more than a charge can be (the database limit).
 */
export function parseSnackRules(input: unknown): SnackRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new SnackRulesError("The snack bar rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new SnackRulesError('The snack bar rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new SnackRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof SnackRuleValues];
    if (!rule) throw new SnackRulesError(`defaults: "${key}" is not a snack bar rule. The snack bar rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new SnackRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new SnackRulesError(`defaults, ${rule.label} must be ${rule.min} or more.`);
    if (value > rule.max) throw new SnackRulesError(`defaults, ${rule.label} cannot be more than ${rule.max.toLocaleString("en-US")}.`);
  }
  const defaults = { ...(data.defaults as unknown as SnackRuleValues) };
  if (defaults.itemsPerDayMax < defaults.itemsPerEntryMax) {
    throw new SnackRulesError(`defaults, itemsPerDayMax (${defaults.itemsPerDayMax}) cannot be less than itemsPerEntryMax (${defaults.itemsPerEntryMax}).`);
  }
  return { placeholder: data.placeholder !== false, defaults };
}

/** The rules the snack bar iPad runs on, read and checked once. */
export const SNACK_RULES: SnackRules = parseSnackRules(raw);
