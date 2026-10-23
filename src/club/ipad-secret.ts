import { randomBytes } from "node:crypto";
import { clubEnabled } from "./enabled";

const MIN_LENGTH = 16;

/** One random secret per server process, shared by every part of it (pages and handlers are bundled separately, so a module variable would not be shared). */
const SHARED = Symbol.for("ccs.club.devIpadSecret");

/**
 * The secret behind the front-desk iPad's private address, or null when this server has none (and so no iPad).
 *
 * Set CLUB_IPAD_SECRET (at least 16 random characters) wherever the iPad must work. Changing it switches the old address off
 * at once, so a leaked address is fixed by changing one value. While developing on your own computer (not a production
 * build) a random secret is made for the run, so the address works until the server restarts. A deployed build with no
 * CLUB_IPAD_SECRET has no iPad rather than a different address on every server. Where the member area is switched off
 * there is no secret at all.
 */
export function getIpadSecret(env: Partial<Record<string, string | undefined>> = process.env): string | null {
  if (!clubEnabled(env)) return null;
  const configured = env.CLUB_IPAD_SECRET;
  if (configured) {
    if (configured.length < MIN_LENGTH) throw new Error(`CLUB_IPAD_SECRET must be at least ${MIN_LENGTH} characters.`);
    return configured;
  }
  if (env.NODE_ENV === "production") return null;
  const shared = globalThis as unknown as Record<symbol, string | undefined>;
  shared[SHARED] ??= randomBytes(32).toString("base64url");
  return shared[SHARED]!;
}
