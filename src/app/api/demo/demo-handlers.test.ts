import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_COOKIE, DEMO_DEFAULT_NEXT, demoPassValid } from "@/club/demo-gate";
import { POST as lock } from "./lock/route";
import { POST as unlock } from "./unlock/route";

const PASSWORD = "demo-password-0001";
const SITE = "https://demo.example.org";

function post(path: string, fields: Record<string, string> = {}, headers: Record<string, string> = {}, site = SITE) {
  return new NextRequest(`${site}${path}`, { method: "POST", headers: { host: new URL(site).host, ...headers }, body: new URLSearchParams(fields) });
}
const unlockWith = (fields: Record<string, string>, headers?: Record<string, string>, site?: string) => unlock(post("/api/demo/unlock", fields, headers, site));
const where = (res: Response) => new URL(res.headers.get("location")!);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CCS_DEMO_PASSWORD", PASSWORD);
});
afterEach(() => vi.unstubAllEnvs());

describe("typing the demo password", () => {
  it("does not exist where the keypad is off", async () => {
    vi.stubEnv("CCS_DEMO_PASSWORD", "");
    expect((await unlockWith({ password: PASSWORD })).status).toBe(404);
    vi.stubEnv("CCS_DEMO_PASSWORD", PASSWORD);
    vi.stubEnv("VERCEL_ENV", "production");
    const live = await unlockWith({ password: PASSWORD });
    expect(live.status).toBe(404);
    expect(live.headers.get("set-cookie")).toBeNull();
  });

  it("gives a 30-day pass to the right password and goes on to the page asked for", async () => {
    const res = await unlockWith({ password: PASSWORD, next: "/club/admin" });
    expect(res.status).toBe(303);
    expect(where(res).pathname).toBe("/club/admin");
    expect(where(res).origin).toBe(SITE);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${DEMO_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/i);
    const value = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    expect(demoPassValid(value, PASSWORD, new Date())).toBe(true);
  });

  it("is not Secure on a plain-http address (development), and is still HttpOnly", async () => {
    const res = await unlockWith({ password: PASSWORD }, undefined, "http://localhost:3104");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).not.toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("goes to the landing page when no page, or a page that is not allowed, was asked for", async () => {
    for (const next of [undefined, "", "https://evil.example/x", "//evil.example", "/dashboard", "/clubhouse"]) {
      const res = await unlockWith(next === undefined ? { password: PASSWORD } : { password: PASSWORD, next });
      expect(where(res).pathname, String(next)).toBe(DEMO_DEFAULT_NEXT);
      expect(where(res).origin, String(next)).toBe(SITE);
    }
  });

  it("sends a wrong password back to the keypad after a short wait, with no pass, keeping where it was going", async () => {
    const started = Date.now();
    const res = await unlockWith({ password: "not-the-password", next: "/club/admin" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(res.status).toBe(303);
    expect(where(res).pathname).toBe("/demo");
    expect(where(res).searchParams.get("wrong")).toBe("1");
    expect(where(res).searchParams.get("next")).toBe("/club/admin");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("treats no form, no password, an empty one and a huge one as wrong", async () => {
    const cases: Record<string, string>[] = [{}, { password: "" }, { password: "x".repeat(201) }, { password: `${PASSWORD}${"x".repeat(200)}` }];
    for (const fields of cases) {
      const res = await unlockWith(fields);
      expect(where(res).searchParams.get("wrong")).toBe("1");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("refuses a post from another website and gives no pass", async () => {
    const cases: Record<string, string>[] = [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of cases) {
      const res = await unlockWith({ password: PASSWORD }, headers);
      expect(res.status).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("never gives a pass when the password is too short, even if it is typed right", async () => {
    vi.stubEnv("CCS_DEMO_PASSWORD", "short");
    const res = await unlockWith({ password: "short" });
    expect(where(res).searchParams.get("wrong")).toBe("1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("locking the demo on this device", () => {
  it("throws the pass away and shows the keypad with a note", async () => {
    const res = await lock(post("/api/demo/lock", {}, { cookie: `${DEMO_COOKIE}=whatever` }));
    expect(res.status).toBe(303);
    expect(where(res).pathname).toBe("/demo");
    expect(where(res).searchParams.get("locked")).toBe("1");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${DEMO_COOKIE}=;`);
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("does not exist where the keypad is off, and refuses another website", async () => {
    expect((await lock(post("/api/demo/lock", {}, { origin: "https://evil.example" }))).status).toBe(403);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await lock(post("/api/demo/lock"))).status).toBe(404);
  });
});
