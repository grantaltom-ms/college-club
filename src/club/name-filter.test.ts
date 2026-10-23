import { describe, expect, it } from "vitest";
import { nameMatches } from "./name-filter";

describe("narrowing the iPad's names as someone types", () => {
  it("shows everyone when nothing is typed", () => {
    expect(nameMatches("Priya Rao", "")).toBe(true);
    expect(nameMatches("Priya Rao", "   ")).toBe(true);
  });

  it("matches the first letters of the first name or the last name", () => {
    expect(nameMatches("Priya Rao", "p")).toBe(true);
    expect(nameMatches("Priya Rao", "pri")).toBe(true);
    expect(nameMatches("Priya Rao", "ra")).toBe(true);
    expect(nameMatches("Priya Rao", "rao")).toBe(true);
  });

  it("matches the first and last name together, with any capitals and spacing", () => {
    expect(nameMatches("Priya Rao", "priya r")).toBe(true);
    expect(nameMatches("Priya Rao", "  PRIYA   RAO ")).toBe(true);
    expect(nameMatches("Priya Rao", "priya rao")).toBe(true);
  });

  it("does not match the middle of a word, or words in the wrong order, or letters that are not there", () => {
    expect(nameMatches("Priya Rao", "iya")).toBe(false);
    expect(nameMatches("Priya Rao", "rao priya")).toBe(false);
    expect(nameMatches("Priya Rao", "q")).toBe(false);
    expect(nameMatches("Priya Rao", "priya raoo")).toBe(false);
  });

  it("ignores accents and treats hyphens and apostrophes as part of a name", () => {
    expect(nameMatches("Chloé Tanaka-Brooks", "chloe")).toBe(true);
    expect(nameMatches("Chloé Tanaka-Brooks", "tanaka-b")).toBe(true);
    expect(nameMatches("Siobhán O'Neill", "o'n")).toBe(true);
    expect(nameMatches("Siobhán O'Neill", "siobhan o")).toBe(true);
  });
});
