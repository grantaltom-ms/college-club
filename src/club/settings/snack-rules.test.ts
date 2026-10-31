import { describe, expect, it } from "vitest";
import raw from "./snack-rules.json";
import { SNACK_RULES, SnackRulesError, parseSnackRules } from "./snack-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the snack bar rules file", () => {
  it("is read, still marked as placeholders, and has every rule, with every snack $1.50", () => {
    expect(SNACK_RULES.placeholder).toBe(true);
    expect(SNACK_RULES.defaults).toEqual({ priceCents: 150, itemsPerEntryMax: 20, itemsPerDayMax: 40, thankYouSeconds: 8, idleSeconds: 30 });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { idleSeconds: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseSnackRules({ ...raw, defaults: rest })).toThrow('defaults is missing "idleSeconds".');
    expect(() => parseSnackRules(withDefaults({ priceCent: 150 }))).toThrow('"priceCent" is not a snack bar rule');
    expect(() => parseSnackRules(withDefaults({ priceCents: 1.5 }))).toThrow("must be a whole number");
    expect(() => parseSnackRules(withDefaults({ priceCents: "150" }))).toThrow("must be a whole number");
    expect(() => parseSnackRules(withDefaults({ priceCents: 0 }))).toThrow("must be 1 or more");
    expect(() => parseSnackRules(withDefaults({ priceCents: 100_001 }))).toThrow("cannot be more than 100,000");
    expect(() => parseSnackRules(withDefaults({ itemsPerEntryMax: 0 }))).toThrow("must be 1 or more");
    expect(() => parseSnackRules(withDefaults({ itemsPerEntryMax: 101 }))).toThrow("cannot be more than 100");
    expect(() => parseSnackRules(withDefaults({ itemsPerDayMax: 501 }))).toThrow("cannot be more than 500");
    expect(() => parseSnackRules(withDefaults({ thankYouSeconds: 1 }))).toThrow("must be 2 or more");
    expect(() => parseSnackRules(withDefaults({ thankYouSeconds: 61 }))).toThrow("cannot be more than 60");
    expect(() => parseSnackRules(withDefaults({ idleSeconds: 9 }))).toThrow("must be 10 or more");
    expect(() => parseSnackRules(withDefaults({ idleSeconds: 601 }))).toThrow("cannot be more than 600");
    expect(() => parseSnackRules(null)).toThrow(SnackRulesError);
    expect(() => parseSnackRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("refuses a day's limit smaller than one press's limit, and accepts them equal", () => {
    expect(() => parseSnackRules(withDefaults({ itemsPerEntryMax: 20, itemsPerDayMax: 19 }))).toThrow("itemsPerDayMax (19) cannot be less than itemsPerEntryMax (20)");
    expect(parseSnackRules(withDefaults({ itemsPerEntryMax: 20, itemsPerDayMax: 20 })).defaults.itemsPerDayMax).toBe(20);
  });

  it("accepts the smallest and largest values", () => {
    expect(parseSnackRules(withDefaults({ priceCents: 1, itemsPerEntryMax: 1, itemsPerDayMax: 1, thankYouSeconds: 2, idleSeconds: 10 })).defaults.priceCents).toBe(1);
    expect(parseSnackRules(withDefaults({ priceCents: 100_000, itemsPerEntryMax: 100, itemsPerDayMax: 500, thankYouSeconds: 60, idleSeconds: 600 })).defaults.itemsPerDayMax).toBe(500);
  });

  it("is not placeholder once the file says so, and stays one when it says nothing", () => {
    expect(parseSnackRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _p, ...noFlag } = raw;
    void _p;
    expect(parseSnackRules(noFlag).placeholder).toBe(true);
  });
});
