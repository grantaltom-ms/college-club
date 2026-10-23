import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClubEvent, ClubState } from "../types";
import { householdOf } from "./queries";

/**
 * Personal RSVP links, for emails. Each adult gets their own link for each event: it carries a long secret code that
 * only fits that adult and that event, so a click can say who is replying without a login (logins arrive in step 6).
 *
 * The code is computed, not stored: a keyed fingerprint (HMAC-SHA256) of "this event, this member", using a secret that
 * lives only on the server. Anyone with the link can answer for that one person for that one event, and nothing else.
 * Opening the link never records anything; the person still presses the button.
 */

const MIN_SECRET = 16;

function keyed(secret: string, eventId: string, memberId: string): Buffer {
  if (secret.length < MIN_SECRET) throw new Error(`The RSVP link secret must be at least ${MIN_SECRET} characters.`);
  return createHmac("sha256", secret).update(`rsvp-v1|${eventId}|${memberId}`).digest();
}

/** The secret code for one member and one event, ready to put in a web address. */
export function rsvpLinkToken(secret: string, eventId: string, memberId: string): string {
  return keyed(secret, eventId, memberId).toString("base64url");
}

/** True only for the exact code made for this event and this member. */
export function verifyRsvpLinkToken(secret: string, eventId: string, memberId: string, token: string): boolean {
  const expected = Buffer.from(rsvpLinkToken(secret, eventId, memberId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The address of one adult's link, relative to the site. */
export const rsvpLinkPath = (eventId: string, memberId: string, token: string) => `/club/rsvp/${eventId}/${memberId}/${token}`;

/** A spreadsheet cell: quoted when needed, and made safe against being read as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Every active adult's link for an event, as a CSV staff can load into Mailchimp as a merge field later. Nothing is
 * sent anywhere. `origin` is the site's address, for example https://example.org.
 */
export function rsvpLinksCsv(state: ClubState, event: ClubEvent, secret: string, origin: string): string {
  const lines = [["email", "first_name", "last_name", "household", "rsvp_link"].join(",")];
  for (const member of state.members) {
    const household = householdOf(state, member.householdId);
    if (member.status !== "active" || household?.status !== "active") continue;
    const link = `${origin}${rsvpLinkPath(event.id, member.id, rsvpLinkToken(secret, event.id, member.id))}`;
    lines.push([member.email, member.firstName, member.lastName, household.displayName, link].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
