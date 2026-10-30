import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteFooter } from "@/components/ds/SiteFooter";
import { SiteHeader } from "@/components/ds/SiteHeader";
import { StickyCta } from "@/components/ds/StickyCta";
import { Logo } from "@/components/ds/Pieces";
import { NAV, PAGE_PATHS, SITE } from "@/site/content";
import { siteEnabled } from "@/site/enabled";
import { requireSite } from "@/site/guard";
import { MEMBER_APP_URL } from "@/site/links";
import "@/components/ds/ds.css";
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

/** What every public page shares: the preview banner, the sticky header, the footer, and the phone-only "Request a tour" bar. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await requireSite();
  const { club, footer } = SITE;
  return (
    <div className="site">
      <div className="site-banner" role="note" data-testid="site-preview-banner">
        <p className="site-frame">Preview of the new club website. It is not live yet.</p>
      </div>
      <SiteHeader nav={NAV} memberLoginHref={MEMBER_APP_URL}>
        <Logo tone="black" size={36} />
      </SiteHeader>
      <main>{children}</main>
      <SiteFooter heading={footer.heading} address={club.address} phone={club.phone} copyright={footer.copyright} memberLoginHref={MEMBER_APP_URL} />
      <StickyCta href={PAGE_PATHS.tour} label="Request a tour" />
    </div>
  );
}
