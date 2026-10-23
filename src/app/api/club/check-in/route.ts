import type { NextRequest } from "next/server";
import { memberCheckIn } from "@/club/engine/attendance";
import { ClubError } from "@/club/errors";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { ATTENDANCE_KINDS, type AttendanceKind } from "@/club/types";
import { backPath, idParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

/** "I'm here" from a member's own phone. Only a member can press it, and only for a reservation of their own. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const kind = field(form, "kind") as AttendanceKind;
  const id = idParam(field(form, "id"));
  const back = backPath(field(form, "back", 300), "/club/my-bookings");
  const withQuery = (extra: string) => `${back}${back.includes("?") ? "&" : "?"}${extra}`;
  if (!(ATTENDANCE_KINDS as readonly string[]).includes(kind) || !id) return see(request, withQuery("notice=invalid"));
  try {
    await memberCheckIn(store, ctx, ATTENDANCE_RULES, { kind, id, via: "phone" });
    return see(request, withQuery(`checkedin=${id}`));
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, withQuery(`notice=${e.code}`));
  }
}
