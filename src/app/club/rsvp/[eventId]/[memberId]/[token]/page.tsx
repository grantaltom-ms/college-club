import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { checkRsvp, closesAt, eventView, eventWhen } from "@/club/engine/events";
import { placesText, priceText, yoursEventText } from "@/club/engine/event-words";
import { fullName, ordinal } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getRsvpLinkActor } from "@/club/identity";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDayLong, pacificDate } from "@/club/time";
import { idParam, intParam } from "@/club/web";
import { EventPlaceholderNote } from "../../../../PlaceholderNote";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

/**
 * Where a personal RSVP link from an email lands. The link says who is replying (this event, this adult, the right secret
 * code); it signs nobody in. Opening it records nothing: the person still presses a button. Any wrong link looks like a
 * page that does not exist.
 */
export default async function RsvpLinkPage({ params, searchParams }: { params: Promise<{ eventId: string; memberId: string; token: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const link = await params;
  const query = await searchParams;
  const owner = await getRsvpLinkActor(link);
  if (!owner) notFound();

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const event = state.events.find((e) => e.id === link.eventId);
  if (!event) notFound();

  const member = owner.member;
  const rules = EVENT_RULES.defaults;
  const view = eventView(state, event, { kind: "member", memberId: member.id });
  const open = event.status === "scheduled" && Date.parse(event.startsAt) > now.getTime();
  const guests = intParam(one(query.guests), 0, rules.maxGuests, 0);
  const reasons = open ? checkRsvp(state, EVENT_RULES, { actor: { kind: "member", memberId: member.id, label: fullName(member) }, now }, { eventId: event.id, memberId: member.id, guests }) : null;
  const line = view.yours;
  const claim = !!line && line.status === "waitlisted" && reasons !== null && reasons.length === 0;
  const willWait = view.left !== null && 1 + guests > view.left;
  const lateIfCancelled = line?.status === "going" && Date.parse(event.startsAt) - now.getTime() < rules.cancelCutoffMinutes * 60000;
  const doneId = idParam(one(query.done));
  const done = doneId ? state.rsvps.find((r) => r.id === doneId && r.eventId === event.id && r.memberId === member.id) : undefined;
  const donePlace = done ? state.rsvps.filter((r) => r.eventId === event.id && r.status === "waitlisted").findIndex((r) => r.id === done.id) + 1 : 0;
  const closes = closesAt(event, EVENT_RULES);
  const guestChoices = Array.from({ length: rules.maxGuests + 1 }, (_, n) => n);
  const here = `/club/rsvp/${link.eventId}/${link.memberId}/${link.token}`;
  const price = event.priceCents;
  const hidden = (
    <>
      <input type="hidden" name="event" value={link.eventId} />
      <input type="hidden" name="member" value={link.memberId} />
      <input type="hidden" name="token" value={link.token} />
    </>
  );

  return (
    <section>
      <h1>{event.title}</h1>
      <EventPlaceholderNote />
      <p className="club-meta" data-testid="link-who">
        Replying as {fullName(member)}. This link works for you only, for this event only. It does not sign you in.
      </p>
      <p data-testid="event-when">
        {eventWhen(event)} to {formatClock(event.endsAt)}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      {event.description && <p>{event.description}</p>}
      <p className="club-meta" data-testid="event-places">
        {placesText(view)}
        {price !== null ? ` · ${priceText(price)}${price > 0 ? " a place" : ""}` : ""}
      </p>

      {event.status === "cancelled" && (
        <p className="club-alert" role="status" data-testid="event-cancelled">
          This event was cancelled{event.cancelReason ? `: ${event.cancelReason}` : "."}
        </p>
      )}
      {done && (
        <p className="club-success" role="status" data-testid="joined-note">
          {done.status === "going" ? `You are going. ${1 + done.guests} place${done.guests === 0 ? "" : "s"} taken.` : done.status === "waitlisted" ? `You are on the waiting list, ${ordinal(donePlace)} in line. If places free up, the first group that fits gets them at once.` : "Your RSVP is cancelled."}
        </p>
      )}
      {one(query.notice) && (
        <p className="club-alert" role="alert">
          That could not be done. Reload the page and try again, or ask club staff.
        </p>
      )}

      {open && (
        <div className="club-card" data-testid="rsvp-panel">
          {line ? (
            <>
              <p data-testid="your-place">{yoursEventText(line)}</p>
              {claim && (
                <form method="post" action="/api/club/events/link">
                  {hidden}
                  <input type="hidden" name="action" value="rsvp" />
                  <input type="hidden" name="guests" value={line.guests} />
                  <p className="club-meta">Places are free, and the automatic move-up has ended, so they go to whoever asks first.</p>
                  <button type="submit" className="club-button">
                    Take the free places
                  </button>
                </form>
              )}
              <form method="post" action="/api/club/events/link" className="club-form">
                {hidden}
                <input type="hidden" name="action" value="guests" />
                <input type="hidden" name="id" value={line.rsvpId} />
                <p>
                  <label htmlFor="change-guests">Guests</label>
                  <select id="change-guests" name="guests" defaultValue={String(line.guests)}>
                    {guestChoices.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>{" "}
                  <button type="submit" className="club-button club-button-quiet">
                    Change guests
                  </button>
                </p>
              </form>
              <form method="post" action="/api/club/events/link">
                {hidden}
                <input type="hidden" name="action" value="cancel" />
                <input type="hidden" name="id" value={line.rsvpId} />
                {lateIfCancelled && <p className="club-meta">Cancelling now counts as a late cancellation.</p>}
                <button type="submit" className="club-button club-button-quiet">
                  {line.status === "waitlisted" ? "Leave the waiting list" : "Cancel my RSVP"}
                </button>
              </form>
            </>
          ) : (
            <>
              <form method="get" className="club-form" action={here}>
                <p>
                  <label htmlFor="guests">Guests you are bringing (not members)</label>
                  <select id="guests" name="guests" defaultValue={String(guests)}>
                    {guestChoices.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>{" "}
                  <button type="submit" className="club-button club-button-quiet">
                    Update
                  </button>
                </p>
              </form>
              {reasons && reasons.length > 0 ? (
                <div className="club-alert" role="alert" data-testid="refusal">
                  <p>You cannot RSVP:</p>
                  <ul>
                    {reasons.map((r) => (
                      <li key={r.code}>{r.message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <form method="post" action="/api/club/events/link">
                  {hidden}
                  <input type="hidden" name="action" value="rsvp" />
                  <input type="hidden" name="guests" value={guests} />
                  <p className="club-meta">
                    {willWait ? `Your group of ${1 + guests} does not fit in the ${view.left} place${view.left === 1 ? "" : "s"} left, so you would join the waiting list.` : "There is room for your group."} RSVPs close {formatDayLong(pacificDate(new Date(closes)))} at {formatClock(new Date(closes))}.
                  </p>
                  <button type="submit" className="club-button">
                    {willWait ? "Join the waiting list" : "Yes, I am going"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
      {!open && event.status === "scheduled" && <p className="club-meta">This event has started, so RSVPs are closed.</p>}
    </section>
  );
}
