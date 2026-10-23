import { SITE } from "@/site/content";
import { requireSite } from "@/site/guard";
import { SitePage } from "./SitePage";

export default async function HomePage() {
  await requireSite();
  return <SitePage page={SITE.pages.home} />;
}
