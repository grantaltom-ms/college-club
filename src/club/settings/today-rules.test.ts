import { describe, expect, it } from "vitest";
import { DEFAULT_HISTORY_DAYS } from "../store/postgres";
import raw from "./today-rules.json";
import { LONGEST_LOOK_BACK_DAYS, TODAY_RULES, TodayRulesError, parseTodayRules } from "./today-rules";

const withDefaults = (change: Record<string, unknown>) => ({ ...raw, defaults: { ...raw.defaults, ...change } });

describe("the Today at the Club rules file", () => {
  it("is read, still marked as placeholders, and holds Grant's numbers: 60 days, fewer than 2 in 90, new within 30, notes after 90 days of records", () => {
    expect(TODAY_RULES.placeholder).toBe(true);
    expect(TODAY_RULES.defaults).toEqual({ noVisitDays: 60, fewVisitsDays: 90, fewVisitsBelow: 2, newMemberDays: 30, refreshSeconds: 120, helloAfterHistoryDays: 90 });
  });

  it("has no day for the records to have begun yet, so the notes stay off on a real server until someone sets it", () => {
    expect(TODAY_RULES.historyStartsOn).toBeNull();
  });

  it("refreshes at least every few minutes", () => {
    expect(TODAY_RULES.defaults.refreshSeconds).toBeLessThanOrEqual(300);
  });

  it("cannot look back further than the bookings the Postgres store keeps loaded", () => {
    expect(LONGEST_LOOK_BACK_DAYS).toBe(DEFAULT_HISTORY_DAYS);
    expect(TODAY_RULES.defaults.fewVisitsDays).toBeLessThanOrEqual(DEFAULT_HISTORY_DAYS);
    expect(TODAY_RULES.defaults.noVisitDays).toBeLessThanOrEqual(DEFAULT_HISTORY_DAYS);
  });

  it("refuses a missing, misspelled or nonsense rule in words", () => {
    const { refreshSeconds: _omit, ...rest } = raw.defaults;
    void _omit;
    expect(() => parseTodayRules({ ...raw, defaults: rest })).toThrow('defaults is missing "refreshSeconds".');
    expect(() => parseTodayRules(withDefaults({ noVisitDay: 60 }))).toThrow('"noVisitDay" is not a Today at the Club rule');
    expect(() => parseTodayRules(withDefaults({ noVisitDays: 59.5 }))).toThrow("must be a whole number");
    expect(() => parseTodayRules(withDefaults({ noVisitDays: "60" }))).toThrow("must be a whole number");
    expect(() => parseTodayRules(withDefaults({ noVisitDays: 0 }))).toThrow("must be 1 or more");
    expect(() => parseTodayRules(withDefaults({ noVisitDays: 91 }))).toThrow("cannot be more than 90");
    expect(() => parseTodayRules(withDefaults({ fewVisitsDays: 0 }))).toThrow("must be 1 or more");
    expect(() => parseTodayRules(withDefaults({ fewVisitsDays: 91 }))).toThrow("cannot be more than 90");
    expect(() => parseTodayRules(withDefaults({ fewVisitsBelow: 0 }))).toThrow("must be 1 or more");
    expect(() => parseTodayRules(withDefaults({ fewVisitsBelow: 51 }))).toThrow("cannot be more than 50");
    expect(() => parseTodayRules(withDefaults({ newMemberDays: 0 }))).toThrow("must be 1 or more");
    expect(() => parseTodayRules(withDefaults({ newMemberDays: 366 }))).toThrow("cannot be more than 365");
    expect(() => parseTodayRules(withDefaults({ refreshSeconds: 29 }))).toThrow("must be 30 or more");
    expect(() => parseTodayRules(withDefaults({ refreshSeconds: 601 }))).toThrow("cannot be more than 600");
    expect(() => parseTodayRules(withDefaults({ helloAfterHistoryDays: 0 }))).toThrow("must be 1 or more");
    expect(() => parseTodayRules(withDefaults({ helloAfterHistoryDays: 366 }))).toThrow("cannot be more than 365");
    expect(() => parseTodayRules(withDefaults({ helloAfterHistoryDays: 90.5 }))).toThrow("must be a whole number");
    const { helloAfterHistoryDays: _h, ...noHello } = raw.defaults;
    void _h;
    expect(() => parseTodayRules({ ...raw, defaults: noHello })).toThrow('defaults is missing "helloAfterHistoryDays".');
    expect(() => parseTodayRules(null)).toThrow(TodayRulesError);
    expect(() => parseTodayRules({ ...raw, defaults: undefined })).toThrow('needs a "defaults" section');
  });

  it("reads the day the records began: a real day, or null while it is not set, and refuses anything else in words", () => {
    expect(parseTodayRules({ ...raw, historyStartsOn: "2026-12-01" }).historyStartsOn).toBe("2026-12-01");
    expect(parseTodayRules({ ...raw, historyStartsOn: "2028-02-29" }).historyStartsOn).toBe("2028-02-29"); // a real leap day
    expect(parseTodayRules({ ...raw, historyStartsOn: null }).historyStartsOn).toBeNull();
    const { historyStartsOn: _s, ...missing } = raw;
    void _s;
    expect(() => parseTodayRules(missing)).toThrow('needs "historyStartsOn"');
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-5", "12/01/2026", "2026-12-01T00:00:00Z", " 2026-12-01", "", "tomorrow", 20261201, true]) {
      expect(() => parseTodayRules({ ...raw, historyStartsOn: bad }), String(bad)).toThrow("historyStartsOn must be a real day");
    }
  });

  it("accepts the smallest and largest values", () => {
    expect(parseTodayRules(withDefaults({ noVisitDays: 1, fewVisitsDays: 1, fewVisitsBelow: 1, newMemberDays: 1, refreshSeconds: 30, helloAfterHistoryDays: 1 })).defaults.refreshSeconds).toBe(30);
    expect(parseTodayRules(withDefaults({ noVisitDays: 90, fewVisitsDays: 90, fewVisitsBelow: 50, newMemberDays: 365, refreshSeconds: 600, helloAfterHistoryDays: 365 })).defaults.helloAfterHistoryDays).toBe(365);
  });

  it("is not placeholder once the file says so, and stays one when it says nothing", () => {
    expect(parseTodayRules({ ...raw, placeholder: false }).placeholder).toBe(false);
    const { placeholder: _p, ...noFlag } = raw;
    void _p;
    expect(parseTodayRules(noFlag).placeholder).toBe(true);
  });
});
