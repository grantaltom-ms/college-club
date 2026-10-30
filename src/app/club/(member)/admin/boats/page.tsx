import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { boatAccessLog, findBoatPeople, privateBoats } from "@/club/engine/boat-access";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatMoment } from "@/club/time";
import { idParam } from "@/club/web";
import { AddToBoatButton, RemoveFromBoatButton } from "../../BoatButtons";
import { SignedOut } from "../../SignedOut";
import { inviteAsStaff, makeOwner, takeOffBoat } from "./actions";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";
const LOG_LINES = 8;

/**
 * Staff only: every private boat, who owns it and who an owner has invited, and the record of who was let on or taken off.
 * A private boat with no owner who can use it is locked until staff add one here.
 */
export default async function PrivateBoatsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const params = await searchParams;
  const state = await (await getClubStore()).read();
  const boats = privateBoats(state, RULE_BOOK, clubNow());
  const boat = idParam(params.boat);
  const typed = one(params.q);
  const locked = boats.filter((b) => b.locked).length;

  return (
    <section>
      <h1>Private boats</h1>
      <p>
        A private boat belongs to members. Only its owners, and the people an owner has invited, can see or book it, and its skill level is not checked. Staff name the owners; an owner can invite others from{" "}
        <em>My boats</em>. If a boat has no owner who can still use it, it is locked until you add one here. <Link href="/club/admin">Back to the Staff office</Link> &middot; <Link href="/club/admin/equipment-import">Load the equipment list</Link>
      </p>
      <p data-testid="boats-summary">
        {boats.length === 0 ? "There are no private boats yet." : `${boats.length} private boat${boats.length === 1 ? "" : "s"}${locked > 0 ? `, ${locked} locked with no owner` : ""}.`}
      </p>

      {boats.map((b) => {
        const search = boat === b.itemId && typed !== "" ? findBoatPeople(state, b.itemId, typed) : null;
        const log = boatAccessLog(state, b.itemId);
        return (
          <article key={b.itemId} className="club-card" data-testid="private-boat" aria-label={b.name}>
            <h2>
              {b.name}
              {b.locked && (
                <span className="club-tag" data-testid="boat-locked">
                  {" "}
                  Locked
                </span>
              )}
            </h2>
            <p className="club-meta">
              {b.className} &middot; {b.upcoming === 0 ? "no upcoming bookings" : `${b.upcoming} upcoming booking${b.upcoming === 1 ? "" : "s"}`}
            </p>
            {b.locked && (
              <p className="club-alert" role="note">
                Nobody can book this boat: it has no owner who can still use it. Add an owner below.
                {b.upcoming > 0 ? " Bookings already made stay." : ""}
              </p>
            )}
            <h3>Owners</h3>
            {b.owners.length === 0 ? (
              <p data-testid="boat-no-owners">No owners.</p>
            ) : (
              <ul className="club-list" data-testid="boat-owners">
                {b.owners.map((o) => (
                  <li key={o.accessId}>
                    {o.name}
                    {!o.active && <span className="club-meta"> &middot; no longer an active member</span>}
                    <span className="club-meta"> &middot; added {formatDay(o.addedAt.slice(0, 10))} by {o.addedBy}</span>
                    <RemoveFromBoatButton action={takeOffBoat} accessId={o.accessId} name={o.name} bookings={o.removal.bookings} crewSeats={o.removal.crewSeats} />
                  </li>
                ))}
              </ul>
            )}
            <h3>Invited by an owner</h3>
            {b.invited.length === 0 ? (
              <p data-testid="boat-no-invited">Nobody.</p>
            ) : (
              <ul className="club-list" data-testid="boat-invited">
                {b.invited.map((p) => (
                  <li key={p.accessId}>
                    {p.name}
                    {!p.active && <span className="club-meta"> &middot; no longer an active member</span>}
                    <span className="club-meta"> &middot; added {formatDay(p.addedAt.slice(0, 10))} by {p.addedBy}</span>
                    <RemoveFromBoatButton action={takeOffBoat} accessId={p.accessId} name={p.name} bookings={p.removal.bookings} crewSeats={p.removal.crewSeats} />
                  </li>
                ))}
              </ul>
            )}
            <h3>Add someone</h3>
            <form method="get" action="/club/admin/boats" className="club-form" data-testid="boat-search">
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
            {search && !search.tooShort && search.people.length === 0 && <p data-testid="boat-no-matches">No active member matches that, or they are already on the list.</p>}
            {search && search.people.length > 0 && (
              <ul className="club-list" data-testid="boat-matches">
                {search.people.map((p) => (
                  <li key={p.memberId} data-testid="boat-person">
                    {p.name}
                    {p.household ? <span className="club-meta"> &middot; {p.household}</span> : null}
                    <AddToBoatButton action={makeOwner} boatId={b.itemId} memberId={p.memberId} label="Make owner" name={p.name} />
                    <AddToBoatButton action={inviteAsStaff} boatId={b.itemId} memberId={p.memberId} label="Invite" name={p.name} />
                  </li>
                ))}
                {search.more && <li className="club-meta">More members match. Type more of the name to narrow it down.</li>}
              </ul>
            )}
            <h3>Record</h3>
            {log.length === 0 ? (
              <p className="club-meta">Nothing yet.</p>
            ) : (
              <ul className="club-list" data-testid="boat-log">
                {log.slice(0, LOG_LINES).map((l, i) => (
                  <li key={i}>
                    <span className="club-meta">{formatMoment(l.at)}</span> {l.text}
                  </li>
                ))}
                {log.length > LOG_LINES && <li className="club-meta">&hellip;and {log.length - LOG_LINES} older lines.</li>}
              </ul>
            )}
          </article>
        );
      })}
    </section>
  );
}
