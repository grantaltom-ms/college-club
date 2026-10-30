import { describe, expect, it } from "vitest";
import raw from "./tour-rules.json";
import { TOUR_RULES, TourRulesError, parseTourRules } from "./tour-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the tour request rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(TOUR_RULES.placeholder).toBe(true);
    expect(TOUR_RULES.defaults).toEqual({ maxPerEmailPerDay: 3, maxPerHour: 30, listLimit: 100 });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { maxPerHour: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseTourRules({ ...raw, defaults: rest })).toThrow('defaults is missing "maxPerHour".');
    expect(() => parseTourRules(withDefaults({ maxPerDay: 5 }))).toThrow('"maxPerDay" is not a tour request rule');
    expect(() => parseTourRules(withDefaults({ maxPerEmailPerDay: 2.5 }))).toThrow("must be a whole number");
    expect(() => parseTourRules(withDefaults({ maxPerEmailPerDay: "3" }))).toThrow("must be a whole number");
    expect(() => parseTourRules(withDefaults({ maxPerEmailPerDay: 0 }))).toThrow("must be at least 1");
    expect(() => parseTourRules(withDefaults({ maxPerEmailPerDay: 21 }))).toThrow("cannot be more than 20");
    expect(() => parseTourRules(withDefaults({ maxPerHour: 0 }))).toThrow("must be at least 1");
    expect(() => parseTourRules(withDefaults({ maxPerHour: 1001 }))).toThrow("cannot be more than 1000");
    expect(() => parseTourRules(withDefaults({ listLimit: 9 }))).toThrow("must be at least 10");
    expect(() => parseTourRules(withDefaults({ listLimit: 501 }))).toThrow("cannot be more than 500");
    expect(() => parseTourRules(null)).toThrow(TourRulesError);
    expect(() => parseTourRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("accepts the smallest and largest values", () => {
    expect(parseTourRules(withDefaults({ maxPerEmailPerDay: 1, maxPerHour: 1, listLimit: 10 })).defaults).toEqual({ maxPerEmailPerDay: 1, maxPerHour: 1, listLimit: 10 });
    expect(parseTourRules(withDefaults({ maxPerEmailPerDay: 20, maxPerHour: 1000, listLimit: 500 })).defaults).toEqual({ maxPerEmailPerDay: 20, maxPerHour: 1000, listLimit: 500 });
  });

  it("stays marked as a placeholder unless the file says otherwise", () => {
    expect(parseTourRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _omit, ...noFlag } = raw;
    void _omit;
    expect(parseTourRules(noFlag).placeholder).toBe(true);
  });
});
