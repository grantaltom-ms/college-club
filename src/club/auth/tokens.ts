import { createHash, randomBytes } from "node:crypto";

/**
 * Secrets for signing in: a sign-in link's code, and the code in a signed-in browser's cookie. Both are long random
 * strings; the database only ever holds their SHA-256 fingerprints, so a copy of the database cannot be used to sign in.
 */

/** A fresh secret: 32 random bytes, 43 characters safe to put in an address or a cookie. */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** What looks like a secret made by `newSecret`. Anything else is refused before it touches the database. */
export const isSecretShape = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** The fingerprint the database keeps: 64 hex characters. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(`ccs-club-login-v1|${secret}`).digest("hex");
}
