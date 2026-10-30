import { describe, expect, it } from "vitest";
import raw from "./practice-rules.json";
import { PRACTICE_RULES, PracticeRulesError, parsePracticeRules } from "./practice-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the practice rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(PRACTICE_RULES.placeholder).toBe(true);
    expect(PRACTICE_RULES.defaults).toEqual({ nameMax: 80, notesMax: 500, maxHours: 6, maxBoats: 20, daysAhead: 120, reasonMax: 200 });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { maxBoats: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parsePracticeRules({ ...raw, defaults: rest })).toThrow('defaults is missing "maxBoats".');
    expect(() => parsePracticeRules(withDefaults({ maxBoat: 5 }))).toThrow('"maxBoat" is not a practice rule');
    expect(() => parsePracticeRules(withDefaults({ maxHours: 6.5 }))).toThrow("must be a whole number");
    expect(() => parsePracticeRules(withDefaults({ maxHours: "6" }))).toThrow("must be a whole number");
    expect(() => parsePracticeRules(withDefaults({ maxHours: 0 }))).toThrow("must be at least 1");
    expect(() => parsePracticeRules(withDefaults({ maxHours: 25 }))).toThrow("cannot be more than 24");
    expect(() => parsePracticeRules(withDefaults({ nameMax: 9 }))).toThrow("must be at least 10");
    expect(() => parsePracticeRules(withDefaults({ nameMax: 201 }))).toThrow("cannot be more than 200");
    expect(() => parsePracticeRules(withDefaults({ notesMax: 2001 }))).toThrow("cannot be more than 2000");
    expect(() => parsePracticeRules(withDefaults({ maxBoats: 101 }))).toThrow("cannot be more than 100");
    expect(() => parsePracticeRules(withDefaults({ daysAhead: 731 }))).toThrow("cannot be more than 730");
    expect(() => parsePracticeRules(withDefaults({ reasonMax: 201 }))).toThrow("cannot be more than 200");
    expect(() => parsePracticeRules(null)).toThrow(PracticeRulesError);
    expect(() => parsePracticeRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("accepts the smallest and largest values", () => {
    const smallest = { nameMax: 10, notesMax: 20, maxHours: 1, maxBoats: 1, daysAhead: 1, reasonMax: 20 };
    expect(parsePracticeRules(withDefaults(smallest)).defaults).toEqual(smallest);
    const largest = { nameMax: 200, notesMax: 2000, maxHours: 24, maxBoats: 100, daysAhead: 730, reasonMax: 200 };
    expect(parsePracticeRules(withDefaults(largest)).defaults).toEqual(largest);
  });

  it("stays marked as a placeholder unless the file says otherwise", () => {
    expect(parsePracticeRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _omit, ...noFlag } = raw;
    void _omit;
    expect(parsePracticeRules(noFlag).placeholder).toBe(true);
  });
});
