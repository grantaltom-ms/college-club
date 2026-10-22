import { describe, expect, it } from "vitest";
import raw from "./class-rules.json";
import { CLASS_RULES, ClassRulesError, checkClassOverrides, classRulesFor, parseClassRules } from "./class-rules";

type Draft = { defaults?: Record<string, unknown>; placeholder?: boolean };
const parse = (mutate: (copy: Draft) => unknown) => {
  const copy = structuredClone(raw) as unknown as Draft;
  mutate(copy);
  return () => parseClassRules(copy);
};

describe("the shipped class rules", () => {
  it("are placeholders, and say so", () => {
    expect(CLASS_RULES.placeholder).toBe(true);
    expect(CLASS_RULES.defaults).toEqual({
      signUpDaysAhead: 14,
      opensAt: "00:00",
      closeMinutesBefore: 30,
      cancelCutoffMinutes: 120,
      promoteUntilMinutesBefore: 120,
      waitlistMax: 10,
      maxUpcomingPerMember: 5,
      maxPerDayPerMember: 1,
    });
    expect(raw.about).toContain("PLACEHOLDER");
  });
});

describe("a mistake in the class rules file is caught in words someone can act on", () => {
  it("refuses a misspelled rule, a missing rule and a wrong kind of value", () => {
    expect(parse((c) => (c.defaults!.waitlistMaxx = 3))).toThrow('defaults: "waitlistMaxx" is not a class rule');
    expect(parse((c) => delete c.defaults!.signUpDaysAhead)).toThrow('defaults is missing "signUpDaysAhead"');
    expect(parse((c) => (c.defaults!.waitlistMax = "10"))).toThrow("waitlistMax (longest waiting list; 0 for none) must be a whole number");
    expect(parse((c) => (c.defaults!.signUpDaysAhead = 0))).toThrow("must be 1 or more");
    expect(parse((c) => (c.defaults!.closeMinutesBefore = -5))).toThrow("must be 0 or more");
    expect(parse((c) => (c.defaults!.opensAt = "midnight"))).toThrow("not a time like");
    expect(parse((c) => (c.defaults!.opensAt = "24:00"))).toThrow("must be before 24:00");
  });

  it("allows 0 where 0 makes sense: no waiting list, no cutoff, no closing time", () => {
    const rules = parse((c) => Object.assign(c.defaults!, { waitlistMax: 0, closeMinutesBefore: 0, cancelCutoffMinutes: 0, promoteUntilMinutesBefore: 0 }))();
    expect(rules.defaults.waitlistMax).toBe(0);
  });

  it("refuses rules that contradict each other", () => {
    expect(parse((c) => (c.defaults!.maxPerDayPerMember = 6))).toThrow("day limit could never be reached");
    expect(parse((c) => (c.defaults!.closeMinutesBefore = 14 * 1440 + 1))).toThrow("longer than the whole sign-up window");
    expect(parse((c) => delete c.defaults)).toThrow(ClassRulesError);
    expect(() => parseClassRules(null)).toThrow("empty");
  });
});

describe("which rules apply to a class", () => {
  it("are the defaults, then the class's own, checked the same way", () => {
    expect(classRulesFor(CLASS_RULES, { rules: {} }).waitlistMax).toBe(10);
    expect(classRulesFor(CLASS_RULES, { rules: { waitlistMax: 3, closeMinutesBefore: 0 } })).toMatchObject({ waitlistMax: 3, closeMinutesBefore: 0, signUpDaysAhead: 14 });
    expect(() => checkClassOverrides(CLASS_RULES.defaults, { waitlistMax: 3 }, "Yoga")).not.toThrow();
    expect(() => checkClassOverrides(CLASS_RULES.defaults, { waitlistMax: -1 }, "Yoga")).toThrow("Yoga, waitlistMax");
    expect(() => checkClassOverrides(CLASS_RULES.defaults, { maxUpcomingPerMember: 0 }, "Yoga")).toThrow("must be 1 or more");
    expect(() => checkClassOverrides(CLASS_RULES.defaults, { nope: 1 } as never, "Yoga")).toThrow("is not a class rule");
  });
});
