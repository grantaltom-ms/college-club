import type { NextRequest } from "next/server";
import { cancelEvent } from "@/club/engine/events";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const eventId = idParam(field(form, "event"));
  if (!eventId) return see(request, "/club/events?notice=invalid");
  try {
    await cancelEvent(store, ctx, eventId, { reason: field(form, "reason") });
    return see(request, `/club/events/${eventId}?changed=1`);
  } catch (e) {
    return see(request, `/club/events/${eventId}?notice=${noticeCode(e)}`);
  }
}
