import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_COOKIE, makeDemoPass } from "@/club/demo-gate";
import { config, proxy } from "./proxy";

const PASSWORD = "demo-password-0001";
const SITE = "https://demo.example.org";

function request(path: string, init: { method?: string; pass?: string } = {}) {
  return new NextRequest(`${SITE}${path}`, { method: init.method ?? "GET", headers: init.pass ? { cookie: `${DEMO_COOKIE}=${init.pass}` } : {} });
}
const passesThrough = (res: Response | undefined) => res?.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CCS_DEMO_PASSWORD", PASSWORD);
});
afterEach(() => vi.unstubAllEnvs());

describe("the demo keypad's door", () => {
  it("looks at every address except the framework's own files, and decides by address itself", () => {
    expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  });

  it("sends a page of the member area to the keypad, remembering where it was going, and asks nothing to be cached", async () => {
    const res = proxy(request("/club/admin/check-in?q=ada"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin).toBe(SITE);
    expect(to.pathname).toBe("/demo");
    expect(to.searchParams.get("next")).toBe("/club/admin/check-in?q=ada");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("sends the public-site preview there too", () => {
    expect(new URL(proxy(request("/site/request-a-tour")).headers.get("location")!).searchParams.get("next")).toBe("/site/request-a-tour");
  });

  it("refuses a button or a data request with a plain 'locked' answer", async () => {
    const res = proxy(request("/api/club/act-as", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/locked/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("lets a good pass through, for a page and for a button", () => {
    const pass = makeDemoPass(PASSWORD, new Date());
    expect(passesThrough(proxy(request("/club/start", { pass })))).toBe(true);
    expect(passesThrough(proxy(request("/api/club/act-as", { method: "POST", pass })))).toBe(true);
  });

  it("does not let a pass made with another password through", () => {
    const pass = makeDemoPass("another-password-1", new Date());
    expect(proxy(request("/club/start", { pass })).status).toBe(307);
  });

  it("leaves the dashboard, its data, the menu's question and the keypad alone", () => {
    for (const path of ["/", "/goals", "/financials", "/api/dashboard", "/api/nav-extras", "/demo", "/demo?next=/club/start"]) {
      expect(passesThrough(proxy(request(path))), path).toBe(true);
    }
    expect(passesThrough(proxy(request("/api/demo/unlock", { method: "POST" })))).toBe(true);
  });

  it("changes nothing at all with the keypad off", () => {
    vi.stubEnv("CCS_DEMO_PASSWORD", "");
    for (const path of ["/club/start", "/site", "/", "/api/club/act-as"]) expect(passesThrough(proxy(request(path))), path).toBe(true);
  });

  it("changes nothing on the live site, even with the password and the sample switch set", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    for (const path of ["/club/start", "/site", "/", "/demo"]) expect(passesThrough(proxy(request(path))), path).toBe(true);
  });
});
