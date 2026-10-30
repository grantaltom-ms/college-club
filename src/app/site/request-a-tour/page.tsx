import { SITE, phoneHref } from "@/site/content";
import { requireSite } from "@/site/guard";
import { pageMetadata } from "@/site/metadata";
import { SitePage } from "../SitePage";
import { TourForm } from "./TourForm";

export const generateMetadata = () => pageMetadata("tour");

export default async function RequestATourPage() {
  await requireSite();
  const { club } = SITE;
  return (
    <SitePage page={SITE.pages.tour}>
      <section className="site-section site-tour" aria-label="Request a tour">
        <TourForm phone={club.phone} />
        <p className="site-tour-talk">
          Prefer to talk? Call <a href={phoneHref(club.phone)}>{club.phone}</a> or email <a href={`mailto:${club.email}`}>{club.email}</a>.
        </p>
      </section>
    </SitePage>
  );
}
