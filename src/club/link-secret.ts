import { randomBytes } from "node:crypto";
import { clubEnabled } from "./enabled";

let fallback: string | null = null;

/**
 * The secret behind personal RSVP links. Set CLUB_LINK_SECRET (at least 16 characters) wherever links must keep working
 * across restarts and across servers. With it unset, the invented-data build makes a fresh random one for each server
 * process: links then work on that server only, until it restarts. Where the member area is switched off there is no secret
 * at all.
 */
export function getLinkSecret(env: Partial<Record<string, string | undefined>> = process.env): string {
  if (!clubEnabled(env)) throw new Error("RSVP links do not exist where the member area is switched off.");
  const configured = env.CLUB_LINK_SECRET;
  if (configured) {
    if (configured.length < 16) throw new Error("CLUB_LINK_SECRET must be at least 16 characters.");
    return configured;
  }
  fallback ??= randomBytes(32).toString("base64url");
  return fallback;
}
