import { describe, expect, it } from "vitest";
import { siteEnabled } from "./enabled";

describe("whether the public site exists", () => {
  it("is on while developing and in test builds", () => {
    expect(siteEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(siteEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(siteEnabled({})).toBe(true);
  });

  it("is off in a production build unless the sample-data switch is on (previews, tests)", () => {
    expect(siteEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(siteEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "0" })).toBe(false);
    expect(siteEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(true);
  });

  it("is never on at the live production address, even with the switch on", () => {
    expect(siteEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(siteEnabled({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(false);
    expect(siteEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "preview" })).toBe(true);
  });
});
