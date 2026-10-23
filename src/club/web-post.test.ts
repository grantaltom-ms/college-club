import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sameOrigin, siteOrigin } from "./web-post";

const post = (headers: Record<string, string> = {}, url = "https://club.example.org/api/club/sign-in/request") => new NextRequest(url, { method: "POST", headers: { host: "club.example.org", ...headers } });

afterEach(() => vi.unstubAllEnvs());

describe("sameOrigin: only this site's own pages may post a sign-in form", () => {
  it("accepts a post from this site, and one that says nothing about where it came from", () => {
    expect(sameOrigin(post({ origin: "https://club.example.org" }))).toBe(true);
    expect(sameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(post({ "sec-fetch-site": "none" }))).toBe(true);
    expect(sameOrigin(post())).toBe(true);
  });

  it("refuses another site, a sister site, a lookalike and a mangled origin", () => {
    expect(sameOrigin(post({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(post({ origin: "https://club.example.org.evil.example" }))).toBe(false);
    expect(sameOrigin(post({ origin: "https://other.example.org" }))).toBe(false);
    expect(sameOrigin(post({ origin: "null" }))).toBe(false);
    expect(sameOrigin(post({ origin: "not a url" }))).toBe(false);
    expect(sameOrigin(post({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(post({ "sec-fetch-site": "same-site" }))).toBe(false);
    // Even if the origin matches, a browser that says the post is cross-site wins.
    expect(sameOrigin(post({ origin: "https://club.example.org", "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("compares with the public host when a proxy forwards it", () => {
    expect(sameOrigin(post({ origin: "https://club.example.org", host: "internal:3000", "x-forwarded-host": "club.example.org" }))).toBe(true);
    expect(sameOrigin(post({ origin: "https://club.example.org", host: "internal:3000" }))).toBe(false);
  });
});

describe("siteOrigin: the address that goes into a sign-in email", () => {
  it("is the configured site address, never what a visitor's request claims", () => {
    vi.stubEnv("CLUB_SITE_URL", "https://club.example.org/anything/here");
    expect(siteOrigin(post({ host: "evil.example" }, "https://evil.example/api/x"))).toBe("https://club.example.org");
  });

  it("refuses a setting that is not a web address, instead of falling back to the visitor's", () => {
    for (const bad of ["not a url", "ftp://club.example.org", "javascript:alert(1)"]) {
      vi.stubEnv("CLUB_SITE_URL", bad);
      expect(siteOrigin(post({}, "https://evil.example/api/x")), bad).toBeNull();
    }
  });

  it("is the request's own address only in a test build, where the email never leaves the server", () => {
    vi.stubEnv("CLUB_SITE_URL", "");
    expect(siteOrigin(post({}, "http://localhost:3100/api/x"))).toBe("http://localhost:3100");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "");
    expect(siteOrigin(post({}, "https://evil.example/api/x"))).toBeNull();
    vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(siteOrigin(post({}, "https://evil.example/api/x"))).toBeNull();
  });
});
