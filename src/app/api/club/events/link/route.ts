import type { NextRequest } from "next/server";
import { RsvpRefused, cancelRsvp, changeGuests, rsvp } from "@/club/engine/events";
import { ClubError } from "@/club/errors";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam, intParam } from "@/club/web";
import { field, see, startLinkPost } from "@/club/web-post";

/**
 * The buttons on a personal emailed link post here: RSVP, change guests, or cancel. The link must be genuine, and it can
 * only touch this member's own RSVP to this one event. It never signs anyone in.
 */
export async function POST(request: NextRequest) {
  const started = await startLinkPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store, link } = started;
  const here = `/club/rsvp/${link.eventId}/${link.memberId}/${link.token}`;
  const action = field(form, "action");
  const guests = intParam(field(form, "guests"), 0, 20, 0);
  try {
    if (action === "rsvp") {
      const { rsvp: line } = await rsvp(store, EVENT_RULES, ctx, { eventId: link.eventId, memberId: link.memberId, guests }, { via: "email_link" });
      return see(request, `${here}?done=${line.id}`);
    }
    // The other two touch an existing RSVP: it must be this member's, for this event.
    const id = idParam(field(form, "id"));
    const mine = id ? (await store.read()).rsvps.find((r) => r.id === id && r.eventId === link.eventId && r.memberId === link.memberId) : undefined;
    if (!mine) return see(request, `${here}?notice=invalid`);
    if (action === "guests") {
      await changeGuests(store, EVENT_RULES, ctx, mine.id, guests);
      return see(request, `${here}?done=${mine.id}`);
    }
    if (action === "cancel") {
      await cancelRsvp(store, EVENT_RULES, ctx, mine.id);
      return see(request, `${here}?done=${mine.id}`);
    }
    return see(request, `${here}?notice=invalid`);
  } catch (e) {
    if (e instanceof RsvpRefused) return see(request, `${here}?guests=${guests}`);
    if (e instanceof ClubError) return see(request, `${here}?notice=${e.code}`);
    throw e;
  }
}
