import { SITE } from "@/site/content";
import { requireSite } from "@/site/guard";
import { pageMetadata } from "@/site/metadata";
import { SitePage } from "../SitePage";

export const generateMetadata = () => pageMetadata("about");

export default async function Page() {
  await requireSite();
  return <SitePage page={SITE.pages.about} />;
}
