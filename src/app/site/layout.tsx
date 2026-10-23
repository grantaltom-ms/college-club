import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PAGE_KEYS, PAGE_PATHS, SITE } from "@/site/content";
import { siteEnabled } from "@/site/enabled";
import { requireSite } from "@/site/guard";
import "./site.css";

/** Nothing about the public site, not even its title, appears when it is switched off. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!siteEnabled()) return {};
  return {
    title: { default: SITE.club.name, template: `%s | ${SITE.club.name}` },
    description: SITE.club.tagline,
    robots: { index: false, follow: false },
  };
}

/** What every public page shares: the menu, the preview banner and the footer. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await requireSite();
  const { club } = SITE;
  return (
    <div className="site">
      <header className="site-header">
        <div className="site-frame site-header-row">
          <Link href="/site" className="site-wordmark">
            {club.name}
          </Link>
          <nav aria-label="Main">
            {PAGE_KEYS.map((key) => (
              <Link key={key} href={PAGE_PATHS[key]}>
                {SITE.pages[key].title}
              </Link>
            ))}
            <Link href="/club/sign-in" className="site-signin" data-testid="site-signin">
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <div className="site-banner" role="note" data-testid="site-preview-banner">
        <p className="site-frame">Preview of the new club website. It is not live yet.</p>
      </div>
      <main className="site-frame">{children}</main>
      <footer className="site-footer">
        <div className="site-frame site-footer-row">
          <p>
            <strong>{club.name}</strong>
            <br />
            {club.address.map((line) => (
              <span key={line}>
                {line}
                <br />
              </span>
            ))}
          </p>
          <p>
            <a href={`tel:${club.phone.replaceAll("-", "")}`}>{club.phone}</a>
            <br />
            <a href={`mailto:${club.email}`}>{club.email}</a>
          </p>
          <p>
            Club: {club.hours.club}
            <br />
            Office: {club.hours.office}
          </p>
        </div>
      </footer>
    </div>
  );
}
