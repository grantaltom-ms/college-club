import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { checkRsvp, closesAt, eventView, eventWhen } from "@/club/engine/events";
import { placesText, priceText, yoursEventText } from "@/club/engine/event-words";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getRsvpLinkActor } from "@/club/identity";
import { afterJoiningWaitlist } from "@/club/party-words";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDayLong, pacificDate } from "@/club/time";
import { idParam, intParam } from "@/club/web";
import { EventPlaceholderNote } from "../../../../PlaceholderNote";
import { PartyStepper } from "../../../../PartyStepper";

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
  const view = eventView(state, event, { kind: "member", memberId: member.id }, now);
  const open = event.status === "scheduled" && Date.parse(event.startsAt) > now.getTime();
  const party = intParam(one(query.people), 1, rules.maxGuests + 1, 1);
  const reasons = open ? checkRsvp(state, EVENT_RULES, { actor: { kind: "member", memberId: member.id, label: fullName(member) }, now }, { eventId: event.id, memberId: member.id, guests: party - 1 }) : null;
  const blocking = reasons?.filter((r) => r.code !== "waitlist_full") ?? [];
  const line = view.yours;
  const claim = !!line && line.status === "waitlisted" && reasons !== null && reasons.length === 0;
  const lateIfCancelled = line?.status === "going" && Date.parse(event.startsAt) - now.getTime() < rules.cancelCutoffMinutes * 60000;
  const doneId = idParam(one(query.done));
  const done = doneId ? state.rsvps.find((r) => r.id === doneId && r.eventId === event.id && r.memberId === member.id) : undefined;
  const doneLine = done && view.yours?.rsvpId === done.id ? view.yours : undefined;
  const closes = closesAt(event, EVENT_RULES);
  const price = event.priceCents;
  const stepperBase = { name: "people", max: rules.maxGuests + 1, priceCents: price };
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
        {price !== null ? ` · ${priceText(price)}${price > 0 ? " a spot" : ""}` : ""}
      </p>

      {event.status === "cancelled" && (
        <p className="club-alert" role="status" data-testid="event-cancelled">
          This event was cancelled{event.cancelReason ? `: ${event.cancelReason}` : "."}
        </p>
      )}
      {done && (
        <p className={done.status === "waitlisted" ? "club-alert" : "club-success"} role="status" data-testid="joined-note">
          {done.status === "going"
            ? `You are going. ${1 + done.guests} ${done.guests === 0 ? "spot" : "spots"} taken.`
            : done.status === "waitlisted"
              ? afterJoiningWaitlist({ people: 1 + done.guests, left: view.left, holdMinutes: rules.waitlistHoldMinutes, until: done.holdUntil ? formatClock(done.holdUntil) : undefined, place: doneLine?.place ?? 1 })
              : done.cancelReason?.startsWith("Your place on the waitlist ran out")
                ? done.cancelReason
                : "Your RSVP is cancelled."}
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
              {line.status === "waitlisted" && (
                <form method="post" action="/api/club/events/link">
                  {hidden}
                  <input type="hidden" name="action" value="keep" />
                  <input type="hidden" name="id" value={line.rsvpId} />
                  {line.holdUntil && (
                    <p className="club-meta" data-testid="hold-note">
                      Your place is held until {formatClock(line.holdUntil)}. Press Keep my place to hold it for another {rules.waitlistHoldMinutes === 60 ? "hour" : `${rules.waitlistHoldMinutes} minutes`}.
                    </p>
                  )}
                  <button type="submit" className="club-button club-button-quiet" data-testid="keep-place">
                    Keep my place
                  </button>
                </form>
              )}
              {claim && (
                <form method="post" action="/api/club/events/link">
                  {hidden}
                  <input type="hidden" name="action" value="rsvp" />
                  <input type="hidden" name="people" value={1 + line.guests} />
                  <p className="club-meta">Spots are free, and the automatic move-up has ended, so they go to whoever asks first.</p>
                  <button type="submit" className="club-button">
                    Take the free spots
                  </button>
                </form>
              )}
              <form method="post" action="/api/club/events/link" className="club-form">
                {hidden}
                <input type="hidden" name="action" value="guests" />
                <input type="hidden" name="id" value={line.rsvpId} />
                <PartyStepper
                  {...stepperBase}
                  mode="change"
                  initial={1 + line.guests}
                  hasSpots={line.status === "going"}
                  fits={view.left === null ? null : line.status === "going" ? 1 + line.guests + view.left : view.left}
                  submitLabel="Change my party"
                />
              </form>
              <form method="post" action="/api/club/events/link">
                {hidden}
                <input type="hidden" name="action" value="cancel" />
                <input type="hidden" name="id" value={line.rsvpId} />
                {lateIfCancelled && <p className="club-meta">Cancelling now counts as a late cancellation.</p>}
                <button type="submit" className="club-button club-button-quiet">
                  {line.status === "waitlisted" ? "Leave the waitlist" : "Cancel my RSVP"}
                </button>
              </form>
            </>
          ) : blocking.length > 0 ? (
            <div className="club-alert" role="alert" data-testid="refusal">
              <p>You cannot RSVP:</p>
              <ul>
                {blocking.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </div>
          ) : (
            <form method="post" action="/api/club/events/link" className="club-form">
              {hidden}
              <input type="hidden" name="action" value="rsvp" />
              {reasons?.some((r) => r.code === "waitlist_full") && (
                <p className="club-alert" role="alert" data-testid="refusal">
                  {reasons.find((r) => r.code === "waitlist_full")!.message}
                </p>
              )}
              <PartyStepper
                {...stepperBase}
                mode="join"
                initial={party}
                left={view.left}
                waitlistOpen={rules.waitlistMax > 0}
                waitlistRoom={Math.max(0, rules.waitlistMax - view.waiting)}
                holdMinutes={rules.waitlistHoldMinutes}
              />
              <p className="club-meta">
                RSVPs close {formatDayLong(pacificDate(new Date(closes)))} at {formatClock(new Date(closes))}.
              </p>
            </form>
          )}
        </div>
      )}
      {!open && event.status === "scheduled" && <p className="club-meta">This event has started, so RSVPs are closed.</p>}
    </section>
  );
}
