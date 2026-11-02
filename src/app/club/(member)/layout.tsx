import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { memberAppMetadata, memberAppViewport } from "@/club/pwa";
import { readClubOnce } from "@/club/store/read-once";

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
  return (
    <>
      <header className="club-header">
        <div className="club-frame">
          <Link href="/club" className="club-wordmark">
            College Club Seattle
          </Link>
          <nav aria-label="Member area">
            <Link href="/club">{actor?.kind === "staff" ? "Households" : "My household"}</Link>
            {actor && <Link href="/club/book">Book</Link>}
            {actor && <Link href="/club/my-bookings">{actor.kind === "staff" ? "All bookings" : "My bookings"}</Link>}
            {actor && <Link href="/club/classes">Classes</Link>}
            {actor && <Link href="/club/events">Events</Link>}
            {actor?.kind === "member" && <Link href="/club/my-classes">My classes</Link>}
            {hasBoats && <Link href="/club/my-boats">My boats</Link>}
            {(actor?.kind === "staff" || (actor?.kind === "member" && actor.member.isCoach === true)) && <Link href="/club/practices">Practices</Link>}
            {actor?.kind === "member" && actor.member.isCoach === true && <Link href="/club/incidents">Report an incident</Link>}
            {actor?.kind === "staff" && <Link href="/club/admin">Staff office</Link>}
            {actor?.kind === "staff" && <Link href="/club/equipment">Equipment</Link>}
            {actor === null && <Link href="/club/sign-in">Sign in</Link>}
            {pickerEnabled() && <Link href="/club/act-as">Switch test member</Link>}
            {actor?.source === "login" && (
              <form method="post" action="/api/club/sign-out">
                <button type="submit">Sign out</button>
              </form>
            )}
          </nav>
        </div>
      </header>
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
