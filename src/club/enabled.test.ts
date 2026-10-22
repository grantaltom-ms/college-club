import { describe, expect, it } from "vitest";
import { clubEnabled } from "./enabled";

describe("clubEnabled", () => {
  it("is on while developing", () => {
    expect(clubEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(clubEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is off in a production build unless the sample-data switch is on", () => {
    expect(clubEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(clubEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "" })).toBe(false);
    expect(clubEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "0" })).toBe(false);
    expect(clubEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "true" })).toBe(false);
    expect(clubEnabled({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(true);
  });

  it("is off on the live production site whatever else is set", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      for (const CCS_ALLOW_SAMPLE_DATA of [undefined, "", "1"]) {
        expect(clubEnabled({ VERCEL_ENV: "production", NODE_ENV, CCS_ALLOW_SAMPLE_DATA }), `${NODE_ENV}/${CCS_ALLOW_SAMPLE_DATA}`).toBe(false);
      }
    }
  });

  it("is on in a Vercel preview that has the switch", () => {
    expect(clubEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(true);
    expect(clubEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });
});
