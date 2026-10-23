import type { Metadata } from "next";
import { connection } from "next/server";
import { SITE, type PageKey } from "./content";
import { siteEnabled } from "./enabled";

/** A page's browser-tab title. Empty when the public site is switched off, so a hidden page gives nothing away, not even its name. */
export async function pageMetadata(key: PageKey): Promise<Metadata> {
  await connection();
  return siteEnabled() ? { title: SITE.pages[key].title } : {};
}
