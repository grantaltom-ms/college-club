import Link from "next/link";
import { clubNow } from "@/club/clock";
import { myPractices, sideWords } from "@/club/engine/practices";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { SignedOut } from "../SignedOut";
import { whenWords } from "../practices/words";

/** The practices a member is seated in, with their boat, seat and side. A record only: a coach or staff change the lineup. */
export default async function MyPracticesPage() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind === "staff") {
    return (
      <section>
        <h1>My practices</h1>
        <p>
          Staff see every practice on the <Link href="/club/practices">Practices</Link> screen.
        </p>
      </section>
    );
  }
  const state = await (await getClubStore()).read();
  const lines = myPractices(state, actor.member.id, clubNow());

  return (
    <section>
      <h1>My practices</h1>
      <p>
        When a coach or club staff put you in the lineup for a practice, it shows here with your boat, seat and side. Ordinary bookings do not need one. <Link href="/club/my-bookings">My bookings</Link>
      </p>
      {lines.length === 0 ? (
        <p data-testid="no-practices">You are not in the lineup for any practice coming up.</p>
      ) : (
        <ul className="club-cards" aria-label="Practices you are in">
          {lines.map((l) => (
            <li key={l.practiceId} className="club-card" data-testid="my-practice" data-practice={l.name}>
              <h2>
                <Link href={`/club/practices/${l.practiceId}`}>{l.name}</Link>
              </h2>
              <p>{whenWords(l.startsAt, l.endsAt)}</p>
              <p data-testid="my-seat">
                <strong>{l.boat}</strong>, seat {l.seat} &middot; {sideWords(l.side).toLowerCase()}
              </p>
              <p className="club-meta">
                Run by {l.coachName}
                {l.crew.length > 0 ? ` · In the boat with ${l.crew.join(", ")}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
