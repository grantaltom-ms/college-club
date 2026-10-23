import type { Metadata } from "next";
import { connection } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { requireClub } from "@/club/guard";
import "./club.css";

/** Nothing about the member area, not even its title, appears when it is switched off. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!clubEnabled()) return {};
  return {
    title: "College Club Seattle: members (test build)",
    description: "The College Club Seattle member area, running on invented test data.",
  };
}

/** What every member-area page shares: the fonts and colors, and the switch. The menu bar is in (member)/layout.tsx; the iPad has its own. */
export default async function ClubLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  return <div className="club">{children}</div>;
}
