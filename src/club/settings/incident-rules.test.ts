import { describe, expect, it } from "vitest";
import raw from "./incident-rules.json";
import { INCIDENT_RULES, IncidentRulesError, parseIncidentRules } from "./incident-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the incident report rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(INCIDENT_RULES.placeholder).toBe(true);
    expect(INCIDENT_RULES.defaults).toEqual({
      maxDaysBack: 90,
      maxPeople: 20,
      maxBoats: 10,
      whatHappenedMax: 1500,
      locationMax: 200,
      conditionsMax: 300,
      firstAidMax: 300,
      emergencyMax: 200,
      personNameMax: 120,
      causeMax: 1000,
      changeMax: 1000,
      followUpByMax: 80,
      noteMax: 1000,
      closingNoteMax: 1000,
    });
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { noteMax: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseIncidentRules({ ...raw, defaults: rest })).toThrow('defaults is missing "noteMax".');
    expect(() => parseIncidentRules(withDefaults({ noteMaximum: 5 }))).toThrow('"noteMaximum" is not an incident report rule');
    expect(() => parseIncidentRules(withDefaults({ maxPeople: 20.5 }))).toThrow("must be a whole number");
    expect(() => parseIncidentRules(withDefaults({ maxPeople: "20" }))).toThrow("must be a whole number");
    expect(() => parseIncidentRules(withDefaults({ maxDaysBack: 0 }))).toThrow("must be at least 1");
    expect(() => parseIncidentRules(withDefaults({ maxDaysBack: 731 }))).toThrow("cannot be more than 730");
    expect(() => parseIncidentRules(withDefaults({ maxPeople: 0 }))).toThrow("must be at least 1");
    expect(() => parseIncidentRules(withDefaults({ maxPeople: 101 }))).toThrow("cannot be more than 100");
    expect(() => parseIncidentRules(withDefaults({ maxBoats: 51 }))).toThrow("cannot be more than 50");
    expect(() => parseIncidentRules(withDefaults({ whatHappenedMax: 99 }))).toThrow("must be at least 100");
    expect(() => parseIncidentRules(withDefaults({ whatHappenedMax: 3001 }))).toThrow("cannot be more than 3000");
    expect(() => parseIncidentRules(withDefaults({ locationMax: 401 }))).toThrow("cannot be more than 400");
    expect(() => parseIncidentRules(withDefaults({ personNameMax: 121 }))).toThrow("cannot be more than 120");
    expect(() => parseIncidentRules(withDefaults({ closingNoteMax: 2001 }))).toThrow("cannot be more than 2000");
    expect(() => parseIncidentRules(null)).toThrow(IncidentRulesError);
    expect(() => parseIncidentRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("accepts the smallest and largest values", () => {
    const smallest = { maxDaysBack: 1, maxPeople: 1, maxBoats: 1, whatHappenedMax: 100, locationMax: 20, conditionsMax: 20, firstAidMax: 20, emergencyMax: 20, personNameMax: 20, causeMax: 50, changeMax: 50, followUpByMax: 10, noteMax: 50, closingNoteMax: 50 };
    expect(parseIncidentRules(withDefaults(smallest)).defaults).toMatchObject(smallest);
    const largest = { maxDaysBack: 730, maxPeople: 100, maxBoats: 50, whatHappenedMax: 3000, locationMax: 400, conditionsMax: 600, firstAidMax: 600, emergencyMax: 400, personNameMax: 120, causeMax: 2000, changeMax: 2000, followUpByMax: 120, noteMax: 1000, closingNoteMax: 2000 };
    expect(parseIncidentRules(withDefaults(largest)).defaults).toMatchObject(largest);
  });

  it("stays marked as a placeholder unless the file says otherwise", () => {
    expect(parseIncidentRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _omit, ...noFlag } = raw;
    void _omit;
    expect(parseIncidentRules(noFlag).placeholder).toBe(true);
  });
});
