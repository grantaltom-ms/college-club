import type { NextRequest } from "next/server";
import { RsvpRefused, rsvp } from "@/club/engine/events";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam, intParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** The RSVP button posts here. A refusal sends the person back to the event page, which explains it in words. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { actor, ctx, form, store } = started;
  const eventId = idParam(field(form, "event"));
  const memberId = actor.kind === "member" ? actor.member.id : idParam(field(form, "for"));
  const guests = intParam(field(form, "guests"), 0, 20, 0);
  if (!eventId || !memberId) return see(request, "/club/events?notice=invalid");
  const page = `/club/events/${eventId}`;
  const forQuery = actor.kind === "staff" ? `&for=${memberId}` : "";
  try {
    const { rsvp: line } = await rsvp(store, EVENT_RULES, ctx, { eventId, memberId, guests });
    return see(request, `${page}?joined=${line.id}${forQuery}`);
  } catch (e) {
    if (e instanceof RsvpRefused) return see(request, `${page}?guests=${guests}${forQuery}`);
    return see(request, `${page}?notice=${noticeCode(e)}${forQuery}`);
  }
}
