import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The front-desk iPad's private address. The building comparison: a key to the lobby kiosk, kept at the front desk.
 *
 * The address carries a code that is a keyed fingerprint (HMAC-SHA256) of the word "ipad" made with a secret that lives
 * only on the server, so the secret itself never appears in an address. The code is computed, not stored, and checked in
 * constant time. Anyone with the address can use the iPad screens (and nothing else); changing the secret changes the
 * code, which switches every old address off at once.
 */

const MIN_SECRET = 16;

function keyed(secret: string, purpose: string): Buffer {
  if (secret.length < MIN_SECRET) throw new Error(`The iPad secret must be at least ${MIN_SECRET} characters.`);
  return createHmac("sha256", secret).update(purpose).digest();
}

/** The secret code for the iPad's address, ready to put in a web address. */
export function ipadCode(secret: string): string {
  return keyed(secret, "ipad-v1").toString("base64url");
}

/** True only for the exact code made from this secret. */
export function verifyIpadCode(secret: string, code: string): boolean {
  const expected = Buffer.from(ipadCode(secret));
  const given = Buffer.from(code);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The iPad's start screen, relative to the site. */
export const ipadPath = (code: string) => `/club/ipad/${code}`;

/** One member's check-in screen on the iPad, relative to the site. */
export const ipadMemberPath = (code: string, memberId: string) => `/club/ipad/${code}/${memberId}`;

/** The visitors screen on the iPad: where a member finds their own name before signing visitors in. */
export const ipadVisitorsPath = (code: string) => `/club/ipad/${code}/visitors`;

/** One member's visitor sign-in on the iPad, relative to the site. */
export const ipadVisitorsMemberPath = (code: string, memberId: string) => `/club/ipad/${code}/visitors/${memberId}`;

/**
 * The honor snack bar iPad's private address. Made from the same secret as the front-desk iPad's, with a different word
 * ("snacks"), so it is a different address: a leaked check-in address does not open the snack bar and the other way round,
 * and there is nothing more to set up. Changing the iPad secret switches both off.
 */
export function snackCode(secret: string): string {
  return keyed(secret, "snacks-v1").toString("base64url");
}

/** True only for the exact snack bar code made from this secret. */
export function verifySnackCode(secret: string, code: string): boolean {
  const expected = Buffer.from(snackCode(secret));
  const given = Buffer.from(code);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The snack bar's start screen, relative to the site. */
export const snackPath = (code: string) => `/club/snacks/${code}`;

/** One member's snack screen, relative to the site. */
export const snackMemberPath = (code: string, memberId: string) => `/club/snacks/${code}/${memberId}`;
