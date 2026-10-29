import type { Metadata, Viewport } from "next";
import { requireClub } from "@/club/guard";
import { memberAppMetadata, memberAppViewport } from "@/club/pwa";
import "@/components/ds/ds.css";

export const generateMetadata = (): Promise<Metadata> => memberAppMetadata();
export const generateViewport = (): Promise<Viewport> => memberAppViewport();

/**
 * The member sign-in screen's frame: no menu bar, no test-build banner and no "acting as" line, like the front-desk iPad. Those
 * belong to the pages you reach once you are in (the (member) folder beside this one). The screen draws its own dark header
 * band and keeps its own on/off switch, so it is "page not found" on the live site like everything under /club.
 */
export default async function EntryLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  return <div className="ds-app ds-ui">{children}</div>;
}
