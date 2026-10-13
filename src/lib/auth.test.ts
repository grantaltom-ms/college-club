import { describe, expect, it } from "vitest";
import { SESSION_SECONDS, cookieValue, createSession, safeEqual, verifySession } from "./auth";

describe("sign-in tokens", () => {
  const now = Date.UTC(2026, 9, 13, 12);

  it("accepts a fresh token made with the same password", async () => {
    const token = await createSession("secret", now);
    expect(await verifySession(token, "secret", now + 1000)).toBe(true);
  });

  it("rejects a different password, a missing password and a missing token", async () => {
    const token = await createSession("secret", now);
    expect(await verifySession(token, "other", now)).toBe(false);
    expect(await verifySession(token, undefined, now)).toBe(false);
    expect(await verifySession(undefined, "secret", now)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSession("secret", now);
    expect(await verifySession(token, "secret", now + (SESSION_SECONDS + 5) * 1000)).toBe(false);
  });

  it("rejects a token whose expiry was changed", async () => {
    const token = await createSession("secret", now);
    const [, signature] = token.split(".");
    const later = String(Math.floor(now / 1000) + 999_999_999);
    expect(await verifySession(`${later}.${signature}`, "secret", now)).toBe(false);
  });

  it("rejects junk", async () => {
    for (const junk of ["", "abc", "123.", ".abc", "x.y", "12.34.56"]) {
      expect(await verifySession(junk, "secret", now)).toBe(false);
    }
  });
});

describe("cookieValue", () => {
  it("finds a cookie among several", () => {
    expect(cookieValue("a=1; ccs_members=1.abc; b=2", "ccs_members")).toBe("1.abc");
    expect(cookieValue(null, "ccs_members")).toBeUndefined();
    expect(cookieValue("a=1", "ccs_members")).toBeUndefined();
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
