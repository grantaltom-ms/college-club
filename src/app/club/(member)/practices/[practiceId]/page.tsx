import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { canRunPractices, findRowers, practiceDetail, reservableBoats, sideWords } from "@/club/engine/practices";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { PRACTICE_RULES } from "@/club/settings/practice-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { idParam } from "@/club/web";
import { PracticePlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";
import { AddBoatForm, CancelPracticeForm, SeatForm, TakeBoatOffButton, TakeOutButton } from "../PracticeForms";
import { whenWords } from "../words";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * One practice. Staff and coaches see all of it: the boats it reserves, the lineup, the bookings already made on those boats at that
 * time, and (for the coach who runs it, and staff) the buttons to change it. A member who is seated in it sees the practice and
 * their own boat with the people in it, and nothing else. Anyone else gets "page not found".
 */
export default async function PracticePage({ params, searchParams }: { params: Promise<{ practiceId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const practiceId = idParam((await params).practiceId);
  if (!practiceId) notFound();
  const search = await searchParams;
  const state = await (await getClubStore()).read();
  const now = clubNow();
  const me = toEngineActor(actor);
  const d = practiceDetail(state, RULE_BOOK, practiceId, me, now);
  if (!d) notFound();
  const runner = canRunPractices(state, me);
  const typed = one(search.find);
  const found = d.canEdit && typed !== "" ? findRowers(state, practiceId, typed) : null;
  const onPractice = new Set(d.boats.map((b) => b.itemId));
  const addable = d.canEdit ? reservableBoats(state, RULE_BOOK).filter((b) => !onPractice.has(b.id)) : [];
  const emptySeats = d.boats.flatMap((b) => b.seats.filter((s) => s.memberId === null).map((s) => ({ value: `${b.itemId}:${s.seat}`, label: `${b.name}, seat ${s.seat}` })));

  return (
    <section>
      <h1>
        {d.name}
        {d.status === "cancelled" && <span className="club-tag">Cancelled</span>}
      </h1>
      <p>
        <Link href={runner ? "/club/practices" : "/club/my-practices"}>{runner ? "Back to practices" : "Back to my practices"}</Link>
      </p>
      {search.made === "1" && (
        <p className="club-success" role="status" data-testid="practice-made">
          The practice is set up and its boats are reserved.
        </p>
      )}

      <article className="club-card" data-testid="practice" data-status={d.status}>
        <p data-testid="practice-when">{whenWords(d.startsAt, d.endsAt)}</p>
        <p className="club-meta">Run by {d.coachName}</p>
        {!d.coachActive && <p className="club-meta">This coach is no longer marked as a coach, so only club staff can change the practice.</p>}
        {d.notes && (
          <p data-testid="practice-notes" style={{ whiteSpace: "pre-line" }}>
            {d.notes}
          </p>
        )}
        {d.status === "cancelled" && <p data-testid="practice-cancelled">Cancelled{d.cancelReason ? `: ${d.cancelReason}` : "."}</p>}
        {d.mine && (
          <p data-testid="my-place">
            <strong>Your place:</strong> {d.mine.boat}, seat {d.mine.seat} ({sideWords(d.mine.side).toLowerCase()}).
          </p>
        )}
      </article>

      {d.clashes.length > 0 && d.status === "scheduled" && (
        <div className="club-alert" role="note" data-testid="practice-clash-list">
          <p>
            {d.clashes.length} booking{d.clashes.length === 1 ? "" : "s"} already made on {d.clashes.length === 1 ? "this practice's boat overlaps" : "these boats overlap"} the practice. Nothing was cancelled: talk to {d.clashes.length === 1 ? "the member" : "the members"} about it.
          </p>
          <ul className="club-list">
            {d.clashes.map((c) => (
              <li key={c.bookingId} data-testid="clash-row">
                {c.bookerName} has {c.itemName} from {whenWords(c.startsAt, c.endsAt)}
                {c.contact ? (
                  <>
                    {" "}
                    &middot; <a href={`mailto:${c.contact.email}`}>{c.contact.email}</a>
                    {c.contact.phone ? <> &middot; {c.contact.phone}</> : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>{runner ? "Boats and lineup" : "Your boat"}</h2>
      {d.boats.length === 0 ? (
        <p data-testid="no-boats">No boats are reserved yet.</p>
      ) : (
        <div className="club-cards">
          {d.boats.map((b) => (
            <article key={b.itemId} className="club-card" data-testid="practice-boat" data-boat={b.name} aria-label={b.name}>
              <h3>
                {b.name} <span className="club-meta">{b.className}</span>
              </h3>
              <ol className="club-list" aria-label={`Seats in ${b.name}`}>
                {b.seats.map((s) => (
                  <li key={s.seat} data-testid="seat-row" data-seat={s.seat}>
                    <strong>Seat {s.seat}</strong> &middot; {s.memberId ? `${s.name}${s.active ? "" : " (no longer an active member)"}` : "empty"}
                    {s.memberId && s.side ? ` · ${sideWords(s.side).toLowerCase()}` : ""}
                    {d.canEdit && s.memberId && <TakeOutButton practiceId={d.id} boatId={b.itemId} seat={s.seat} name={s.name ?? "this person"} />}
                  </li>
                ))}
              </ol>
              {d.canEdit && <TakeBoatOffButton practiceId={d.id} boatId={b.itemId} boat={b.name} seated={b.seats.filter((s) => s.memberId).length} />}
            </article>
          ))}
        </div>
      )}

      {runner && !d.canEdit && d.status === "scheduled" && !d.ended && (
        <p className="club-meta" data-testid="read-only-note">
          Only club staff, or the coach who runs this practice, can change it.
        </p>
      )}

      {d.canEdit && (
        <>
          <h2>Seat someone</h2>
          <form method="get" className="club-form" data-testid="find-form">
            <p>
              <label htmlFor="find">Find a member by name (at least three letters)</label>
              <input id="find" name="find" type="search" defaultValue={typed} autoComplete="off" />
            </p>
            <p>
              <button type="submit" className="club-button club-button-quiet">
                Find
              </button>
            </p>
          </form>
          {found?.tooShort && <p className="club-meta">Type at least three letters of a name.</p>}
          {found && !found.tooShort && found.people.length === 0 && <p data-testid="no-rowers">Nobody matches, or everyone who does is already in this practice.</p>}
          {found && found.people.length > 0 && (
            <ul className="club-cards" aria-label="Members found" data-testid="rowers-found">
              {found.people.map((p) => (
                <li key={p.memberId} className="club-card" data-testid="rower-choice" data-name={p.name}>
                  <h3>
                    {p.name}
                    {p.household && <span className="club-meta"> &middot; {p.household}</span>}
                  </h3>
                  <SeatForm practiceId={d.id} memberId={p.memberId} name={p.name} places={emptySeats} />
                </li>
              ))}
            </ul>
          )}
          {found?.more && <p className="club-meta">There are more matches. Type more of the name to narrow it down.</p>}

          <h2>Boats</h2>
          <AddBoatForm practiceId={d.id} boats={addable.map((b) => ({ id: b.id, name: b.name }))} />

          {!d.started && (
            <>
              <h2>Cancel the practice</h2>
              <p className="club-meta">Its boats can be booked again at once, and the people in the lineup are free. Nobody is emailed.</p>
              <CancelPracticeForm practiceId={d.id} reasonMax={PRACTICE_RULES.defaults.reasonMax} />
            </>
          )}
        </>
      )}
      {runner && <PracticePlaceholderNote />}
    </section>
  );
}
