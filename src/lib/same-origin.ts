/**
 * Whether a form post came from this site's own pages. A browser marks where a post came from (Sec-Fetch-Site, Origin);
 * another website can make a visitor's browser post here, so the password forms refuse anything not from this site.
 */
export function sameOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (headers.get("x-forwarded-host") ?? headers.get("host"));
  } catch {
    return false;
  }
}
