import { notFound } from "next/navigation";
import { connection } from "next/server";
import { siteEnabled } from "./enabled";

/**
 * First line of every public-site page and layout. A layout's "page not found" does not stop the page beside it from
 * rendering, so each page checks the switch itself. Decided per request, never at build time: the same build must be
 * hidden on the live site and open on previews.
 */
export async function requireSite(): Promise<void> {
  await connection();
  if (!siteEnabled()) notFound();
}
