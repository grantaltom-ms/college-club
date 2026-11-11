import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { demoGateState } from "@/club/demo-gate";
import { pickerEnabled } from "@/club/enabled";
import { ipadCode, ipadPath, snackCode, snackPath } from "@/club/engine/ipad-address";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getIpadSecret } from "@/club/ipad-secret";
import { demoMember } from "@/club/start";
import { getClubStore } from "@/club/store/instance";
import { STAFF_HOME } from "@/club/web";

/** Nothing about the page, not even its title, appears where it does not exist. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (!pickerEnabled()) return {};
  return { title: "College Club Seattle: try the system (test build)" };
}

/**
 * The test landing page: four ways into the reservation system, for trying it out, plus a tile that opens the preview of the new
 * public website (/site, which is hidden on the live site exactly like /club). The dashboard's "CCS System" link comes here.
 * The building comparison: the model apartment's front door, with a sign saying which of the four rooms to look at.
 *
 * Member and staff views sign you in as an invented person (the test picker, by one button each). The two iPad views open in a
 * new tab, because the real iPad screens have no menu and go back to their own start by themselves. The iPad addresses carry a
 * secret code made from CLUB_IPAD_SECRET; they are worked out here and shown nowhere the picker is not, so on the live site there
 * is no page, no code and no link.
 */
export default async function StartPage() {
  await requireClub();
  if (!pickerEnabled()) notFound();
  const state = await (await getClubStore()).read();
  const member = demoMember(state);
  const secret = getIpadSecret();
  const checkInAddress = secret ? ipadPath(ipadCode(secret)) : null;
  const snackAddress = secret ? snackPath(snackCode(secret)) : null;

  return (
    <section>
      <header className="club-page-head">
        <div>
          <h1>CCS System</h1>
          <p className="club-lead">
            The club&apos;s reservation and member system, running on invented people and bookings. Nothing here is real, and nothing here reaches a real member. Pick a view to try.
          </p>
        </div>
      </header>
      <ul className="club-cards" aria-label="Views to try">
        <li className="club-card" data-testid="start-member">
          <h2>Test member view</h2>
          <p>See the club the way a member does: book a boat, join a class, RSVP to an event.</p>
          {member ? (
            <>
              <p className="club-meta">You will be signed in as {fullName(member)}, an invented member who owns a private boat.</p>
              <form method="post" action="/api/club/act-as" className="club-actions">
                <input type="hidden" name="actor" value={`member:${member.id}`} />
                <input type="hidden" name="next" value="/club" />
                <button type="submit" className="club-button" data-testid="start-member-open">
                  Open member view
                </button>
              </form>
              <p className="club-meta">
                <Link href="/club/act-as" data-testid="start-member-other">
                  Pick a different test member
                </Link>
              </p>
            </>
          ) : (
            <p className="club-alert" role="status" data-testid="start-member-none">
              There is no active member in this test club to sign in as.
            </p>
          )}
        </li>
        <li className="club-card" data-testid="start-staff">
          <h2>Test staff view</h2>
          <p>See what staff see: Today at the Club, then households, bookings, check-in, equipment, charges and billing.</p>
          <p className="club-meta">You will be acting as Test staff.</p>
          <form method="post" action="/api/club/act-as" className="club-actions">
            <input type="hidden" name="actor" value="staff" />
            <input type="hidden" name="next" value={STAFF_HOME} />
            <button type="submit" className="club-button" data-testid="start-staff-open">
              Open staff view
            </button>
          </form>
        </li>
        <li className="club-card" data-testid="start-snacks">
          <h2>Test iPad: honor snack bar</h2>
          <p>The screen for the snack bar iPad: a member types their name, picks how many snacks, and it goes on their household&apos;s account for the month.</p>
          {snackAddress ? (
            <>
              <p className="club-meta">Opens in a new tab, the way it sits on its own iPad.</p>
              <p className="club-actions">
                <a href={snackAddress} target="_blank" rel="noopener noreferrer" className="club-button club-button-link" data-testid="start-snacks-open">
                  Open snack bar screen
                </a>
              </p>
            </>
          ) : (
            <IpadOff />
          )}
        </li>
        <li className="club-card" data-testid="start-checkin">
          <h2>Test iPad: check-in</h2>
          <p>The front-desk screen where members check themselves in for a boat, a space or a class.</p>
          {checkInAddress ? (
            <>
              <p className="club-meta">Opens in a new tab, the way it sits on the front-desk iPad.</p>
              <p className="club-actions">
                <a href={checkInAddress} target="_blank" rel="noopener noreferrer" className="club-button club-button-link" data-testid="start-checkin-open">
                  Open check-in screen
                </a>
              </p>
            </>
          ) : (
            <IpadOff />
          )}
        </li>
        <li className="club-card" data-testid="start-site">
          <h2>Preview: new club website</h2>
          <p>The public website that will replace the Wix site: the homepage, About, Membership, Programs, Contact and the Request a tour form.</p>
          <p className="club-meta">Opens in a new tab. It is a preview: it is not live, and a tour request sent here only reaches this test club.</p>
          <p className="club-actions">
            <a href="/site" target="_blank" rel="noopener noreferrer" className="club-button club-button-link" data-testid="start-site-open">
              Open website preview
            </a>
          </p>
        </li>
      </ul>
      <p className="club-meta">
        <Link href="/" data-testid="start-back">
          Back to the dashboard
        </Link>
      </p>
      {demoGateState() === "on" && (
        <form method="post" action="/api/demo/lock" className="club-actions" data-testid="start-lock-form">
          <button type="submit" className="club-button club-button-quiet" data-testid="start-lock">
            Lock the demo on this device
          </button>
        </form>
      )}
    </section>
  );
}

function IpadOff() {
  return (
    <p className="club-alert" role="status" data-testid="start-ipad-off">
      The iPad screens are switched off here, because no iPad secret has been set. Set CLUB_IPAD_SECRET (at least 16 random characters) where this site is run, then come back.
    </p>
  );
}
