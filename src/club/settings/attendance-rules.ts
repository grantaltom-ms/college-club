import { BOOKING_TYPES, type AttendanceRules, type AttendanceRuleValues, type BookingType } from "../types";
import raw from "./attendance-rules.json";

/** A mistake in the attendance rules file, worded so someone editing it can fix it. */
export class AttendanceRulesError extends Error {}

/** The rules that are plain numbers of minutes. Unknown names are refused, so a typo in the file is caught rather than ignored. */
const NUMBERS: Record<Exclude<keyof AttendanceRuleValues, "checkInNotNeededFor">, string> = {
  checkInOpensMinutesBefore: "checkInOpensMinutesBefore (check-in opens this long before the start)",
  noShowAfterEndMinutes: "noShowAfterEndMinutes (an unchecked booking or chair becomes a no-show this long after it ends; 0 for the moment it ends)",
};
const LIST = "checkInNotNeededFor";

const LARGEST = 24 * 60;

export function parseAttendanceRules(input: unknown): AttendanceRules {
  const data = input as { placeholder?: unknown; defaults?: Record<string, unknown> };
  if (!data || typeof data !== "object") throw new AttendanceRulesError("The attendance rules file is empty.");
  if (!data.defaults || typeof data.defaults !== "object") throw new AttendanceRulesError('The attendance rules file needs a "defaults" section.');
  const known = [...Object.keys(NUMBERS), LIST];
  for (const key of known) {
    if (!(key in data.defaults)) throw new AttendanceRulesError(`defaults is missing "${key}".`);
  }
  for (const [key, value] of Object.entries(data.defaults)) {
    if (key === LIST) continue;
    const label = NUMBERS[key as keyof typeof NUMBERS];
    if (!label) throw new AttendanceRulesError(`defaults: "${key}" is not an attendance rule. The attendance rules are: ${known.join(", ")}.`);
    if (typeof value !== "number" || !Number.isInteger(value)) throw new AttendanceRulesError(`defaults, ${label} must be a whole number.`);
    if (value < 0) throw new AttendanceRulesError(`defaults, ${label} must be 0 or more.`);
    if (value > LARGEST) throw new AttendanceRulesError(`defaults, ${label} cannot be more than ${LARGEST} (one day).`);
  }
  const list = data.defaults[LIST];
  if (!Array.isArray(list)) throw new AttendanceRulesError(`defaults, ${LIST} (kinds of booking that need no check-in) must be a list, such as ["Room Space"], or [] for none.`);
  for (const type of list) {
    if (typeof type !== "string" || !(BOOKING_TYPES as readonly string[]).includes(type)) {
      throw new AttendanceRulesError(`defaults, ${LIST}: "${String(type)}" is not a kind of booking. The kinds are: ${BOOKING_TYPES.join(", ")}.`);
    }
  }
  if (new Set(list).size !== list.length) throw new AttendanceRulesError(`defaults, ${LIST} names the same kind of booking twice.`);
  return { placeholder: data.placeholder !== false, defaults: { ...(data.defaults as object), [LIST]: list as BookingType[] } as AttendanceRuleValues };
}

/** The rules the check-in screens and the automatic no-show run on, read and checked once. */
export const ATTENDANCE_RULES: AttendanceRules = parseAttendanceRules(raw);
