import { clubEnabled } from "./enabled";

/**
 * "Now" for the member area. Normally the real clock. In development and tests only, CCS_CLUB_NOW
 * (for example 2026-10-28T20:00:00Z) freezes it so browser tests do not depend on the time of day.
 * It has no effect where the member area is switched off.
 */
export function clubNow(env: Partial<Record<string, string | undefined>> = process.env): Date {
  const frozen = env.CCS_CLUB_NOW;
  if (frozen && clubEnabled(env)) {
    const at = new Date(frozen);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return new Date();
}
