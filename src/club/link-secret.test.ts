import { describe, expect, it } from "vitest";
import { getLinkSecret } from "./link-secret";

describe("the RSVP link secret", () => {
  const SECRET = "a-test-secret-long-enough";

  it("uses the configured secret", () => {
    expect(getLinkSecret({ CLUB_LINK_SECRET: SECRET, NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(SECRET);
  });

  it("refuses a configured secret that is too short", () => {
    expect(() => getLinkSecret({ CLUB_LINK_SECRET: "short", NODE_ENV: "development" })).toThrow("at least 16 characters");
  });

  it("makes a random one while developing, the same for the whole run", () => {
    const a = getLinkSecret({ NODE_ENV: "development" });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(getLinkSecret({ NODE_ENV: "test" })).toBe(a);
  });

  it("has none in a deployed build that was not given one, so links never differ between servers", () => {
    expect(getLinkSecret({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
  });

  it("has none, even if one is set, where the member area is switched off", () => {
    expect(getLinkSecret({ CLUB_LINK_SECRET: SECRET, NODE_ENV: "production", VERCEL_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
    expect(getLinkSecret({ CLUB_LINK_SECRET: SECRET, NODE_ENV: "production" })).toBeNull();
  });
});
