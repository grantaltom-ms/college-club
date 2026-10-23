import Link from "next/link";
import { clubNow } from "@/club/clock";
import { eventView, eventWhen } from "@/club/engine/events";
import { placesText, priceText, yoursEventText } from "@/club/engine/event-words";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { NOTICES } from "@/club/web";
import { viewerOf } from "@/club/web-actor";
import { EventPlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

export default async function EventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const viewer = viewerOf(actor);
  const upcoming = state.events.filter((e) => Date.parse(e.endsAt) > now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const notice = NOTICES[one(params.notice) ?? ""];

  return (
    <section>
      <h1>Events</h1>
      <EventPlaceholderNote />
      {actor.kind === "staff" && (
        <p>
          <Link href="/club/events/manage">Add an event</Link>
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {upcoming.length === 0 && <p data-testid="no-events">No events are coming up.</p>}
      <ul className="club-cards" aria-label="Events">
        {upcoming.map((event) => {
          const view = eventView(state, event, viewer);
          const yours = yoursEventText(view.yours);
          return (
            <li key={event.id} className="club-card" data-testid="event-card" data-event={event.title} data-event-id={event.id}>
              <h3>
                <Link href={`/club/events/${event.id}`}>{event.title}</Link>
              </h3>
              <p>
                {eventWhen(event)}
                {event.location ? ` · ${event.location}` : ""}
                {event.priceCents !== null ? ` · ${priceText(event.priceCents)}${event.priceCents > 0 ? " a place" : ""}` : ""}
              </p>
              <p className="club-meta">
                <span data-testid="event-places">{placesText(view)}</span>
                {event.status === "cancelled" && event.cancelReason ? `: ${event.cancelReason}` : ""}
                {yours ? ` · ${yours}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
