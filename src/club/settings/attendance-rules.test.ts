import { describe, expect, it } from "vitest";
import raw from "./attendance-rules.json";
import { ATTENDANCE_RULES, AttendanceRulesError, parseAttendanceRules } from "./attendance-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the attendance rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(ATTENDANCE_RULES.placeholder).toBe(true);
    expect(Object.keys(ATTENDANCE_RULES.defaults).sort()).toEqual(["checkInOpensMinutesBefore", "noShowAfterEndMinutes"]);
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { noShowAfterEndMinutes: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseAttendanceRules({ ...raw, defaults: rest })).toThrow('defaults is missing "noShowAfterEndMinutes".');
    expect(() => parseAttendanceRules(withDefaults({ noShowAfterEnd: 5 }))).toThrow('"noShowAfterEnd" is not an attendance rule');
    expect(() => parseAttendanceRules(withDefaults({ checkInOpensMinutesBefore: 1.5 }))).toThrow("must be a whole number");
    expect(() => parseAttendanceRules(withDefaults({ checkInOpensMinutesBefore: -5 }))).toThrow("must be 0 or more");
    expect(() => parseAttendanceRules(withDefaults({ noShowAfterEndMinutes: 5000 }))).toThrow("cannot be more than 1440");
    expect(() => parseAttendanceRules(null)).toThrow(AttendanceRulesError);
  });

  it("allows check-in only at the start and an instant no-show", () => {
    expect(parseAttendanceRules(withDefaults({ checkInOpensMinutesBefore: 0, noShowAfterEndMinutes: 0 })).defaults).toEqual({ checkInOpensMinutesBefore: 0, noShowAfterEndMinutes: 0 });
  });
});
