import type { Metadata, Viewport } from "next";
import { pickerEnabled } from "@/club/enabled";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { memberAppMetadata, memberAppViewport } from "@/club/pwa";
import { readClubOnce } from "@/club/store/read-once";
import "../club-app.css";
import { MemberNav, type MemberNavLink } from "./MemberNav";

export const generateMetadata = (): Promise<Metadata> => memberAppMetadata();
export const generateViewport = (): Promise<Viewport> => memberAppViewport();

/**
 * The test-build banner, the menu bar (with the "acting as" line at its right) and the page frame, around every member and staff page.
 * `.club-app` is what scopes the Nov 2026 look (club-app.css) to this folder: nothing outside it changes. The front-desk iPad
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
    links.push({ href: "/club/my-bookings", label: actor.kind === "staff" ? "All bookings" : "My bookings", group: actor.kind === "staff" ? "desk" : "me" });
    links.push({ href: "/club/classes", label: "Classes", group: "go" });
    links.push({ href: "/club/events", label: "Events", group: "go" });
    // A member's own pages are one dropdown, My account: My household (the home link, below), My bookings, My classes, My bill, My boats.
    if (actor.kind === "member") links.push({ href: "/club/my-classes", label: "My classes", group: "me" });
    if (actor.kind === "member") links.push({ href: "/club/my-bill", label: "My bill", group: "me" });
    if (hasBoats) links.push({ href: "/club/my-boats", label: "My boats", group: "me" });
    if (actor.kind === "staff" || (actor.kind === "member" && actor.member.isCoach === true)) {
      links.push({ href: "/club/practices", label: "Practices", group: "go" });
    }
    if (actor.kind === "member" && actor.member.isCoach === true) {
      links.push({ href: "/club/incidents", label: "Report an incident", group: "coach" });
    }
    if (actor.kind === "staff") {
      links.push({ href: "/club/admin", label: "Staff office", group: "desk" });
      links.push({ href: "/club/equipment", label: "Equipment", group: "desk" });
    }
  }
  if (actor === null) links.push({ href: "/club/sign-in", label: "Sign in", group: "account" });
  if (pickerEnabled()) links.push({ href: "/club/act-as", label: "Switch test member", group: "account" });

  const acting =
    actor === null
      ? "Not acting as anyone."
      : actor.source === "login"
        ? `Signed in as ${actor.kind === "staff" ? actor.label : fullName(actor.member)}.`
        : actor.kind === "staff"
          ? `Acting as ${actor.label}.`
          : `Acting as ${fullName(actor.member)}.`;

  return (
    <div className="club-app">
      <p className="club-banner" role="note">
        Test build. Every household, member and booking here is invented. Nothing is connected to real club data.
      </p>
      <MemberNav
        homeHref="/club"
        homeLabel={actor?.kind === "staff" ? "Households" : "My household"}
        homeGroup={actor?.kind === "member" ? "me" : "mine"}
        links={links}
        showSignOut={actor?.source === "login"}
        acting={acting}
      />
      <div className="club-frame">
        <main>{children}</main>
      </div>
    </div>
  );
}
