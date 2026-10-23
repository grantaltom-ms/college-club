import { describe, expect, it } from "vitest";
import { clubEnabled, outboxEnabled, pickerEnabled, sampleDataAllowed } from "./enabled";

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

describe("the test tools follow invented data, not the member area", () => {
  const cases: [string, Record<string, string | undefined>][] = [
    ["developing", { NODE_ENV: "development" }],
    ["a production build with the switch", { NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" }],
    ["a production build without it", { NODE_ENV: "production" }],
    ["the live site with the switch", { NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production" }],
    ["a preview with the switch", { NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "preview" }],
  ];

  it("the picker, the test outbox and the sample data are on exactly when invented data is allowed", () => {
    for (const [name, env] of cases) {
      expect(pickerEnabled(env), name).toBe(sampleDataAllowed(env));
      expect(outboxEnabled(env), name).toBe(sampleDataAllowed(env));
      expect(clubEnabled(env), name).toBe(sampleDataAllowed(env));
    }
  });

  it("are off on the live production site whatever else is set", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      const env = { VERCEL_ENV: "production", NODE_ENV, CCS_ALLOW_SAMPLE_DATA: "1" };
      expect(pickerEnabled(env), NODE_ENV).toBe(false);
      expect(outboxEnabled(env), NODE_ENV).toBe(false);
      expect(sampleDataAllowed(env), NODE_ENV).toBe(false);
    }
  });
});
