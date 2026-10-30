import type { PracticeRules, PracticeRuleValues } from "../types";
import raw from "./practice-rules.json";

/** A mistake in the practice rules file, worded so someone editing it can fix it. */
export class PracticeRulesError extends Error {}

const RULES: Record<keyof PracticeRuleValues, { label: string; min: number; max: number }> = {
  nameMax: { label: "nameMax (the longest practice name)", min: 10, max: 200 },
  notesMax: { label: "notesMax (the longest practice note)", min: 20, max: 2000 },
  maxHours: { label: "maxHours (the longest a practice can run, in hours)", min: 1, max: 24 },
  maxBoats: { label: "maxBoats (the most boats one practice can reserve)", min: 1, max: 100 },
  daysAhead: { label: "daysAhead (how many days ahead a practice can be set up)", min: 1, max: 730 },
  reasonMax: { label: "reasonMax (the longest reason for cancelling or taking someone out)", min: 20, max: 200 },
};

/** The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. */
export function parsePracticeRules(input: unknown): PracticeRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new PracticeRulesError("The practice rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new PracticeRulesError('The practice rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new PracticeRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof PracticeRuleValues];
    if (!rule) throw new PracticeRulesError(`defaults: "${key}" is not a practice rule. The practice rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new PracticeRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new PracticeRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new PracticeRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as unknown as PracticeRuleValues) } };
}

/** The rules practices run on, read and checked once. */
export const PRACTICE_RULES: PracticeRules = parsePracticeRules(raw);
