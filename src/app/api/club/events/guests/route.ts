import type { NextRequest } from "next/server";
import { changeGuests } from "@/club/engine/events";
import { ClubError } from "@/club/errors";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam, intParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  const guests = intParam(field(form, "guests"), 0, 20, -1);
  if (!id || guests < 0) return see(request, "/club/events?notice=invalid");
  const eventId = (await store.read()).rsvps.find((r) => r.id === id)?.eventId;
  const page = eventId ? `/club/events/${eventId}` : "/club/events";
  try {
    await changeGuests(store, EVENT_RULES, ctx, id, guests);
    return see(request, `${page}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${page}?notice=${e.code === "conflict" ? "started" : e.code}`);
  }
}
