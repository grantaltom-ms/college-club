import { describe, expect, it } from "vitest";
import raw from "./damage-rules.json";
import { DAMAGE_RULES, DamageRulesError, parseDamageRules } from "./damage-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the damage report rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(DAMAGE_RULES.placeholder).toBe(true);
    expect(DAMAGE_RULES.defaults).toEqual({
      filedPerMemberPerDay: 10,
      majorPriority: 1,
      minorPriority: 3,
      descriptionMax: 300,
      locationMax: 120,
      howMax: 500,
      noteMax: 500,
      assignedToMax: 80,
      repairedByMax: 80,
      repairNotesMax: 1000,
      dismissReasonMax: 200,
    });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { howMax: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseDamageRules({ ...raw, defaults: rest })).toThrow('defaults is missing "howMax".');
    expect(() => parseDamageRules(withDefaults({ howMaximum: 5 }))).toThrow('"howMaximum" is not a damage report rule');
    expect(() => parseDamageRules(withDefaults({ descriptionMax: 300.5 }))).toThrow("must be a whole number");
    expect(() => parseDamageRules(withDefaults({ descriptionMax: "300" }))).toThrow("must be a whole number");
    expect(() => parseDamageRules(withDefaults({ filedPerMemberPerDay: -1 }))).toThrow("must be at least 0");
    expect(() => parseDamageRules(withDefaults({ filedPerMemberPerDay: 201 }))).toThrow("cannot be more than 200");
    expect(() => parseDamageRules(withDefaults({ majorPriority: 0 }))).toThrow("must be at least 1");
    expect(() => parseDamageRules(withDefaults({ minorPriority: 5 }))).toThrow("cannot be more than 4");
    expect(() => parseDamageRules(withDefaults({ descriptionMax: 19 }))).toThrow("must be at least 20");
    expect(() => parseDamageRules(withDefaults({ descriptionMax: 1001 }))).toThrow("cannot be more than 1000");
    expect(() => parseDamageRules(withDefaults({ locationMax: 301 }))).toThrow("cannot be more than 300");
    expect(() => parseDamageRules(withDefaults({ dismissReasonMax: 201 }))).toThrow("cannot be more than 200");
    expect(() => parseDamageRules(null)).toThrow(DamageRulesError);
    expect(() => parseDamageRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("accepts a limit of 0 (no limit) and the smallest and largest values", () => {
    expect(parseDamageRules(withDefaults({ filedPerMemberPerDay: 0 })).defaults.filedPerMemberPerDay).toBe(0);
    expect(parseDamageRules(withDefaults({ filedPerMemberPerDay: 200 })).defaults.filedPerMemberPerDay).toBe(200);
    const smallest = { descriptionMax: 20, locationMax: 10, howMax: 20, noteMax: 20, assignedToMax: 10, repairedByMax: 10, repairNotesMax: 20, dismissReasonMax: 20, majorPriority: 1, minorPriority: 1 };
    expect(parseDamageRules(withDefaults(smallest)).defaults).toMatchObject(smallest);
    const largest = { descriptionMax: 1000, locationMax: 300, howMax: 1000, noteMax: 1000, assignedToMax: 120, repairedByMax: 120, repairNotesMax: 2000, dismissReasonMax: 200, majorPriority: 4, minorPriority: 4 };
    expect(parseDamageRules(withDefaults(largest)).defaults).toMatchObject(largest);
  });

  it("will not let a major report start less urgent than a minor one", () => {
    expect(() => parseDamageRules(withDefaults({ majorPriority: 3, minorPriority: 2 }))).toThrow("majorPriority (3) cannot be less urgent than minorPriority (2). A smaller number is more urgent.");
    expect(parseDamageRules(withDefaults({ majorPriority: 2, minorPriority: 2 })).defaults.majorPriority).toBe(2);
  });

  it("stays marked as a placeholder unless the file says otherwise", () => {
    expect(parseDamageRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _omit, ...noFlag } = raw;
    void _omit;
    expect(parseDamageRules(noFlag).placeholder).toBe(true);
  });
});
