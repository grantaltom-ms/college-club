import type { NextRequest } from "next/server";
import { LimitTooLow, updateEvent } from "@/club/engine/events";
import { ClubError } from "@/club/errors";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { idParam } from "@/club/web";
import { parseEventForm } from "@/club/web-events";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const eventId = idParam(field(form, "event"));
  if (!eventId) return see(request, "/club/events?notice=invalid");
  const page = `/club/events/${eventId}`;
  const fields = parseEventForm(form);
  if (!fields) return see(request, `${page}?notice=invalid`);
  try {
    await updateEvent(store, EVENT_RULES, ctx, eventId, fields);
    return see(request, `${page}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${page}?notice=${e instanceof LimitTooLow ? "limit" : e.code === "conflict" ? "started" : e.code}`);
  }
}
