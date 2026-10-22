import { describe, expect, it } from "vitest";
import { QUALIFICATIONS } from "../qualifications";
import { BOOKING_TYPES, type Item } from "../types";
import raw from "./booking-rules.json";
import { RULE_BOOK, RuleBookError, checkOverrides, classOf, parseRuleBook, rulesFor } from "./rulebook";

type Draft = { defaults?: Record<string, unknown>; classes: Record<string, unknown>[] };

const parse = (mutate: (copy: Draft) => unknown) => {
  const copy = structuredClone(raw) as unknown as Draft;
  mutate(copy);
  return () => parseRuleBook(copy, QUALIFICATIONS);
};

describe("the shipped booking rules", () => {
  it("are the placeholder values from the kickoff prompt, and say they are placeholders", () => {
    expect(RULE_BOOK.placeholder).toBe(true);
    expect(RULE_BOOK.defaults).toEqual({
      windowDays: 7,
      opensAt: "00:00",
      dayStart: "05:00",
      dayEnd: "20:00",
      slotMinutes: 30,
      minMinutes: 30,
      maxMinutes: 120,
      maxFuturePerType: 2,
      maxPerDayPerType: 1,
      cancelCutoffMinutes: 120,
      gapMinutes: 0,
    });
    expect(raw.about).toContain("PLACEHOLDER");
  });

  it("describe singles, doubles and quads by seat count, with a qualification per boat class", () => {
    const seats = Object.fromEntries(RULE_BOOK.classes.map((c) => [c.code, c.seats]));
    expect(seats).toMatchObject({ "shell-single": 1, "shell-double": 2, "shell-quad": 4 });
    expect(classOf(RULE_BOOK, { classCode: "shell-quad" }).requiredQualification).toBe("scull-3");
    expect(classOf(RULE_BOOK, { classCode: "kayak" }).requiredQualification).toBeNull();
  });

  it("cover shells, kayaks, paddle boards and a space, using only booking types the engine knows", () => {
    const types = new Set(RULE_BOOK.classes.map((c) => c.type));
    expect(types).toEqual(new Set(["Shell", "Kayak", "Paddle Board", "Dock Space"]));
    for (const t of types) expect(BOOKING_TYPES).toContain(t);
  });
});

describe("a mistake in the rules file is caught in words someone can act on", () => {
  it("refuses a misspelled rule instead of quietly ignoring it", () => {
    expect(parse((c) => (c.defaults!.maxLenght = 90))).toThrow('defaults: "maxLenght" is not a rule');
    expect(parse((c) => (c.classes[0].rules = { slotMinute: 15 }))).toThrow('"slotMinute" is not a rule');
  });

  it("refuses a missing rule, a wrong kind of value, and out-of-range numbers", () => {
    expect(parse((c) => delete c.defaults!.windowDays)).toThrow('defaults is missing "windowDays"');
    expect(parse((c) => (c.defaults!.windowDays = "7"))).toThrow("windowDays (how many days ahead) must be a whole number");
    expect(parse((c) => (c.defaults!.windowDays = 0))).toThrow("must be 1 or more");
    expect(parse((c) => (c.defaults!.gapMinutes = -5))).toThrow("must be 0 or more");
    expect(parse((c) => (c.defaults!.slotMinutes = 7.5))).toThrow("must be a whole number");
    expect(parse((c) => (c.defaults!.dayStart = "5am"))).toThrow('not a time like 05:00');
    expect(parse((c) => (c.defaults!.dayEnd = "25:00"))).toThrow("not a time between 00:00 and 24:00");
  });

  it("refuses rules that contradict each other", () => {
    expect(parse((c) => (c.defaults!.dayEnd = "04:00"))).toThrow("dayEnd (04:00) must be later than dayStart (05:00)");
    expect(parse((c) => (c.defaults!.maxMinutes = 15))).toThrow("maxMinutes (15) cannot be shorter than minMinutes (30)");
    expect(parse((c) => (c.defaults!.maxMinutes = 100))).toThrow("maxMinutes (100) must be a whole number of 30-minute slots");
    expect(parse((c) => (c.defaults!.dayEnd = "20:10"))).toThrow("must be a whole number of 30-minute slots");
    expect(parse((c) => (c.defaults!.maxPerDayPerType = 3))).toThrow("day limit could never be reached");
  });

  it("refuses a bad class: duplicate code, unknown type, bad seats, missing qualification", () => {
    expect(parse((c) => (c.classes[1].code = "shell-single"))).toThrow('the code "shell-single" is used twice');
    expect(parse((c) => (c.classes[0].type = "Canoe"))).toThrow('type "Canoe" is not one of Shell, Kayak');
    expect(parse((c) => (c.classes[0].seats = 0))).toThrow("seats must be a whole number from 1 to 12");
    expect(parse((c) => (c.classes[0].requiredQualification = "scull-9"))).toThrow('the qualification "scull-9" does not exist');
    expect(parse((c) => (c.classes = []))).toThrow('needs a "classes" list');
  });

  it("refuses a class override that breaks the rules once combined with the defaults", () => {
    expect(parse((c) => (c.classes[0].rules = { maxMinutes: 45 }))).toThrow("maxMinutes (45) must be a whole number of 30-minute slots");
    expect(parse((c) => (c.classes[0].rules = { minMinutes: 150 }))).toThrow("maxMinutes (120) cannot be shorter than minMinutes (150)");
  });

  it("throws a RuleBookError, so the app can tell a rules mistake from a bug", () => {
    expect(parse((c) => delete c.defaults)).toThrow(RuleBookError);
  });
});

describe("which rules apply to an item", () => {
  const item = (extra: Partial<Item> = {}): Item => ({ id: "i", name: "Test", classCode: "shell-single", ruleOverrides: {}, ...extra });

  it("take the defaults, then the class, then the item, in that order", () => {
    const book = parse((c) => (c.classes[0].rules = { maxMinutes: 90 }))();
    expect(rulesFor(book, item()).rules.maxMinutes).toBe(90);
    expect(rulesFor(book, item({ classCode: "shell-double" })).rules.maxMinutes).toBe(120);
    expect(rulesFor(book, item({ ruleOverrides: { maxMinutes: 60 } })).rules.maxMinutes).toBe(60);
    expect(rulesFor(book, item({ ruleOverrides: { maxMinutes: 60 } })).rules.slotMinutes).toBe(30);
  });

  it("let one item change or drop its class's qualification", () => {
    expect(rulesFor(RULE_BOOK, item()).requiredQualification).toBe("scull-1");
    expect(rulesFor(RULE_BOOK, item({ requiredQualification: "scull-3" })).requiredQualification).toBe("scull-3");
    expect(rulesFor(RULE_BOOK, item({ requiredQualification: null })).requiredQualification).toBeNull();
  });

  it("check an item's own overrides the same way", () => {
    expect(() => checkOverrides(RULE_BOOK.defaults, { maxMinutes: 90 }, "Tern")).not.toThrow();
    expect(() => checkOverrides(RULE_BOOK.defaults, { maxMinutes: 45 }, "Tern")).toThrow("must be a whole number of 30-minute slots");
    expect(() => classOf(RULE_BOOK, { classCode: "nope" })).toThrow('There is no class "nope"');
  });
});
