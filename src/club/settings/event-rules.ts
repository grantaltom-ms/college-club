import type { EventRules, EventRuleValues } from "../types";
import raw from "./event-rules.json";

/** A mistake in the event rules file, worded so someone editing it can fix it. */
export class EventRulesError extends Error {}

/** What each rule is. Unknown names are refused, so a typo in the file is caught rather than ignored. */
const RULES: Record<keyof EventRuleValues, string> = {
  closeMinutesBefore: "closeMinutesBefore (RSVP closes)",
  cancelCutoffMinutes: "cancelCutoffMinutes (latest cancel without penalty)",
  promoteUntilMinutesBefore: "promoteUntilMinutesBefore (waiting list moves up until)",
  waitlistMax: "waitlistMax (longest waiting list; 0 for none)",
  waitlistHoldMinutes: "waitlistHoldMinutes (a waiting place is removed this long after the last button press; 0 for never)",
  maxGuests: "maxGuests (most guests on one RSVP; 0 for none)",
};

export function parseEventRules(input: unknown): EventRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new EventRulesError("The event rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new EventRulesError('The event rules file needs a "defaults" section.');
  for (const key of Object.keys(RULES)) {
    if (!(key in data.defaults)) throw new EventRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const label = RULES[key as keyof EventRuleValues];
    if (!label) throw new EventRulesError(`defaults: "${key}" is not an event rule. The event rules are: ${Object.keys(RULES).join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new EventRulesError(`defaults, ${label} must be a whole number.`);
    if (value < 0) throw new EventRulesError(`defaults, ${label} must be 0 or more.`);
  }
  const defaults = data.defaults as unknown as EventRuleValues;
  if (defaults.maxGuests > 20) throw new EventRulesError(`defaults, ${RULES.maxGuests} cannot be more than 20.`);
  return { placeholder: data.placeholder !== false, defaults };
}

/** The rules the event screens and checks run on, read and checked once. */
export const EVENT_RULES: EventRules = parseEventRules(raw);
