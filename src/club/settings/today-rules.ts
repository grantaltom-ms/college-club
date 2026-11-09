import type { TodayRules, TodayRuleValues } from "../types";
import raw from "./today-rules.json";

/** A mistake in the staff landing page's rules file, worded so someone editing it can fix it. */
export class TodayRulesError extends Error {}

/** The club's records keep the last 90 days of bookings (see the Postgres store), so the page cannot look back further than that. */
export const LONGEST_LOOK_BACK_DAYS = 90;

const RULES: Record<keyof TodayRuleValues, { label: string; min: number; max: number }> = {
  noVisitDays: { label: "noVisitDays (days without a completed visit before a member gets a 'first visit in a while' note)", min: 1, max: LONGEST_LOOK_BACK_DAYS },
  fewVisitsDays: { label: "fewVisitsDays (how many days back to count visits)", min: 1, max: LONGEST_LOOK_BACK_DAYS },
  fewVisitsBelow: { label: "fewVisitsBelow (fewer completed visits than this in that time gets the note)", min: 1, max: 50 },
  newMemberDays: { label: "newMemberDays (how many days a household counts as new after it joins)", min: 1, max: 365 },
  refreshSeconds: { label: "refreshSeconds (how often the page refreshes itself)", min: 30, max: 600 },
  helloAfterHistoryDays: { label: "helloAfterHistoryDays (how many days of the club's own records must exist before the 'say hello' notes show)", min: 1, max: 365 },
};

/** A day written YYYY-MM-DD that is really on the calendar (2026-02-30 is not). */
function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
}

/**
 * The rules are plain whole numbers. Unknown names are refused, so a typo in the file is caught rather than ignored. The look-backs
 * cannot be longer than the 90 days of bookings the club keeps loaded, and the page cannot be left refreshing so rarely that a
 * front-desk screen goes stale (600 seconds, ten minutes, at most).
 */
export function parseTodayRules(input: unknown): TodayRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new TodayRulesError("The Today at the Club rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new TodayRulesError('The Today at the Club rules file needs a "defaults" section.');
  const known = Object.keys(RULES);
  for (const key of known) {
    if (!(key in data.defaults)) throw new TodayRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const rule = RULES[key as keyof TodayRuleValues];
    if (!rule) throw new TodayRulesError(`defaults: "${key}" is not a Today at the Club rule. The rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new TodayRulesError(`defaults, ${rule.label} must be a whole number.`);
    if (value < rule.min) throw new TodayRulesError(`defaults, ${rule.label} must be ${rule.min} or more.`);
    if (value > rule.max) throw new TodayRulesError(`defaults, ${rule.label} cannot be more than ${rule.max}.`);
  }
  const start = (input as { historyStartsOn?: unknown }).historyStartsOn;
  if (start === undefined) throw new TodayRulesError('The Today at the Club rules file needs "historyStartsOn": a day like 2026-12-01, or null while the switch-on day is not set.');
  if (start !== null && (typeof start !== "string" || !isRealDay(start))) throw new TodayRulesError('historyStartsOn must be a real day written like 2026-12-01, or null while the switch-on day is not set.');
  return { placeholder: data.placeholder !== false, historyStartsOn: start, defaults: { ...(data.defaults as unknown as TodayRuleValues) } };
}

/** The rules the staff landing page runs on, read and checked once. */
export const TODAY_RULES: TodayRules = parseTodayRules(raw);
