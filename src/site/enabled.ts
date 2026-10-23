import { sampleDataAllowed } from "../club/enabled";

type Env = Partial<Record<string, string | undefined>>;

/**
 * Whether the new public website pages (`/site`) exist at all.
 *
 * Until cutover they are hidden on the live site exactly like the member area: visible while developing, in tests and on
 * preview deployments, and "page not found" on production. Switching them on for the public is a later, deliberate change
 * (open question D), and it changes this function only.
 */
export function siteEnabled(env: Env = process.env): boolean {
  return sampleDataAllowed(env);
}
