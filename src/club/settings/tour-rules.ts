import raw from "./tour-rules.json";

/** A mistake in the tour request rules file, worded so someone editing it can fix it. */
export class TourRulesError extends Error {}

export interface TourRuleValues {
  /** The same email address is saved at most this many times in 24 hours. */
  maxPerEmailPerDay: number;
  /** The whole site saves at most this many requests in an hour. */
  maxPerHour: number;
  /** How many requests the staff screen lists at once. */
  listLimit: number;
}

export interface TourRules {
  /** True while the numbers are placeholders. */
  placeholder: boolean;
  defaults: TourRuleValues;
}

const RULES: Record<keyof TourRuleValues, { label: string; min: number; max: number }> = {
  maxPerEmailPerDay: { label: "maxPerEmailPerDay (the same email address is saved at most this many times in 24 hours)", min: 1, max: 20 },
  maxPerHour: { label: "maxPerHour (the whole site saves at most this many requests in an hour)", min: 1, max: 1000 },
  listLimit: { label: "listLimit (how many requests the staff screen lists at once)", min: 10, max: 500 },
};

/** The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. */
export function parseTourRules(input: unknown): TourRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new TourRulesError("The tour request rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new TourRulesError('The tour request rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new TourRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof TourRuleValues];
    if (!rule) throw new TourRulesError(`defaults: "${key}" is not a tour request rule. The tour request rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new TourRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new TourRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new TourRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as object) } as TourRuleValues };
}

/** The rules the Request a tour form runs on, read and checked once. */
export const TOUR_RULES: TourRules = parseTourRules(raw);
