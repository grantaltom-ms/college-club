import type { NextRequest } from "next/server";
import { renewHold } from "@/club/engine/events";
import { ClubError } from "@/club/errors";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

/** "Keep my place": holds a place on the waitlist for another hour. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  if (!id) return see(request, "/club/events?notice=invalid");
  const eventId = (await store.read()).rsvps.find((r) => r.id === id)?.eventId;
  const page = eventId ? `/club/events/${eventId}` : "/club/events";
  try {
    await renewHold(store, EVENT_RULES, ctx, id);
    return see(request, `${page}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${page}?notice=${e.code === "conflict" ? "started" : e.code}`);
  }
}
