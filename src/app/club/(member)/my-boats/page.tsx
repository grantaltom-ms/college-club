import Link from "next/link";
import { clubNow } from "@/club/clock";
import { findBoatPeople, myInvitedBoats, myOwnedBoats } from "@/club/engine/boat-access";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDay } from "@/club/time";
import { idParam } from "@/club/web";
import { AddToBoatButton, RemoveFromBoatButton } from "../BoatButtons";
import { SignedOut } from "../SignedOut";
import { inviteToMyBoat, removeFromMyBoat } from "./actions";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Members who own a private boat: who may use it. An owner invites other members and takes them off again, and it works at
 * once. Everyone else sees only the boats they were invited to. Staff are pointed to their own screen.
 */
export default async function MyBoatsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind === "staff") {
    return (
      <section>
        <h1>My boats</h1>
        <p>
          Staff manage private boats on the <Link href="/club/admin/boats">Private boats</Link> screen.
        </p>
      </section>
    );
  }
  const params = await searchParams;
  const state = await (await getClubStore()).read();
  const now = clubNow();
  const owned = myOwnedBoats(state, RULE_BOOK, actor.member.id, now);
  const invited = myInvitedBoats(state, RULE_BOOK, actor.member.id);
  const boat = idParam(params.boat);
  const typed = one(params.q);

  return (
    <section>
      <h1>My boats</h1>
      <p>
        A private boat can be booked, and sat in, only by its owners and the people an owner has invited. Nobody else is shown it. <Link href="/club/book">Book a boat</Link>
      </p>

      {owned.length === 0 && invited.length === 0 && (
        <p data-testid="no-boats">You are not an owner of a private boat, and no owner has invited you to one.</p>
      )}

      {owned.map((b) => {
        const search = boat === b.itemId && typed !== "" ? findBoatPeople(state, b.itemId, typed) : null;
        return (
          <article key={b.itemId} className="club-card" data-testid="my-boat" aria-label={b.name}>
            <h2>{b.name}</h2>
            <p className="club-meta">
              {b.className} &middot; {b.upcoming === 0 ? "no upcoming bookings" : `${b.upcoming} upcoming booking${b.upcoming === 1 ? "" : "s"}`}
            </p>
            <h3>Owners</h3>
            <ul className="club-list" data-testid="boat-owners">
              {b.owners.map((o) => (
                <li key={o.accessId}>{o.name}</li>
              ))}
            </ul>
            <p className="club-meta">Only club staff can change the owners.</p>
            <h3>People you have invited</h3>
            {b.invited.length === 0 ? (
              <p data-testid="boat-no-invited">Nobody yet.</p>
            ) : (
              <ul className="club-list" data-testid="boat-invited">
                {b.invited.map((p) => (
                  <li key={p.accessId}>
                    {p.name} <span className="club-meta">&middot; invited {formatDay(p.addedAt.slice(0, 10))} by {p.addedBy}</span>
                    <RemoveFromBoatButton action={removeFromMyBoat} accessId={p.accessId} name={p.name} bookings={p.removal.bookings} crewSeats={p.removal.crewSeats} />
                  </li>
                ))}
              </ul>
            )}
            <h3>Invite someone</h3>
            <form method="get" action="/club/my-boats" className="club-form" data-testid="boat-search">
              <input type="hidden" name="boat" value={b.itemId} />
              <p>
                <label htmlFor={`q-${b.itemId}`}>Name of the member (at least 3 letters)</label>
                <input id={`q-${b.itemId}`} name="q" type="text" maxLength={60} defaultValue={boat === b.itemId ? typed : ""} autoComplete="off" />
              </p>
              <p>
                <button type="submit" className="club-button">
                  Find
                </button>
              </p>
            </form>
            {search?.tooShort && <p className="club-meta">Type at least 3 letters of the name.</p>}
            {search && !search.tooShort && search.people.length === 0 && <p data-testid="boat-no-matches">No member matches that, or they are already on the list.</p>}
            {search && search.people.length > 0 && (
              <ul className="club-list" data-testid="boat-matches">
                {search.people.map((p) => (
                  <li key={p.memberId} data-testid="boat-person">
                    {p.name}
                    {p.household ? <span className="club-meta"> &middot; {p.household}</span> : null}
                    <AddToBoatButton action={inviteToMyBoat} boatId={b.itemId} memberId={p.memberId} label="Invite" name={p.name} />
                  </li>
                ))}
                {search.more && <li className="club-meta">More members match. Type more of the name to narrow it down.</li>}
              </ul>
            )}
            <p className="club-meta">Anyone you invite can book the boat and be in it with you. Taking someone off cancels their upcoming bookings on this boat.</p>
          </article>
        );
      })}

      {invited.length > 0 && (
        <>
          <h2>Boats you are invited to</h2>
          <ul className="club-list" data-testid="invited-boats">
            {invited.map((b) => (
              <li key={b.itemId}>
                {b.name} <span className="club-meta">&middot; {b.className}</span>
                {b.locked && <span className="club-meta"> &middot; locked: it has no owner right now</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
