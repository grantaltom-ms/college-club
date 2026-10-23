import { randomBytes } from "node:crypto";
import { clubEnabled } from "./enabled";

const MIN_LENGTH = 16;

/** One random secret per server process, shared by every part of it (pages and handlers are bundled separately, so a module variable would not be shared). */
const SHARED = Symbol.for("ccs.club.devLinkSecret");

/**
 * The secret behind personal RSVP links, or null when this server has none.
 *
 * Set CLUB_LINK_SECRET (at least 16 random characters) wherever links must work: it is what makes a link fit one person and
 * one event. While developing on your own computer (not a production build) a random secret is made for the run, so links
 * work until the server restarts. A deployed build with no CLUB_LINK_SECRET has no secret and no links, rather than a
 * different secret on every server. Where the member area is switched off there is no secret at all.
 */
export function getLinkSecret(env: Partial<Record<string, string | undefined>> = process.env): string | null {
  if (!clubEnabled(env)) return null;
  const configured = env.CLUB_LINK_SECRET;
  if (configured) {
    if (configured.length < MIN_LENGTH) throw new Error(`CLUB_LINK_SECRET must be at least ${MIN_LENGTH} characters.`);
    return configured;
  }
  if (env.NODE_ENV === "production") return null;
  const shared = globalThis as unknown as Record<symbol, string | undefined>;
  shared[SHARED] ??= randomBytes(32).toString("base64url");
  return shared[SHARED]!;
}
