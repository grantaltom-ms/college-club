import { describe, expect, it } from "vitest";
import raw from "./login-rules.json";
import { LOGIN_RULES, LoginRulesError, parseLoginRules } from "./login-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the login rules file", () => {
  it("is read, checked and marked as placeholders", () => {
    expect(LOGIN_RULES.placeholder).toBe(true);
    expect(LOGIN_RULES.defaults).toEqual({ linkMinutes: 15, sessionDays: 30, linksPerHourPerEmail: 5 });
  });

  it("refuses an empty file, a missing section and a missing rule, in words", () => {
    expect(() => parseLoginRules(null)).toThrow("The login rules file is empty.");
    expect(() => parseLoginRules({})).toThrow('needs a "defaults" section');
    const rest: Record<string, unknown> = { ...raw.defaults };
    delete rest.sessionDays;
    expect(() => parseLoginRules({ defaults: rest })).toThrow('defaults is missing "sessionDays"');
  });

  it("refuses a typo in a rule name instead of ignoring it", () => {
    expect(() => parseLoginRules(withDefaults({ linkMinuts: 10 }))).toThrow('"linkMinuts" is not a login rule');
  });

  it("refuses numbers that are not whole, too small or too large, saying which", () => {
    expect(() => parseLoginRules(withDefaults({ linkMinutes: 7.5 }))).toThrow("linkMinutes (a sign-in link works for this many minutes) must be a whole number");
    expect(() => parseLoginRules(withDefaults({ linkMinutes: "15" }))).toThrow("must be a whole number");
    expect(() => parseLoginRules(withDefaults({ linkMinutes: 4 }))).toThrow("must be at least 5");
    expect(() => parseLoginRules(withDefaults({ linkMinutes: 61 }))).toThrow("cannot be more than 60");
    expect(() => parseLoginRules(withDefaults({ sessionDays: 0 }))).toThrow("must be at least 1");
    expect(() => parseLoginRules(withDefaults({ sessionDays: 91 }))).toThrow("cannot be more than 90");
    expect(() => parseLoginRules(withDefaults({ linksPerHourPerEmail: 0 }))).toThrow("must be at least 1");
    expect(() => parseLoginRules(withDefaults({ linksPerHourPerEmail: 21 }))).toThrow("cannot be more than 20");
    expect(() => parseLoginRules(withDefaults({ linkMinutes: 4 }))).toThrow(LoginRulesError);
  });

  it("accepts the edges", () => {
    expect(parseLoginRules(withDefaults({ linkMinutes: 5, sessionDays: 1, linksPerHourPerEmail: 1 })).defaults).toEqual({ linkMinutes: 5, sessionDays: 1, linksPerHourPerEmail: 1 });
    expect(parseLoginRules(withDefaults({ linkMinutes: 60, sessionDays: 90, linksPerHourPerEmail: 20 })).defaults).toEqual({ linkMinutes: 60, sessionDays: 90, linksPerHourPerEmail: 20 });
  });
});
