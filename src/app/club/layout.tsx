import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { clubEnabled } from "@/club/enabled";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
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

export default async function ClubLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  const actor = await getCurrentActor();
  return (
    <div className="club">
      <header className="club-header">
        <div className="club-frame">
          <Link href="/club" className="club-wordmark">
            College Club Seattle
          </Link>
          <nav aria-label="Member area">
            <Link href="/club">{actor?.kind === "staff" ? "Households" : "My household"}</Link>
            <Link href="/club/act-as">Switch test member</Link>
          </nav>
        </div>
      </header>
      <div className="club-frame">
        <p className="club-banner" role="note">
          Test build. Every household, member and booking here is invented. Nothing is connected to real club data.
        </p>
        <p className="club-acting" data-testid="acting-as">
          {actor === null ? "Not acting as anyone." : actor.kind === "staff" ? `Acting as ${actor.label}.` : `Acting as ${fullName(actor.member)}.`}
        </p>
        <main>{children}</main>
      </div>
    </div>
  );
}
