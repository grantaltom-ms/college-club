/**
 * Where "Member login" goes, kept in one place (the design handoff asks for exactly that).
 *
 * With nothing set it is the sign-in page of this same site, `/club/sign-in`. When the club is ready to give its members a
 * separate address (for example https://members.collegeclubseattle.com), set `NEXT_PUBLIC_MEMBER_APP_URL` to it in Vercel's
 * settings and redeploy: every Member login link on the public pages follows. (The address is part of the built site, so a
 * change needs a new deploy. Pointing that address at this app is a Vercel and domain change, made by whoever holds the domain.)
 *
 * A setting that is not a safe web address is ignored, and the default is used, with a line in the server log.
 */
export const DEFAULT_MEMBER_APP_URL = "/club/sign-in";

export function resolveMemberAppUrl(raw: string | undefined, log: (line: string) => void = console.error): string {
  const value = raw?.trim() ?? "";
  if (value === "") return DEFAULT_MEMBER_APP_URL;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const safe = url.protocol === "https:" || (local && url.protocol === "http:");
    if (safe && url.username === "" && url.password === "") {
      const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
      return `${url.origin}${path}`;
    }
  } catch {
    // Not an address at all: fall through to the default.
  }
  log(`NEXT_PUBLIC_MEMBER_APP_URL is not a safe web address (it must start with https://), so ${DEFAULT_MEMBER_APP_URL} is used instead.`);
  return DEFAULT_MEMBER_APP_URL;
}

/** Every Member login link on the public pages. */
export const MEMBER_APP_URL = resolveMemberAppUrl(process.env.NEXT_PUBLIC_MEMBER_APP_URL);

/** The club's current public website, where the sign-in screen's "Back to" link goes. */
export const PUBLIC_SITE_URL = "https://collegeclubseattle.com";
