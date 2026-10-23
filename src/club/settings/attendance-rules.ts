import type { AttendanceRules, AttendanceRuleValues } from "../types";
import raw from "./attendance-rules.json";

/** A mistake in the attendance rules file, worded so someone editing it can fix it. */
export class AttendanceRulesError extends Error {}

/** What each rule is. Unknown names are refused, so a typo in the file is caught rather than ignored. */
const RULES: Record<keyof AttendanceRuleValues, string> = {
  checkInOpensMinutesBefore: "checkInOpensMinutesBefore (check-in opens this long before the start)",
  noShowAfterEndMinutes: "noShowAfterEndMinutes (an unchecked booking or chair becomes a no-show this long after it ends; 0 for the moment it ends)",
};

const LARGEST = 24 * 60;

export function parseAttendanceRules(input: unknown): AttendanceRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new AttendanceRulesError("The attendance rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new AttendanceRulesError('The attendance rules file needs a "defaults" section.');
  for (const key of Object.keys(RULES)) {
    if (!(key in data.defaults)) throw new AttendanceRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    const label = RULES[key as keyof AttendanceRuleValues];
    if (!label) throw new AttendanceRulesError(`defaults: "${key}" is not an attendance rule. The attendance rules are: ${Object.keys(RULES).join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new AttendanceRulesError(`defaults, ${label} must be a whole number.`);
    if (value < 0) throw new AttendanceRulesError(`defaults, ${label} must be 0 or more.`);
    if (value > LARGEST) throw new AttendanceRulesError(`defaults, ${label} cannot be more than ${LARGEST} (one day).`);
  }
  return { placeholder: data.placeholder !== false, defaults: data.defaults as unknown as AttendanceRuleValues };
}

/** The rules the check-in screens and the automatic no-show run on, read and checked once. */
export const ATTENDANCE_RULES: AttendanceRules = parseAttendanceRules(raw);
