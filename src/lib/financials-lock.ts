import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The password on the Financials page. One shared password for the board, kept only in private settings
 * (DASHBOARD_FINANCIALS_PASSWORD). Typing it right gives this browser a pass for 30 days. The pass is a keyed
 * fingerprint of its own end date made with the password itself, so nothing is stored on the server and changing the
 * password ends every pass at once.
 */

export const FINANCIALS_COOKIE = "ccs_financials";
export const UNLOCK_DAYS = 30;
export const PASSWORD_MIN_LENGTH = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The password from private settings, or null when it is missing or too short to be safe (the page then stays locked). */
export function financialsPassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.DASHBOARD_FINANCIALS_PASSWORD?.trim() ?? "";
  return value.length >= PASSWORD_MIN_LENGTH ? value : null;
}

function signature(password: string, expires: number): string {
  return createHmac("sha256", password).update(`financials-unlock:${expires}`).digest("hex");
}

function sameText(a: string, b: string): boolean {
  // Compare fingerprints, so the check takes the same time whatever was typed and however long it is.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Whether what someone typed is the password. */
export function passwordMatches(typed: string, password: string): boolean {
  return sameText(typed, password);
}

/** A 30-day pass for this browser: "<end time in ms>.<signature>". */
export function makeUnlockToken(password: string, now: Date): string {
  const expires = now.getTime() + UNLOCK_DAYS * DAY_MS;
  return `${expires}.${signature(password, expires)}`;
}

/** Whether a pass is genuine, made with the current password, and not past its end date. */
export function tokenValid(token: string | undefined, password: string | null, now: Date): boolean {
  if (!token || !password) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!(expires > now.getTime())) return false;
  // A pass can never run longer than the rule allows, even if someone hand-edits the date (it would not sign, but be strict).
  if (expires > now.getTime() + UNLOCK_DAYS * DAY_MS) return false;
  return sameText(match[2], signature(password, expires));
}

/** For the page and the data: is this browser's pass good right now? */
export function financialsUnlocked(token: string | undefined, now: Date = new Date(), env: Record<string, string | undefined> = process.env): boolean {
  return tokenValid(token, financialsPassword(env), now);
}
