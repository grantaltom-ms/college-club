import { describe, expect, it } from "vitest";
import { getIpadSecret } from "./ipad-secret";
import { getLinkSecret } from "./link-secret";

describe("the front-desk iPad secret", () => {
  const SECRET = "an-ipad-secret-long-enough";

  it("uses the configured secret", () => {
    expect(getIpadSecret({ CLUB_IPAD_SECRET: SECRET, NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(SECRET);
  });

  it("refuses a configured secret that is too short", () => {
    expect(() => getIpadSecret({ CLUB_IPAD_SECRET: "short", NODE_ENV: "development" })).toThrow("CLUB_IPAD_SECRET must be at least 16 characters");
  });

  it("makes a random one while developing, the same for the whole run, and not the same as the RSVP link secret", () => {
    const a = getIpadSecret({ NODE_ENV: "development" });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getIpadSecret({ NODE_ENV: "test" })).toBe(a);
    expect(a).not.toBe(getLinkSecret({ NODE_ENV: "development" }));
  });

  it("is not the RSVP link secret: setting one does not set the other", () => {
    expect(getIpadSecret({ CLUB_LINK_SECRET: "a-link-secret-long-enough", NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
  });

  it("has none in a deployed build that was not given one, so the address never differs between servers", () => {
    expect(getIpadSecret({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
  });

  it("has none, even if one is set, where the member area is switched off", () => {
    expect(getIpadSecret({ CLUB_IPAD_SECRET: SECRET, NODE_ENV: "production", VERCEL_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
    expect(getIpadSecret({ CLUB_IPAD_SECRET: SECRET, NODE_ENV: "production" })).toBeNull();
  });
});
