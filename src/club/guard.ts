import { notFound } from "next/navigation";
import { connection } from "next/server";
import { clubEnabled } from "./enabled";

/**
 * First line of every member-area page and layout. A layout's "page not found" does not stop the page beside it
 * from rendering, so each page must check the switch itself before it reads any data.
 */
export async function requireClub(): Promise<void> {
  // Decide per request, never at build time: the same build must be hidden on the live site and open on previews.
  await connection();
  if (!clubEnabled()) notFound();
}
