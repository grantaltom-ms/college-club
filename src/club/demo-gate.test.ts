import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { makeUnlockToken } from "@/lib/financials-lock";
import {
  DEMO_DEFAULT_NEXT,
  DEMO_NEXT_MAX,
  DEMO_PASS_DAYS,
  decideGate,
  demoGateState,
  demoNext,
  demoPassValid,
  demoPassword,
  demoPasswordMatches,
  isGatedPath,
  isKeypadPath,
  makeDemoPass,
} from "./demo-gate";

const PASSWORD = "demo-password-0001";
const ON = { CCS_ALLOW_SAMPLE_DATA: "1", NODE_ENV: "production", CCS_DEMO_PASSWORD: PASSWORD };
const NOW = new Date("2026-11-03T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("the demo keypad: when it is on", () => {
  it("is on with a password and invented data allowed", () => {
    expect(demoGateState(ON)).toBe("on");
    expect(demoPassword(ON)).toBe(PASSWORD);
  });

  it("is off with no password, a blank one or spaces, so development and the tests are not in the way", () => {
    for (const value of [undefined, "", "   "]) {
      const env = { ...ON, CCS_DEMO_PASSWORD: value };
      expect(demoGateState(env)).toBe("off");
      expect(demoPassword(env)).toBeNull();
    }
  });

  it("locks everything for everyone when the password is too short, rather than looking switched off", () => {
    expect(demoGateState({ ...ON, CCS_DEMO_PASSWORD: "1234567" })).toBe("weak");
    expect(demoGateState({ ...ON, CCS_DEMO_PASSWORD: "12345678" })).toBe("on");
    expect(demoPassword({ ...ON, CCS_DEMO_PASSWORD: "1234567" })).toBeNull();
  });

  it("counts the password without the spaces round it", () => {
    expect(demoGateState({ ...ON, CCS_DEMO_PASSWORD: "  1234567  " })).toBe("weak");
    expect(demoPassword({ ...ON, CCS_DEMO_PASSWORD: `  ${PASSWORD}  ` })).toBe(PASSWORD);
  });

  it("is never on the live production site, even with the password and the sample switch both set", () => {
    expect(demoGateState({ ...ON, VERCEL_ENV: "production" })).toBe("off");
    expect(demoPassword({ ...ON, VERCEL_ENV: "production" })).toBeNull();
  });

  it("is never on where invented data is not allowed", () => {
    expect(demoGateState({ NODE_ENV: "production", CCS_DEMO_PASSWORD: PASSWORD })).toBe("off");
  });

  it("is on in development and on previews (invented data allowed without the switch, or with it)", () => {
    expect(demoGateState({ NODE_ENV: "development", CCS_DEMO_PASSWORD: PASSWORD })).toBe("on");
    expect(demoGateState({ ...ON, VERCEL_ENV: "preview" })).toBe("on");
  });
});

describe("the demo password", () => {
  it("matches only exactly what it is", () => {
    expect(demoPasswordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(demoPasswordMatches("", PASSWORD)).toBe(false);
    expect(demoPasswordMatches(PASSWORD.toUpperCase(), PASSWORD)).toBe(false);
    expect(demoPasswordMatches(`${PASSWORD} `, PASSWORD)).toBe(false);
    expect(demoPasswordMatches(PASSWORD.slice(0, -1), PASSWORD)).toBe(false);
    expect(demoPasswordMatches(PASSWORD + PASSWORD, PASSWORD)).toBe(false);
    expect(demoPasswordMatches("x".repeat(100_000), PASSWORD)).toBe(false);
  });
});

describe("the 30-day pass", () => {
  it("is good now and for the 30 days", () => {
    const pass = makeDemoPass(PASSWORD, NOW);
    expect(demoPassValid(pass, PASSWORD, NOW)).toBe(true);
    expect(demoPassValid(pass, PASSWORD, new Date(NOW.getTime() + DEMO_PASS_DAYS * DAY - 1))).toBe(true);
  });

  it("ends exactly at the end of the 30 days", () => {
    const pass = makeDemoPass(PASSWORD, NOW);
    expect(demoPassValid(pass, PASSWORD, new Date(NOW.getTime() + DEMO_PASS_DAYS * DAY))).toBe(false);
    expect(demoPassValid(pass, PASSWORD, new Date(NOW.getTime() + DEMO_PASS_DAYS * DAY + DAY))).toBe(false);
  });

  it("stops working the moment the password changes", () => {
    const pass = makeDemoPass(PASSWORD, NOW);
    expect(demoPassValid(pass, `${PASSWORD}-new`, NOW)).toBe(false);
  });

  it("is refused when its end date is edited, even to a nearer one", () => {
    const [expires, sig] = makeDemoPass(PASSWORD, NOW).split(".");
    expect(demoPassValid(`${Number(expires) + 1}.${sig}`, PASSWORD, NOW)).toBe(false);
    expect(demoPassValid(`${Number(expires) - 1}.${sig}`, PASSWORD, NOW)).toBe(false);
  });

  it("is refused when it would run longer than 30 days, even if it were signed correctly", () => {
    const expires = NOW.getTime() + DEMO_PASS_DAYS * DAY + 1000;
    const sig = createHmac("sha256", PASSWORD).update(`demo-unlock:${expires}`).digest("hex");
    expect(demoPassValid(`${expires}.${sig}`, PASSWORD, NOW)).toBe(false);
  });

  it("is refused when it is missing, empty, malformed or there is no password to check it against", () => {
    const pass = makeDemoPass(PASSWORD, NOW);
    expect(demoPassValid(undefined, PASSWORD, NOW)).toBe(false);
    expect(demoPassValid("", PASSWORD, NOW)).toBe(false);
    expect(demoPassValid("garbage", PASSWORD, NOW)).toBe(false);
    expect(demoPassValid(`${pass}0`, PASSWORD, NOW)).toBe(false);
    expect(demoPassValid(pass.toUpperCase(), PASSWORD, NOW)).toBe(false);
    expect(demoPassValid(pass, null, NOW)).toBe(false);
  });

  it("is not fooled by a Financials pass made with the very same password", () => {
    expect(demoPassValid(makeUnlockToken(PASSWORD, NOW), PASSWORD, NOW)).toBe(false);
  });
});

describe("what the keypad covers", () => {
  it("covers the member area, the public-site preview and the member area's data handlers", () => {
    for (const path of ["/club", "/club/", "/club/start", "/club/admin/charges", "/club/ipad/abc123", "/club/manifest.webmanifest", "/site", "/site/request-a-tour", "/site/", "/api/club", "/api/club/act-as", "/api/club/events/x/links"]) {
      expect(isGatedPath(path), path).toBe(true);
    }
  });

  it("does not cover the dashboard, its data, the menu's question, the keypad or look-alike words", () => {
    for (const path of ["/", "/goals", "/visits", "/financials", "/api/dashboard", "/api/financials", "/api/nav-extras", "/demo", "/api/demo/unlock", "/api/demo/lock", "/clubhouse", "/api/clubhouse", "/sites", "/_next/static/chunk.js", "/favicon.ico", "/ds/lane.svg"]) {
      expect(isGatedPath(path), path).toBe(false);
    }
  });

  it("is not fooled by a strangely written address", () => {
    const sneaky = [
      "/%63lub/start", // c escaped
      "/%2563lub/start", // escaped twice
      "/Club/start",
      "/CLUB",
      "/SITE/request-a-tour",
      "//club/start",
      "/./club/start",
      "/club//start",
      "/x/../club/start",
      "/%2e%2e/club/start",
      "/\\club/start",
      "/api/Club/act-as",
      "/api//club/act-as",
      "/api/%63lub/act-as",
      "/club%2fstart",
    ];
    for (const path of sneaky) expect(isGatedPath(path), path).toBe(true);
  });

  it("knows the keypad's own addresses, however written", () => {
    for (const path of ["/demo", "/demo/", "/api/demo/unlock", "/api/demo/lock", "/%64emo", "/Demo", "//demo", "/./demo", "/api/%64emo/unlock"]) {
      expect(isKeypadPath(path), path).toBe(true);
    }
    for (const path of ["/", "/goals", "/club", "/demonstration", "/api/demonstration", "/api", "/api/club/demo", "/x/demo", "/%E0%A4%A"]) {
      expect(isKeypadPath(path), path).toBe(false);
    }
  });

  it("treats an address it cannot read as covered", () => {
    expect(isGatedPath("/%E0%A4%A")).toBe(true);
    expect(isGatedPath("/goals%")).toBe(true);
  });
});

describe("where the keypad sends you on to", () => {
  it("allows a plain page of the member area or the public-site preview, with a simple query", () => {
    for (const value of ["/club", "/club/start", "/club/admin/check-in?q=ada", "/club/book?day=2026-10-29&type=Shell", "/site", "/site/request-a-tour", `/club/ipad/${"A".repeat(43)}`]) {
      expect(demoNext(value), value).toBe(value);
    }
  });

  it("sends everything else to the landing page", () => {
    const bad = [
      undefined,
      null,
      "",
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "/dashboard",
      "/",
      "/demo",
      "/api/club/act-as",
      "/clubhouse",
      "/club@evil.example",
      "club/start",
      "/club/../demo",
      "/club//start",
      "/club/start#frag",
      "/club/start\n/evil",
      "/club/start?x=<script>",
      "javascript:alert(1)",
      "/site/../club",
    ];
    for (const value of bad) expect(demoNext(value), String(value)).toBe(DEMO_DEFAULT_NEXT);
  });

  it("allows an address of exactly the longest length and not one longer", () => {
    const exact = `/club/${"a".repeat(DEMO_NEXT_MAX - "/club/".length)}`;
    expect(exact.length).toBe(DEMO_NEXT_MAX);
    expect(demoNext(exact)).toBe(exact);
    expect(demoNext(`${exact}a`)).toBe(DEMO_DEFAULT_NEXT);
  });
});

describe("what to do with a request", () => {
  const pass = makeDemoPass(PASSWORD, NOW);
  const ask = (over: Partial<Parameters<typeof decideGate>[0]> = {}) => decideGate({ method: "GET", pathname: "/club/start", search: "", pass: undefined, now: NOW, env: ON, ...over });

  it("lets everything through with the keypad off, covered address or not", () => {
    const env = { ...ON, CCS_DEMO_PASSWORD: undefined };
    expect(ask({ env })).toEqual({ kind: "allow" });
    expect(ask({ env, method: "POST", pathname: "/api/club/act-as" })).toEqual({ kind: "allow" });
  });

  it("hides the member area, the preview site and the keypad on the live site, with or without the password set", () => {
    const live = { ...ON, VERCEL_ENV: "production" };
    for (const pathname of ["/club", "/club/start", "/site", "/site/request-a-tour", "/api/club/act-as", "/demo", "/api/demo/unlock", "/api/demo/lock"]) {
      expect(ask({ env: live, pathname }), pathname).toEqual({ kind: "hide" });
      expect(ask({ env: live, pathname, method: "POST" }), pathname).toEqual({ kind: "hide" });
      expect(ask({ env: { ...live, CCS_DEMO_PASSWORD: undefined }, pathname }), pathname).toEqual({ kind: "hide" });
    }
  });

  it("hides them however the address is written, so no spelling reaches a page that is not there", () => {
    const live = { ...ON, VERCEL_ENV: "production" };
    for (const pathname of ["/%63lub", "/%63lub/start", "/%2563lub/start", "/Club/start", "/CLUB", "/SITE/request-a-tour", "//club/start", "/club//start", "/./club/start", "/x/../club/start", "/%64emo", "/%2564emo", "/Demo", "/api/%63lub/act-as", "/api/%64emo/unlock", "/\\club/start", "/%E0%A4%A"]) {
      expect(ask({ env: live, pathname }), pathname).toEqual({ kind: "hide" });
    }
  });

  it("hides them wherever invented data is not allowed, not only on the live site", () => {
    const off = { NODE_ENV: "production", CCS_DEMO_PASSWORD: PASSWORD };
    expect(ask({ env: off })).toEqual({ kind: "hide" });
    expect(ask({ env: off, pathname: "/demo" })).toEqual({ kind: "hide" });
  });

  it("leaves the dashboard, its data and the menu's question alone on the live site", () => {
    const live = { ...ON, VERCEL_ENV: "production" };
    for (const pathname of ["/", "/goals", "/visits", "/financials", "/api/dashboard", "/api/financials", "/api/nav-extras", "/clubhouse", "/api/clubhouse", "/demonstration"]) {
      expect(ask({ env: live, pathname }), pathname).toEqual({ kind: "allow" });
    }
  });

  it("never hides anything where invented data is allowed (a test build)", () => {
    for (const env of [ON, { ...ON, CCS_DEMO_PASSWORD: undefined }, { NODE_ENV: "development" }, { ...ON, VERCEL_ENV: "preview" }]) {
      for (const pathname of ["/club/start", "/site", "/demo", "/%63lub/start"]) {
        expect(ask({ env, pathname }).kind, pathname).not.toBe("hide");
      }
    }
  });

  it("lets the dashboard, its data, the menu's question and the keypad through without a pass", () => {
    for (const pathname of ["/", "/goals", "/api/dashboard", "/api/nav-extras", "/demo", "/api/demo/unlock"]) {
      expect(ask({ pathname }), pathname).toEqual({ kind: "allow" });
      expect(ask({ pathname, method: "POST" }), pathname).toEqual({ kind: "allow" });
    }
  });

  it("sends a page being opened to the keypad, remembering where it was going", () => {
    expect(ask()).toEqual({ kind: "keypad", next: "/club/start" });
    expect(ask({ pathname: "/club/admin/check-in", search: "?q=ada" })).toEqual({ kind: "keypad", next: "/club/admin/check-in?q=ada" });
    expect(ask({ method: "HEAD" })).toEqual({ kind: "keypad", next: "/club/start" });
    expect(ask({ method: "get" })).toEqual({ kind: "keypad", next: "/club/start" });
  });

  it("refuses a button, a form or a data request, which cannot show a keypad", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(ask({ method }), method).toEqual({ kind: "refuse" });
    }
  });

  it("sends a strangely written address to the keypad too, and the landing page when it cannot be kept", () => {
    expect(ask({ pathname: "/%63lub/start" })).toEqual({ kind: "keypad", next: DEMO_DEFAULT_NEXT });
    expect(ask({ pathname: "/Club/admin" })).toEqual({ kind: "keypad", next: DEMO_DEFAULT_NEXT });
  });

  it("lets a good pass through, for pages and buttons alike", () => {
    expect(ask({ pass })).toEqual({ kind: "allow" });
    expect(ask({ pass, method: "POST", pathname: "/api/club/act-as" })).toEqual({ kind: "allow" });
    expect(ask({ pass, pathname: "/site/request-a-tour" })).toEqual({ kind: "allow" });
  });

  it("does not let a bad, old or other-password pass through", () => {
    expect(ask({ pass: "garbage" }).kind).toBe("keypad");
    expect(ask({ pass, now: new Date(NOW.getTime() + DEMO_PASS_DAYS * DAY) }).kind).toBe("keypad");
    expect(ask({ pass, env: { ...ON, CCS_DEMO_PASSWORD: "a-different-password" } }).kind).toBe("keypad");
  });

  it("locks everything covered for everyone when the password is too short, even with a pass that would fit it", () => {
    const weak = { ...ON, CCS_DEMO_PASSWORD: "short" };
    expect(ask({ env: weak, pass: makeDemoPass("short", NOW) }).kind).toBe("keypad");
    expect(ask({ env: weak, method: "POST" })).toEqual({ kind: "refuse" });
    expect(ask({ env: weak, pathname: "/goals" })).toEqual({ kind: "allow" });
  });
});
