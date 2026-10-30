import type { DamageRules, DamageRuleValues } from "../types";
import raw from "./damage-rules.json";

/** A mistake in the damage report rules file, worded so someone editing it can fix it. */
export class DamageRulesError extends Error {}

const RULES: Record<keyof DamageRuleValues, { label: string; min: number; max: number }> = {
  filedPerMemberPerDay: { label: "filedPerMemberPerDay (the most reports one member can file in 24 hours; 0 means no limit)", min: 0, max: 200 },
  majorPriority: { label: "majorPriority (the priority a major report starts with, 1 is the most urgent)", min: 1, max: 4 },
  minorPriority: { label: "minorPriority (the priority a minor report starts with, 1 is the most urgent)", min: 1, max: 4 },
  descriptionMax: { label: "descriptionMax (the longest 'what is wrong' text)", min: 20, max: 1000 },
  locationMax: { label: "locationMax (the longest 'where on the boat' text)", min: 10, max: 300 },
  howMax: { label: "howMax (the longest 'how it happened' text)", min: 20, max: 1000 },
  noteMax: { label: "noteMax (the longest note on a report)", min: 20, max: 1000 },
  assignedToMax: { label: "assignedToMax (the longest 'who is fixing it' text)", min: 10, max: 120 },
  repairedByMax: { label: "repairedByMax (the longest 'repaired by' text)", min: 10, max: 120 },
  repairNotesMax: { label: "repairNotesMax (the longest repair notes)", min: 20, max: 2000 },
  dismissReasonMax: { label: "dismissReasonMax (the longest reason for dismissing a report)", min: 20, max: 200 },
};

/**
 * The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. A major report
 * can never start less urgent than a minor one (a smaller number is more urgent).
 */
export function parseDamageRules(input: unknown): DamageRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new DamageRulesError("The damage report rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new DamageRulesError('The damage report rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new DamageRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof DamageRuleValues];
    if (!rule) throw new DamageRulesError(`defaults: "${key}" is not a damage report rule. The damage report rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new DamageRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new DamageRulesError(`defaults, ${rule.label} must be at least ${rule.min}.`);
    if (value > rule.max) throw new DamageRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  const d = data.defaults as unknown as DamageRuleValues;
  if (d.majorPriority > d.minorPriority) {
    throw new DamageRulesError(`defaults, majorPriority (${d.majorPriority}) cannot be less urgent than minorPriority (${d.minorPriority}). A smaller number is more urgent.`);
  }
  return { placeholder: data.placeholder !== false, defaults: { ...d } };
}

/** The rules damage reports run on, read and checked once. */
export const DAMAGE_RULES: DamageRules = parseDamageRules(raw);
