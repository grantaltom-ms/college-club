import { describe, expect, it, vi } from "vitest";
import { demoUrl, navExtras } from "./demo-link";

const LIVE = { NODE_ENV: "production", VERCEL_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" };
const TEST_BUILD = { NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" };

describe("the demo's address", () => {
  it("is just the site's address, from a safe setting", () => {
    expect(demoUrl({ CCS_DEMO_URL: "https://demo.example.org" })).toBe("https://demo.example.org");
    expect(demoUrl({ CCS_DEMO_URL: "  https://demo.example.org/  " })).toBe("https://demo.example.org");
    expect(demoUrl({ CCS_DEMO_URL: "https://demo.example.org/some/path?x=1#frag" })).toBe("https://demo.example.org");
    expect(demoUrl({ CCS_DEMO_URL: "https://college-club-git-demo-grantaltom-ms-projects.vercel.app" })).toBe("https://college-club-git-demo-grantaltom-ms-projects.vercel.app");
  });

  it("allows a computer's own localhost over http, for development", () => {
    expect(demoUrl({ CCS_DEMO_URL: "http://localhost:3104" })).toBe("http://localhost:3104");
    expect(demoUrl({ CCS_DEMO_URL: "http://127.0.0.1:3104" })).toBe("http://127.0.0.1:3104");
  });

  it("is nothing, quietly, when nothing is set", () => {
    const log = vi.fn();
    expect(demoUrl({}, log)).toBeNull();
    expect(demoUrl({ CCS_DEMO_URL: "" }, log)).toBeNull();
    expect(demoUrl({ CCS_DEMO_URL: "   " }, log)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("is nothing, with a line in the log, when the setting is not a safe web address", () => {
    for (const value of ["demo.example.org", "http://demo.example.org", "ftp://demo.example.org", "javascript:alert(1)", "https://user:pass@demo.example.org", "https://user@demo.example.org", "not a url", "//demo.example.org"]) {
      const log = vi.fn();
      expect(demoUrl({ CCS_DEMO_URL: value }, log), value).toBeNull();
      expect(log, value).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).not.toContain(value.trim() === "" ? "zzz" : value);
    }
  });
});

describe("what the menu bar is told to add", () => {
  const DEMO = "https://demo.example.org";

  it("is the local link on a test build, whatever the demo setting says", () => {
    expect(navExtras(TEST_BUILD)).toEqual({ extras: ["system"] });
    expect(navExtras({ ...TEST_BUILD, CCS_DEMO_URL: DEMO })).toEqual({ extras: ["system"] });
  });

  it("is nothing on the live site by default", () => {
    expect(navExtras(LIVE)).toEqual({ extras: [] });
    expect(navExtras({ NODE_ENV: "production" })).toEqual({ extras: [] });
  });

  it("is the link to the demo on the live site once the demo's address is set", () => {
    expect(navExtras({ ...LIVE, CCS_DEMO_URL: DEMO })).toEqual({ extras: ["system"], systemHref: `${DEMO}/club/start` });
    expect(navExtras({ NODE_ENV: "production", VERCEL_ENV: "production", CCS_DEMO_URL: `${DEMO}/anything` })).toEqual({ extras: ["system"], systemHref: `${DEMO}/club/start` });
  });

  it("is nothing on the live site when the demo's address is not safe", () => {
    const log = vi.fn();
    expect(navExtras({ ...LIVE, CCS_DEMO_URL: "http://demo.example.org" }, log)).toEqual({ extras: [] });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
