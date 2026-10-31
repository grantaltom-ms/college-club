import { describe, expect, it } from "vitest";
import { ipadCode, ipadMemberPath, ipadPath, snackCode, snackMemberPath, snackPath, verifyIpadCode, verifySnackCode } from "./ipad-address";

const SECRET = "a-test-secret-for-the-ipad-00";

describe("the front-desk iPad's private address", () => {
  it("makes the same code every time for the same secret, and a different one for another secret", () => {
    expect(ipadCode(SECRET)).toBe(ipadCode(SECRET));
    expect(ipadCode(SECRET)).not.toBe(ipadCode("another-secret-for-the-ipad-1"));
    expect(ipadCode(SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never contains the secret", () => {
    expect(ipadCode(SECRET)).not.toContain(SECRET);
  });

  it("accepts exactly its own code", () => {
    expect(verifyIpadCode(SECRET, ipadCode(SECRET))).toBe(true);
  });

  it("refuses a code made from another secret, a changed code, a short one, a long one and an empty one", () => {
    const good = ipadCode(SECRET);
    expect(verifyIpadCode(SECRET, ipadCode("another-secret-for-the-ipad-1"))).toBe(false);
    expect(verifyIpadCode(SECRET, `${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(verifyIpadCode(SECRET, good.slice(0, -1))).toBe(false);
    expect(verifyIpadCode(SECRET, `${good}x`)).toBe(false);
    expect(verifyIpadCode(SECRET, "")).toBe(false);
  });

  it("is not the same as an RSVP link code for anything", () => {
    // A code made for a different purpose from the same secret does not open the iPad.
    expect(verifyIpadCode(SECRET, Buffer.from("rsvp-v1|event|member").toString("base64url"))).toBe(false);
  });

  it("refuses a secret that is too short", () => {
    expect(() => ipadCode("short")).toThrow("at least 16 characters");
  });

  it("builds the two addresses", () => {
    expect(ipadPath("abc")).toBe("/club/ipad/abc");
    expect(ipadMemberPath("abc", "11111111-1111-4111-8111-111111111111")).toBe("/club/ipad/abc/11111111-1111-4111-8111-111111111111");
  });
});

describe("the honor snack bar iPad's private address", () => {
  it("makes the same code every time for the same secret, and a different one for another secret", () => {
    expect(snackCode(SECRET)).toBe(snackCode(SECRET));
    expect(snackCode(SECRET)).not.toBe(snackCode("another-secret-for-the-ipad-1"));
    expect(snackCode(SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(snackCode(SECRET)).not.toContain(SECRET);
  });

  it("is a different address from the front-desk iPad's, so neither opens the other", () => {
    expect(snackCode(SECRET)).not.toBe(ipadCode(SECRET));
    expect(verifySnackCode(SECRET, ipadCode(SECRET))).toBe(false);
    expect(verifyIpadCode(SECRET, snackCode(SECRET))).toBe(false);
  });

  it("accepts exactly its own code", () => {
    expect(verifySnackCode(SECRET, snackCode(SECRET))).toBe(true);
    const good = snackCode(SECRET);
    expect(verifySnackCode(SECRET, snackCode("another-secret-for-the-ipad-1"))).toBe(false);
    expect(verifySnackCode(SECRET, `${good.slice(0, -1)}${good.endsWith("A") ? "B" : "A"}`)).toBe(false);
    expect(verifySnackCode(SECRET, good.slice(0, -1))).toBe(false);
    expect(verifySnackCode(SECRET, `${good}x`)).toBe(false);
    expect(verifySnackCode(SECRET, "")).toBe(false);
  });

  it("refuses a secret that is too short", () => {
    expect(() => snackCode("short")).toThrow("at least 16 characters");
  });

  it("builds the two addresses", () => {
    expect(snackPath("abc")).toBe("/club/snacks/abc");
    expect(snackMemberPath("abc", "11111111-1111-4111-8111-111111111111")).toBe("/club/snacks/abc/11111111-1111-4111-8111-111111111111");
  });
});
