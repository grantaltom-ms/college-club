import { createHmac } from "node:crypto";
import { PASSWORD_MIN_LENGTH, passwordMatches, UNLOCK_DAYS } from "./financials-lock";

/**
 * The password on the email list builder (Nov 18, 2026). The rest of the Email page is open to anyone with the link and shows
 * counts only; the list builder shows member names and email addresses and writes to Mailchimp, so it needs one shared password
 * (DASHBOARD_EMAIL_LISTS_PASSWORD, private settings only). Grant chose a shared password, separate from Financials, so staff such
 * as the person who sends the campaigns can build lists too. It works like the Financials lock: the right password gives this
 * browser a 30-day pass that is a keyed fingerprint of its end date made with the password itself, so changing the password ends
 * every pass at once.
 */

export const EMAIL_LISTS_COOKIE = "ccs_email_lists";
export { passwordMatches, UNLOCK_DAYS };

const DAY_MS = 24 * 60 * 60 * 1000;

export function emailListsPassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.DASHBOARD_EMAIL_LISTS_PASSWORD?.trim() ?? "";
  return value.length >= PASSWORD_MIN_LENGTH ? value : null;
}

function signature(password: string, expires: number): string {
  return createHmac("sha256", password).update(`email-lists:${expires}`).digest("hex");
}

export function makeListsToken(password: string, now: Date): string {
  const expires = now.getTime() + UNLOCK_DAYS * DAY_MS;
  return `${expires}.${signature(password, expires)}`;
}

export function listsTokenValid(token: string | undefined, password: string | null, now: Date): boolean {
  if (!token || !password) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (!(expires > now.getTime()) || expires > now.getTime() + UNLOCK_DAYS * DAY_MS) return false;
  return passwordMatches(match[2], signature(password, expires));
}

/** Is this browser allowed to use the list builder right now? */
export function emailListsUnlocked(token: string | undefined, now: Date = new Date(), env: Record<string, string | undefined> = process.env): boolean {
  return listsTokenValid(token, emailListsPassword(env), now);
}
