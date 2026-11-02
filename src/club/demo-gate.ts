import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sampleDataAllowed } from "./enabled";

type Env = Partial<Record<string, string | undefined>>;

/**
 * The demo keypad: one shared password in front of the invented club on a test build, so the board can try the reservation
 * system without a Vercel login. The building comparison: the model apartment next door has a keypad on its door. The live
 * lobby has no door to it at all (the member area is "page not found" there), so this lock can only ever be added to a test build.
 *
 * It is on when `CCS_DEMO_PASSWORD` is set (private settings only, never code) on a build that allows invented data. Typing it
 * gives that browser a pass for 30 days. The pass is a keyed fingerprint of its own end date made with the password itself, so
 * nothing is stored on the server and changing the password ends every pass at once (the same idea as the Financials lock).
 *
 * With no password set it is off, so development and the automated tests are not in the way. With a password set that is too
 * short, everything it covers is locked for everyone (a weak password is worse than none, and silence would look like "off").
 */

export const DEMO_COOKIE = "ccs_demo";
export const DEMO_PASS_DAYS = 30;
export const DEMO_PASSWORD_MIN_LENGTH = 8;
/** The keypad page. It is outside the covered area, so it can always be reached. */
export const DEMO_KEYPAD_PATH = "/demo";
/** Where someone lands after the keypad when nothing better was asked for: the test landing page. */
export const DEMO_DEFAULT_NEXT = "/club/start";
/** The longest address (path and query) the keypad will send someone on to. */
export const DEMO_NEXT_MAX = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

export type DemoGateState = "off" | "on" | "weak";

/** Whether the keypad is off, on, or set up with a password that is too short to use. Never "on" where invented data is not allowed. */
export function demoGateState(env: Env = process.env): DemoGateState {
  if (!sampleDataAllowed(env)) return "off";
  const value = env.CCS_DEMO_PASSWORD?.trim() ?? "";
  if (value === "") return "off";
  return value.length >= DEMO_PASSWORD_MIN_LENGTH ? "on" : "weak";
}

/** The password, only when the keypad is on. */
export function demoPassword(env: Env = process.env): string | null {
  return demoGateState(env) === "on" ? (env.CCS_DEMO_PASSWORD?.trim() ?? null) : null;
}

function sameText(a: string, b: string): boolean {
  // Compare fingerprints, so the check takes the same time whatever was typed and however long it is.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Whether what someone typed is the password. */
export function demoPasswordMatches(typed: string, password: string): boolean {
  return sameText(typed, password);
}

function signature(password: string, expires: number): string {
  // The label keeps a pass made for another lock (the Financials one) from ever fitting here, even with the same password.
  return createHmac("sha256", password).update(`demo-unlock:${expires}`).digest("hex");
}

/** A 30-day pass for this browser: "<end time in ms>.<signature>". */
export function makeDemoPass(password: string, now: Date): string {
  const expires = now.getTime() + DEMO_PASS_DAYS * DAY_MS;
  return `${expires}.${signature(password, expires)}`;
}

/** Whether a pass is genuine, made with the current password, and not past its end date. */
export function demoPassValid(token: string | undefined, password: string | null, now: Date): boolean {
  if (!token || !password) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!(expires > now.getTime())) return false;
  // A pass can never run longer than the rule allows, even if someone hand-edits the date (it would not sign, but be strict).
  if (expires > now.getTime() + DEMO_PASS_DAYS * DAY_MS) return false;
  return sameText(match[2], signature(password, expires));
}

/**
 * Whether a page or handler is inside what the keypad covers: the member area, the public-site preview and the member area's
 * data handlers. The dashboard, its data and the keypad itself are not. The address is tidied the way a browser or a server
 * would (escapes undone, repeated slashes and dot segments folded, capitals ignored), and anything that cannot be read is
 * treated as covered, so a strangely written address can never slip past by looking different.
 */
export function isGatedPath(pathname: string): boolean {
  let decoded = pathname;
  try {
    // Twice, because an address can be escaped twice over.
    decoded = decodeURIComponent(decodeURIComponent(pathname));
  } catch {
    return true;
  }
  const parts: string[] = [];
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part.toLowerCase());
  }
  const [first, second] = parts;
  if (first === "club" || first === "site") return true;
  return first === "api" && second === "club";
}

/**
 * Where the keypad may send someone on to afterwards: a page of the member area or the public-site preview, written plainly.
 * Anything else (another site, a look-alike like /clubhouse, a page outside, dot segments, odd characters, too long) is the
 * landing page, so the keypad can never be used to send a visitor somewhere else.
 */
export function demoNext(value: string | null | undefined): string {
  const v = value ?? "";
  if (v.length === 0 || v.length > DEMO_NEXT_MAX) return DEMO_DEFAULT_NEXT;
  if (!/^\/(club|site)(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/.test(v)) return DEMO_DEFAULT_NEXT;
  const path = v.split("?")[0];
  if (path.includes("//") || path.split("/").some((part) => part === "..")) return DEMO_DEFAULT_NEXT;
  return v;
}

export type GateDecision = { kind: "allow" } | { kind: "keypad"; next: string } | { kind: "refuse" };

/**
 * What to do with one request. A covered address without a good pass goes to the keypad (a page being opened) or is refused (a
 * button, a form or a data request, which cannot show a keypad). Everything else passes untouched, and with the keypad off
 * nothing at all is covered.
 */
export function decideGate(input: { method: string; pathname: string; search: string; pass: string | undefined; now: Date; env?: Env }): GateDecision {
  const env = input.env ?? process.env;
  const state = demoGateState(env);
  if (state === "off") return { kind: "allow" };
  if (!isGatedPath(input.pathname)) return { kind: "allow" };
  if (state === "on" && demoPassValid(input.pass, demoPassword(env), input.now)) return { kind: "allow" };
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { kind: "keypad", next: demoNext(`${input.pathname}${input.search}`) };
  return { kind: "refuse" };
}
