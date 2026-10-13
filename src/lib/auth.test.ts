import { describe, expect, it } from "vitest";
import { checkAuth, safeEqual } from "./auth";

const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

describe("checkAuth", () => {
  it("locks production when no password is set", () => {
    expect(checkAuth(null, undefined, true)).toBe("not-configured");
    expect(checkAuth(basic("x", "y"), "", true)).toBe("not-configured");
  });

  it("lets local development through when no password is set", () => {
    expect(checkAuth(null, undefined, false)).toBe("ok");
  });

  it("asks for a password when none, or the wrong one, is given", () => {
    expect(checkAuth(null, "secret", true)).toBe("needs-password");
    expect(checkAuth(basic("ccs", "nope"), "secret", true)).toBe("needs-password");
    expect(checkAuth("Bearer abc", "secret", true)).toBe("needs-password");
    expect(checkAuth("Basic !!!not-base64", "secret", true)).toBe("needs-password");
  });

  it("accepts the right password under any user name, including passwords with colons", () => {
    expect(checkAuth(basic("anyone", "secret"), "secret", true)).toBe("ok");
    expect(checkAuth(basic("", "a:b"), "a:b", true)).toBe("ok");
  });
});

describe("safeEqual", () => {
  it("compares whole strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
