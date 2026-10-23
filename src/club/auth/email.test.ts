import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Erik.Lindqvist@Example.COM ")).toBe("erik.lindqvist@example.com");
    expect(normalizeEmail("a+club@sub.example.org")).toBe("a+club@sub.example.org");
  });

  it("refuses what is clearly not an address", () => {
    for (const bad of ["", "   ", "nope", "a@b", "@example.com", "a@@example.com", "a b@example.com", "a@exa mple.com", "a@example..com", ".a@example.com", "a@example.com.", "<a@example.com>", "a@example.com, b@example.com", "a@example.com;b@example.com", "a\n@example.com", `${"x".repeat(250)}@example.com`]) {
      expect(normalizeEmail(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const bad of [undefined, null, 5, {}, ["a@example.com"]]) expect(normalizeEmail(bad as never)).toBeNull();
  });
});
