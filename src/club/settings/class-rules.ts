import { clockToMinutes } from "../time";
import type { ClassRules, ClassRuleValues, ClassTemplate } from "../types";
import raw from "./class-rules.json";

/** A mistake in the class rules file, worded so someone editing it can fix it. */
export class ClassRulesError extends Error {}

type Kind = "count" | "gap" | "clock";
/** What each rule is. Unknown names are refused, so a typo in the file is caught rather than ignored. */
const RULES: Record<keyof ClassRuleValues, { kind: Kind; label: string }> = {
  signUpDaysAhead: { kind: "count", label: "signUpDaysAhead (how many days ahead)" },
  opensAt: { kind: "clock", label: "opensAt (when a new day opens)" },
  closeMinutesBefore: { kind: "gap", label: "closeMinutesBefore (sign-up closes)" },
  cancelCutoffMinutes: { kind: "gap", label: "cancelCutoffMinutes (latest leave without penalty)" },
  promoteUntilMinutesBefore: { kind: "gap", label: "promoteUntilMinutesBefore (waiting list moves up until)" },
  waitlistMax: { kind: "gap", label: "waitlistMax (longest waiting list; 0 for none)" },
  maxUpcomingPerMember: { kind: "count", label: "maxUpcomingPerMember (sign-ups held at once)" },
  maxPerDayPerMember: { kind: "count", label: "maxPerDayPerMember (sign-ups per day)" },
};

function checkOne(key: string, value: unknown, where: string): void {
  const rule = RULES[key as keyof ClassRuleValues];
  if (!rule) throw new ClassRulesError(`${where}: "${key}" is not a class rule. The class rules are: ${Object.keys(RULES).join(", ")}.`);
  const at = `${where}, ${rule.label}`;
  if (rule.kind === "clock") {
    if (typeof value !== "string") throw new ClassRulesError(`${at} must be a time in quotes like "00:00".`);
    try {
      if (clockToMinutes(value) >= 1440) throw new Error("must be before 24:00");
    } catch (e) {
      throw new ClassRulesError(`${at}: ${(e as Error).message}`);
    }
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ClassRulesError(`${at} must be a whole number.`);
  if (value < (rule.kind === "gap" ? 0 : 1)) throw new ClassRulesError(`${at} must be ${rule.kind === "gap" ? "0 or more" : "1 or more"}.`);
}

/** Checks the rules that only make sense together. */
export function checkClassRuleValues(v: ClassRuleValues, where: string): void {
  if (v.maxPerDayPerMember > v.maxUpcomingPerMember) {
    throw new ClassRulesError(`${where}: maxPerDayPerMember (${v.maxPerDayPerMember}) is higher than maxUpcomingPerMember (${v.maxUpcomingPerMember}), so the day limit could never be reached.`);
  }
  if (v.closeMinutesBefore > v.signUpDaysAhead * 1440) {
    throw new ClassRulesError(`${where}: closeMinutesBefore (${v.closeMinutesBefore}) is longer than the whole sign-up window (${v.signUpDaysAhead} days).`);
  }
}

/** Checks a partial set of rules (one class's) and that it still works on top of the defaults. */
export function checkClassOverrides(defaults: ClassRuleValues, overrides: Partial<ClassRuleValues>, where: string): void {
  for (const [key, value] of Object.entries(overrides)) checkOne(key, value, where);
  checkClassRuleValues({ ...defaults, ...overrides }, where);
}

export function parseClassRules(input: unknown): ClassRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new ClassRulesError("The class rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new ClassRulesError('The class rules file needs a "defaults" section.');
  for (const key of Object.keys(RULES)) {
    if (!(key in data.defaults)) throw new ClassRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) checkOne(key, value, "defaults");
  const defaults = data.defaults as unknown as ClassRuleValues;
  checkClassRuleValues(defaults, "defaults");
  return { placeholder: data.placeholder !== false, defaults };
}

/** The rules the class screens and checks run on, read and checked once. */
export const CLASS_RULES: ClassRules = parseClassRules(raw);

/** The rules that apply to one class: the defaults, then the class's own. */
export function classRulesFor(rules: ClassRules, template: Pick<ClassTemplate, "rules">): ClassRuleValues {
  return { ...rules.defaults, ...template.rules };
}
