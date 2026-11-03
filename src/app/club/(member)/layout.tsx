import type { Metadata, Viewport } from "next";
import { pickerEnabled } from "@/club/enabled";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { memberAppMetadata, memberAppViewport } from "@/club/pwa";
import { readClubOnce } from "@/club/store/read-once";
import { MemberNav, type MemberNavLink } from "./MemberNav";

export const generateMetadata = (): Promise<Metadata> => memberAppMetadata();
export const generateViewport = (): Promise<Viewport> => memberAppViewport();

/**
 * The menu bar, the test-build banner and the "acting as" line, around every member and staff page. The front-desk iPad
 * (app/club/ipad) sits outside this folder on purpose: a shared screen should not show anyone's menu.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  const actor = await getCurrentActor();
  // "My boats" is only offered to members who own a private boat or were invited to one.
  const hasBoats = actor?.kind === "member" && (await readClubOnce()).boatAccess.some((a) => a.memberId === actor.member.id && a.endedAt === null);

  const links: MemberNavLink[] = [];
  if (actor) {
    links.push({ href: "/club/book", label: "Book", group: "go" });
    links.push({ href: "/club/my-bookings", label: actor.kind === "staff" ? "All bookings" : "My bookings", group: actor.kind === "staff" ? "desk" : "mine" });
    links.push({ href: "/club/classes", label: "Classes", group: "go" });
    links.push({ href: "/club/events", label: "Events", group: "go" });
    if (actor.kind === "member") links.push({ href: "/club/my-classes", label: "My classes", group: "mine" });
    if (hasBoats) links.push({ href: "/club/my-boats", label: "My boats", group: "mine" });
    if (actor.kind === "staff" || (actor.kind === "member" && actor.member.isCoach === true)) {
      links.push({ href: "/club/practices", label: "Practices", group: "go" });
    }
    if (actor.kind === "member" && actor.member.isCoach === true) {
      links.push({ href: "/club/incidents", label: "Report an incident", group: "mine" });
    }
    if (actor.kind === "staff") {
      links.push({ href: "/club/admin", label: "Staff office", group: "desk" });
      links.push({ href: "/club/equipment", label: "Equipment", group: "desk" });
    }
  }
  if (actor === null) links.push({ href: "/club/sign-in", label: "Sign in", group: "account" });
  if (pickerEnabled()) links.push({ href: "/club/act-as", label: "Switch test member", group: "account" });

  return (
    <>
      <MemberNav
        homeHref="/club"
        homeLabel={actor?.kind === "staff" ? "Households" : "My household"}
        links={links}
        showSignOut={actor?.source === "login"}
      />
      <div className="club-frame">
        <p className="club-banner" role="note">
          Test build. Every household, member and booking here is invented. Nothing is connected to real club data.
        </p>
        <p className="club-acting" data-testid="acting-as">
          {actor === null
            ? "Not acting as anyone."
            : actor.source === "login"
              ? `Signed in as ${actor.kind === "staff" ? actor.label : fullName(actor.member)}.`
              : actor.kind === "staff"
                ? `Acting as ${actor.label}.`
                : `Acting as ${fullName(actor.member)}.`}
        </p>
        <main>{children}</main>
      </div>
    </>
  );
}
