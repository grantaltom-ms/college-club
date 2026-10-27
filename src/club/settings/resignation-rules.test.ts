import { describe, expect, it } from "vitest";
import raw from "./resignation-rules.json";
import { RESIGNATION_RULES, ResignationRulesError, parseResignationRules } from "./resignation-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the resignation rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(RESIGNATION_RULES.placeholder).toBe(true);
    expect(RESIGNATION_RULES.defaults).toEqual({ maxHouseholdsPerFile: 50, warnPercentOfActive: 25 });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { warnPercentOfActive: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseResignationRules({ ...raw, defaults: rest })).toThrow('defaults is missing "warnPercentOfActive".');
    expect(() => parseResignationRules(withDefaults({ maxHouseholds: 5 }))).toThrow('"maxHouseholds" is not a resignation rule');
    expect(() => parseResignationRules(withDefaults({ maxHouseholdsPerFile: 2.5 }))).toThrow("must be a whole number");
    expect(() => parseResignationRules(withDefaults({ maxHouseholdsPerFile: "50" }))).toThrow("must be a whole number");
    expect(() => parseResignationRules(withDefaults({ maxHouseholdsPerFile: 0 }))).toThrow("must be at least 1");
    expect(() => parseResignationRules(withDefaults({ maxHouseholdsPerFile: 501 }))).toThrow("cannot be more than 500");
    expect(() => parseResignationRules(withDefaults({ warnPercentOfActive: 0 }))).toThrow("must be at least 1");
    expect(() => parseResignationRules(withDefaults({ warnPercentOfActive: 101 }))).toThrow("cannot be more than 100");
    expect(() => parseResignationRules(null)).toThrow(ResignationRulesError);
    expect(() => parseResignationRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("accepts the smallest and largest values", () => {
    expect(parseResignationRules(withDefaults({ maxHouseholdsPerFile: 1, warnPercentOfActive: 1 })).defaults).toEqual({ maxHouseholdsPerFile: 1, warnPercentOfActive: 1 });
    expect(parseResignationRules(withDefaults({ maxHouseholdsPerFile: 500, warnPercentOfActive: 100 })).defaults).toEqual({ maxHouseholdsPerFile: 500, warnPercentOfActive: 100 });
  });

  it("stays marked as a placeholder unless the file says otherwise", () => {
    expect(parseResignationRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _omit, ...noFlag } = raw;
    void _omit;
    expect(parseResignationRules(noFlag).placeholder).toBe(true);
  });
});
