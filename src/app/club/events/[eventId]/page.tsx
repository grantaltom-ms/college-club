import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { describeEventRules } from "@/club/engine/describe";
import { checkRsvp, closesAt, eventView, eventWhen, type RsvpReason } from "@/club/engine/events";
import { placesText, priceText, yoursEventText } from "@/club/engine/event-words";
import { fullName, householdOf, ordinal } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { getLinkSecret } from "@/club/link-secret";
import { afterJoiningWaitlist } from "@/club/party-words";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDayLong, pacificDate } from "@/club/time";
import { clockValue, idParam, intParam, NOTICES } from "@/club/web";
import { EventPlaceholderNote } from "../../PlaceholderNote";
import { PartyStepper } from "../../PartyStepper";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

const EVENT_NOTICES: Record<string, string> = {
  ...NOTICES,
  started: "That event has already started, so this can no longer be done here.",
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const { eventId } = await params;
  const query = await searchParams;
  const now = clubNow();
  const state = await (await getClubStore()).read();
  const event = state.events.find((e) => e.id === eventId);
  if (!event) notFound();

  const staff = actor.kind === "staff";
  const rules = EVENT_RULES.defaults;
  const view = eventView(state, event, staff ? { kind: "staff" } : { kind: "member", memberId: actor.member.id }, now);
  const started = Date.parse(event.startsAt) <= now.getTime();
  const open = event.status === "scheduled" && !started;
  const ctx = { actor: toEngineActor(actor), now };

  // Who the RSVP is for: a member RSVPs for themself; staff pick someone.
  const people = state.members
    .filter((m) => m.status === "active" && householdOf(state, m.householdId)?.status === "active")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const forId = staff ? (people.find((m) => m.id === idParam(query.for))?.id ?? null) : actor.member.id;
  const party = intParam(one(query.people), 1, rules.maxGuests + 1, 1);
  const reasons: RsvpReason[] | null = forId && open ? checkRsvp(state, EVENT_RULES, ctx, { eventId: event.id, memberId: forId, guests: party - 1 }) : null;
  // A full waitlist is shown live by the number picker; anything else that stands in the way replaces the picker.
  const blocking = reasons?.filter((r) => r.code !== "waitlist_full") ?? [];
  const forLine = forId ? view.sheet.find((l) => l.memberId === forId && (l.status === "going" || l.status === "waitlisted")) ?? (staff ? null : view.yours) : null;
  const claim = !!forLine && forLine.status === "waitlisted" && reasons !== null && reasons.length === 0;
  const lateIfCancelled = forLine?.status === "going" && Date.parse(event.startsAt) - now.getTime() < rules.cancelCutoffMinutes * 60000;
  const holdWords = (holdUntil: string | null) => (holdUntil ? `Your place is held until ${formatClock(holdUntil)}. Press Keep my place to hold it for another ${rules.waitlistHoldMinutes === 60 ? "hour" : `${rules.waitlistHoldMinutes} minutes`}.` : "");
  const stepperBase = { name: "people", max: rules.maxGuests + 1, priceCents: event.priceCents };

  const joinedId = idParam(query.joined);
  const joined = joinedId ? state.rsvps.find((r) => r.id === joinedId && r.eventId === event.id) : undefined;
  const joinedLine = joined ? view.sheet.find((l) => l.rsvpId === joined.id) ?? (view.yours?.rsvpId === joined.id ? view.yours : undefined) : undefined;
  const notice = EVENT_NOTICES[one(query.notice) ?? ""];
  const cancelledNames = event.status === "cancelled" && staff ? state.rsvps.filter((r) => r.eventId === event.id && r.cancelReason?.startsWith("The event was cancelled")) : [];
  const explained = describeEventRules(EVENT_RULES);
  const yours = yoursEventText(view.yours);
  const closes = closesAt(event, EVENT_RULES);
  const closesWords = `${formatDayLong(pacificDate(new Date(closes)))} at ${formatClock(new Date(closes))}`;
  const price = event.priceCents;

  return (
    <section>
      <p>
        <Link href="/club/events">All events</Link>
      </p>
      <h1>{event.title}</h1>
      <EventPlaceholderNote />
      <p data-testid="event-when">
        {eventWhen(event)} to {formatClock(event.endsAt)}
        {event.location ? ` · ${event.location}` : ""}
      </p>
      {event.description && <p>{event.description}</p>}
      <p className="club-meta" data-testid="event-places">
        {placesText(view)}
        {event.capacity !== null ? ` (limit ${event.capacity}${view.waiting > 0 ? `, ${view.waiting} on the waitlist` : ""})` : ""}
        {price !== null ? ` · ${priceText(price)}${price > 0 ? " a spot" : ""}` : ""}
      </p>
      {price !== null && price > 0 && <p className="club-meta">Prices are recorded with each RSVP and billed with the household&rsquo;s dues later. Nothing is charged in this test build.</p>}

      {event.status === "cancelled" && (
        <p className="club-alert" role="status" data-testid="event-cancelled">
          This event was cancelled{event.cancelReason ? `: ${event.cancelReason}` : "."}
        </p>
      )}
      {joined && joinedLine && (
        <p className={joined.status === "going" ? "club-success" : "club-alert"} role="status" data-testid="joined-note">
          {joined.status === "going"
            ? `${staff ? "RSVP made." : "You are going."} ${1 + joined.guests} ${joined.guests === 0 ? "spot" : "spots"} taken.`
            : afterJoiningWaitlist({ people: 1 + joined.guests, left: view.left, holdMinutes: rules.waitlistHoldMinutes, until: joined.holdUntil ? formatClock(joined.holdUntil) : undefined, place: joinedLine.place ?? 1 })}
        </p>
      )}
      {one(query.changed) && (
        <p className="club-success" role="status">
          Saved.
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      {open && (
        <div className="club-card" data-testid="rsvp-panel">
          {staff && (
            <form method="get" className="club-form" action={`/club/events/${event.id}`}>
              <p>
                <label htmlFor="for">RSVP which member?</label>
                <select id="for" name="for" defaultValue={forId ?? ""}>
                  <option value="">Choose a member</option>
                  {people.map((m) => (
                    <option key={m.id} value={m.id}>
                      {fullName(m)}
                    </option>
                  ))}
                </select>{" "}
                <button type="submit" className="club-button club-button-quiet">
                  Check
                </button>
              </p>
            </form>
          )}

          {forLine && (
            <>
              <p data-testid="your-place">
                {staff ? `${fullName(people.find((m) => m.id === forId)!)}: ` : ""}
                {staff ? (forLine.status === "going" ? `is going${forLine.guests > 0 ? `, party of ${1 + forLine.guests}` : ""}.` : `is on the waitlist${forLine.guests > 0 ? ` for a party of ${1 + forLine.guests}` : ""}, ${ordinal(forLine.place ?? 1)} in line.`) : yoursEventText(forLine)}
              </p>
              {forLine.status === "waitlisted" && (
                <form method="post" action="/api/club/events/keep">
                  <input type="hidden" name="id" value={forLine.rsvpId} />
                  {holdWords(forLine.holdUntil) && (
                    <p className="club-meta" data-testid="hold-note">
                      {holdWords(forLine.holdUntil)}
                    </p>
                  )}
                  <button type="submit" className="club-button club-button-quiet" data-testid="keep-place">
                    Keep my place
                  </button>
                </form>
              )}
              {claim && (
                <form method="post" action="/api/club/events/rsvp">
                  <input type="hidden" name="event" value={event.id} />
                  <input type="hidden" name="people" value={1 + forLine.guests} />
                  {staff && <input type="hidden" name="for" value={forId!} />}
                  <p className="club-meta">Spots are free, and the automatic move-up has ended, so they go to whoever asks first.</p>
                  <button type="submit" className="club-button">
                    Take the free spots
                  </button>
                </form>
              )}
              <form method="post" action="/api/club/events/guests" className="club-form">
                <input type="hidden" name="id" value={forLine.rsvpId} />
                <PartyStepper
                  {...stepperBase}
                  mode="change"
                  initial={1 + forLine.guests}
                  hasSpots={forLine.status === "going"}
                  fits={view.left === null ? null : forLine.status === "going" ? 1 + forLine.guests + view.left : view.left}
                  submitLabel="Change my party"
                />
              </form>
              <form method="post" action="/api/club/events/leave">
                <input type="hidden" name="id" value={forLine.rsvpId} />
                {lateIfCancelled && !staff && <p className="club-meta">Cancelling now counts as a late cancellation.</p>}
                <button type="submit" className="club-button club-button-quiet">
                  {forLine.status === "waitlisted" ? "Leave the waitlist" : "Cancel my RSVP"}
                </button>
              </form>
            </>
          )}

          {!forLine && forId && (
            <>
              {blocking.length > 0 ? (
                <div className="club-alert" role="alert" data-testid="refusal">
                  <p>{staff ? "This RSVP cannot be made:" : "You cannot RSVP:"}</p>
                  <ul>
                    {blocking.map((r) => (
                      <li key={r.code}>{r.message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <form method="post" action="/api/club/events/rsvp" className="club-form">
                  <input type="hidden" name="event" value={event.id} />
                  {staff && <input type="hidden" name="for" value={forId} />}
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
                  <p className="club-meta">RSVPs close {closesWords}.</p>
                </form>
              )}
            </>
          )}
        </div>
      )}
      {!open && event.status === "scheduled" && <p className="club-meta">This event has started, so RSVPs are closed.</p>}
      {yours && !open && <p className="club-meta">{yours}</p>}

      {staff && (
        <>
          <h2>Who is coming</h2>
          {view.sheet.length === 0 ? (
            <p>Nobody has RSVPed yet.</p>
          ) : (
            <ul className="club-list" aria-label="RSVP list" data-testid="sheet">
              {view.sheet.map((line) => (
                <li key={line.rsvpId} data-testid="sheet-line" data-status={line.status}>
                  {line.name}
                  {line.guests > 0 ? ` · party of ${1 + line.guests}` : ""} · {line.status === "waitlisted" ? `waitlist, ${ordinal(line.place ?? 1)} in line${line.holdUntil ? `, held until ${formatClock(line.holdUntil)}` : ""}` : line.status.replace("_", " ")}
                  {line.via === "email_link" ? " · from an email link" : ""}
                  {line.status === "going" && started && event.status === "scheduled" && (
                    <form method="post" action="/api/club/events/attendance" style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={line.rsvpId} />{" "}
                      <button type="submit" name="outcome" value="attended" className="club-button club-button-quiet" aria-label={`Mark ${line.name} attended`}>
                        Attended
                      </button>{" "}
                      <button type="submit" name="outcome" value="no_show" className="club-button club-button-quiet" aria-label={`Mark ${line.name} no-show`}>
                        No-show
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {cancelledNames.length > 0 && (
            <div className="club-card" data-testid="affected">
              <h3>Please contact these people</h3>
              <ul>
                {cancelledNames.map((r) => {
                  const m = state.members.find((x) => x.id === r.memberId)!;
                  return (
                    <li key={r.id}>
                      {fullName(m)}: {m.email}, {m.phone}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {event.status === "scheduled" && (
            <>
              <h2>Staff tools</h2>
              {getLinkSecret() ? (
                <p>
                  <a href={`/api/club/events/${event.id}/links`} data-testid="links-download">
                    Download personal RSVP links (CSV)
                  </a>
                </p>
              ) : (
                <p className="club-meta" data-testid="links-unavailable">
                  Personal RSVP links need CLUB_LINK_SECRET to be set on this server (see .env.example).
                </p>
              )}
              <p className="club-meta">One link per active adult, for a Mailchimp merge field later. Nothing is sent from here.</p>
              {open && (
                <>
                  <details>
                    <summary>Edit this event</summary>
                    <form method="post" action="/api/club/events/update" className="club-form" data-testid="edit-form">
                      <input type="hidden" name="event" value={event.id} />
                      <p>
                        <label htmlFor="e-title">Title</label>
                        <input id="e-title" name="title" type="text" maxLength={120} defaultValue={event.title} required />
                      </p>
                      <p>
                        <label htmlFor="e-description">What it is</label>
                        <input id="e-description" name="description" type="text" maxLength={1000} defaultValue={event.description} />
                      </p>
                      <p>
                        <label htmlFor="e-location">Where</label>
                        <input id="e-location" name="location" type="text" maxLength={200} defaultValue={event.location} />
                      </p>
                      <p>
                        <label htmlFor="e-date">Date</label>
                        <input id="e-date" name="date" type="date" defaultValue={pacificDate(new Date(event.startsAt))} required />
                      </p>
                      <p>
                        <label htmlFor="e-start">Starts (Pacific)</label>
                        <input id="e-start" name="start" type="time" defaultValue={clockValue(event.startsAt)} required />
                      </p>
                      <p>
                        <label htmlFor="e-end">Ends (Pacific)</label>
                        <input id="e-end" name="end" type="time" defaultValue={clockValue(event.endsAt)} required />
                      </p>
                      <p>
                        <label htmlFor="e-limit">Limit on spots, members and guests together (empty for none)</label>
                        <input id="e-limit" name="limit" type="number" min={Math.max(1, view.going)} max={2000} defaultValue={event.capacity ?? ""} />
                      </p>
                      <p>
                        <label htmlFor="e-price">Price of one spot in dollars (empty for not stated, 0 for free)</label>
                        <input id="e-price" name="price" type="text" inputMode="decimal" defaultValue={event.priceCents === null ? "" : String(event.priceCents / 100)} />
                      </p>
                      <p>
                        <label htmlFor="e-replyby-date">Reply by, date (empty to use the usual deadline)</label>
                        <input id="e-replyby-date" name="replyByDate" type="date" defaultValue={event.replyBy ? pacificDate(new Date(event.replyBy)) : ""} />{" "}
                        <label htmlFor="e-replyby-time" className="club-meta">
                          time
                        </label>{" "}
                        <input id="e-replyby-time" name="replyByTime" type="time" defaultValue={event.replyBy ? clockValue(event.replyBy) : ""} />
                      </p>
                      <p className="club-meta">Raising or removing the limit moves the waitlist up at once. A new price applies only to RSVPs made afterwards. Nobody is emailed about a change.</p>
                      <button type="submit" className="club-button">
                        Save changes
                      </button>
                    </form>
                  </details>
                  <form method="post" action="/api/club/events/cancel" className="club-form">
                    <input type="hidden" name="event" value={event.id} />
                    <p>
                      <label htmlFor="why">Cancel this event (members will see the reason)</label>
                      <input id="why" name="reason" type="text" maxLength={300} required />{" "}
                      <button type="submit" className="club-button" aria-label={`Cancel ${event.title}`}>
                        Cancel event
                      </button>
                    </p>
                  </form>
                </>
              )}
            </>
          )}
        </>
      )}

      <div className="club-card">
        <h2>{explained.heading}</h2>
        <ul>
          {explained.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
