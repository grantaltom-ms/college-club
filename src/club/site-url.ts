/**
 * The site's own address from the settings (CLUB_SITE_URL), for links in emails.
 *
 * - `undefined`: nothing is set.
 * - `null`: something is set but it is not a web address, and a bad setting is no setting (nothing falls back to anything else).
 * - a string: the address, like https://club.example.org (no path).
 *
 * Sign-in emails use this with the request's own address as a fallback in a test build only (a forged Host header could otherwise
 * send a victim's link to someone else's server). Emails sent after a change have no request, so with nothing set they carry no links.
 */
export function configuredSiteOrigin(env: Partial<Record<string, string | undefined>> = process.env): string | null | undefined {
  const configured = env.CLUB_SITE_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // fall through: a bad setting is no setting
  }
  return null;
}
