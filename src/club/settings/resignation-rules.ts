import raw from "./resignation-rules.json";

/** A mistake in the resignation rules file, worded so someone editing it can fix it. */
export class ResignationRulesError extends Error {}

export interface ResignationRuleValues {
  /** One resignations file can end at most this many households. */
  maxHouseholdsPerFile: number;
  /** A file that would end this percent of the active households or more gets a loud warning. */
  warnPercentOfActive: number;
}

export interface ResignationRules {
  /** True while the numbers are placeholders. */
  placeholder: boolean;
  defaults: ResignationRuleValues;
}

const RULES: Record<keyof ResignationRuleValues, { label: string; min: number; max: number }> = {
  maxHouseholdsPerFile: { label: "maxHouseholdsPerFile (one file can end at most this many households)", min: 1, max: 500 },
  warnPercentOfActive: { label: "warnPercentOfActive (warn when a file would end this percent of the active households or more)", min: 1, max: 100 },
};

/** The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. */
export function parseResignationRules(input: unknown): ResignationRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new ResignationRulesError("The resignation rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new ResignationRulesError('The resignation rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new ResignationRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof ResignationRuleValues];
    if (!rule) throw new ResignationRulesError(`defaults: "${key}" is not a resignation rule. The resignation rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new ResignationRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new ResignationRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new ResignationRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as object) } as ResignationRuleValues };
}

/** The rules the resignations screen runs on, read and checked once. */
export const RESIGNATION_RULES: ResignationRules = parseResignationRules(raw);
