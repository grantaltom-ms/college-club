import type { NextRequest } from "next/server";
import { cancelRsvp } from "@/club/engine/events";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  if (!id) return see(request, "/club/events?notice=invalid");
  try {
    const { rsvp } = await cancelRsvp(store, EVENT_RULES, ctx, id);
    return see(request, `/club/events/${rsvp.eventId}?changed=1`);
  } catch (e) {
    return see(request, `/club/events?notice=${noticeCode(e)}`);
  }
}
