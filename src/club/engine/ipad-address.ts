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

function keyed(secret: string): Buffer {
  if (secret.length < MIN_SECRET) throw new Error(`The iPad secret must be at least ${MIN_SECRET} characters.`);
  return createHmac("sha256", secret).update("ipad-v1").digest();
}

/** The secret code for the iPad's address, ready to put in a web address. */
export function ipadCode(secret: string): string {
  return keyed(secret).toString("base64url");
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
