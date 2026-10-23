import { describe, expect, it } from "vitest";
import raw from "./event-rules.json";
import { EVENT_RULES, EventRulesError, parseEventRules } from "./event-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the event rules file", () => {
  it("is read, marked as placeholders, and has every rule", () => {
    expect(EVENT_RULES.placeholder).toBe(true);
    expect(Object.keys(EVENT_RULES.defaults).sort()).toEqual(["cancelCutoffMinutes", "closeMinutesBefore", "maxGuests", "promoteUntilMinutesBefore", "waitlistHoldMinutes", "waitlistMax"]);
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { maxGuests: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseEventRules({ ...raw, defaults: rest })).toThrow('defaults is missing "maxGuests".');
    expect(() => parseEventRules(withDefaults({ maxGuest: 3 }))).toThrow('"maxGuest" is not an event rule');
    expect(() => parseEventRules(withDefaults({ maxGuests: 2.5 }))).toThrow("maxGuests (most guests on one RSVP; 0 for none) must be a whole number.");
    expect(() => parseEventRules(withDefaults({ waitlistMax: -1 }))).toThrow("must be 0 or more");
    expect(() => parseEventRules(withDefaults({ maxGuests: 50 }))).toThrow("cannot be more than 20");
    expect(() => parseEventRules(null)).toThrow(EventRulesError);
  });

  it("allows no waiting list, no guests, and a waiting place that never runs out", () => {
    expect(parseEventRules(withDefaults({ waitlistMax: 0, maxGuests: 0, waitlistHoldMinutes: 0 })).defaults).toMatchObject({ waitlistMax: 0, maxGuests: 0, waitlistHoldMinutes: 0 });
  });
});
