import { Homepage } from "./Homepage";
import { PAGE_PATHS, SITE } from "@/site/content";
import { requireSite } from "@/site/guard";
import { HERO_PHOTO } from "@/site/hero-photo";

export default async function HomePage() {
  await requireSite();
  return <Homepage content={SITE.homepage} tourHref={PAGE_PATHS.tour} photo={HERO_PHOTO} />;
}
