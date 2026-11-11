import { createHmac } from "node:crypto";
import { PASSWORD_MIN_LENGTH, passwordMatches, UNLOCK_DAYS } from "./financials-lock";

/**
 * The editing password on the executive page (Nov 11, 2026). Anyone with the link can read the page; changing it needs one shared
 * password for the executive team, kept only in private settings (DASHBOARD_EXECUTIVE_PASSWORD). It works like the Financials lock:
 * typing it right gives this browser a 30-day pass that is a keyed fingerprint of its end date, made with the password itself, so
 * nothing is stored and changing the password ends every pass at once. It is a different password from Financials.
 */

export const EXECUTIVE_COOKIE = "ccs_executive_edit";
export { passwordMatches, UNLOCK_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

export function executivePassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.DASHBOARD_EXECUTIVE_PASSWORD?.trim() ?? "";
  return value.length >= PASSWORD_MIN_LENGTH ? value : null;
}

function signature(password: string, expires: number): string {
  return createHmac("sha256", password).update(`executive-edit:${expires}`).digest("hex");
}

export function makeEditToken(password: string, now: Date): string {
  const expires = now.getTime() + UNLOCK_DAYS * DAY_MS;
  return `${expires}.${signature(password, expires)}`;
}

export function editTokenValid(token: string | undefined, password: string | null, now: Date): boolean {
  if (!token || !password) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!(expires > now.getTime()) || expires > now.getTime() + UNLOCK_DAYS * DAY_MS) return false;
  return passwordMatches(match[2], signature(password, expires));
}

/** Is this browser allowed to edit right now? */
export function canEditExecutive(token: string | undefined, now: Date = new Date(), env: Record<string, string | undefined> = process.env): boolean {
  return editTokenValid(token, executivePassword(env), now);
}
