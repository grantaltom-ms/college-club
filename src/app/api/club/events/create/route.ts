import type { NextRequest } from "next/server";
import { createEvent } from "@/club/engine/events";
import { ClubError } from "@/club/errors";
import { parseEventForm } from "@/club/web-events";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  // On any problem the form comes back with the person's own choices, and the page explains what is wrong.
  const back = new URLSearchParams();
  for (const name of ["title", "description", "location", "date", "start", "end", "limit", "price", "replyByDate", "replyByTime"]) back.set(name, field(form, name, 1000));
  const fields = parseEventForm(form);
  if (!fields) return see(request, `/club/events/manage?${back.toString()}&notice=invalid`);
  try {
    const created = await createEvent(store, ctx, fields);
    return see(request, `/club/events/${created.id}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `/club/events/manage?${back.toString()}&notice=${e.code === "forbidden" ? "forbidden" : "invalid"}`);
  }
}
