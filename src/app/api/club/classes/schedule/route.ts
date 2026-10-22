import type { NextRequest } from "next/server";
import { scheduleSessions } from "@/club/engine/classes";
import { ClubError } from "@/club/errors";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { pacificWall } from "@/club/time";
import { dateParam, idParam, intParam, timeParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

/** Staff schedule a class. A clash sends them back to the form with their choices kept; the form explains each clash in words. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const classId = idParam(field(form, "class"));
  const date = dateParam(field(form, "date"));
  const time = timeParam(field(form, "time"));
  const weeks = intParam(field(form, "weeks"), 1, 52, 1);
  const chairs = intParam(field(form, "chairs"), 1, 200, 0);
  const room = field(form, "room");
  if (!classId || !date || time === null) return see(request, "/club/classes/manage?notice=invalid");
  const back = new URLSearchParams({ class: classId, date, time: field(form, "time"), weeks: String(weeks) });
  if (chairs) back.set("chairs", String(chairs));
  if (room) back.set("room", room);
  try {
    const made = await scheduleSessions(store, RULE_BOOK, ctx, {
      classId,
      startsAt: pacificWall(date, time),
      weeks,
      capacity: chairs || undefined,
      roomItemId: room === "none" ? null : (idParam(room) ?? undefined),
    });
    return see(request, `/club/classes/manage?scheduled=${made.length}`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    back.set("notice", e.code === "conflict" ? "conflict" : e.code === "forbidden" ? "forbidden" : "invalid");
    return see(request, `/club/classes/manage?${back.toString()}`);
  }
}
