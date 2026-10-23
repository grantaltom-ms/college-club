import type { NextRequest } from "next/server";
import { memberCheckIn } from "@/club/engine/attendance";
import { ipadMemberPath } from "@/club/engine/ipad-address";
import { ClubError } from "@/club/errors";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { ATTENDANCE_KINDS, type AttendanceKind } from "@/club/types";
import { idParam } from "@/club/web";
import { field, see, startIpadPost } from "@/club/web-post";

/** "I'm here" on the front-desk iPad: the person picked their name, then pressed the button for one of their reservations. */
export async function POST(request: NextRequest) {
  const started = await startIpadPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store, code, memberId } = started;
  const kind = field(form, "kind") as AttendanceKind;
  const id = idParam(field(form, "id"));
  const back = ipadMemberPath(code, memberId);
  if (!(ATTENDANCE_KINDS as readonly string[]).includes(kind) || !id) return see(request, `${back}?notice=invalid`);
  try {
    await memberCheckIn(store, ctx, ATTENDANCE_RULES, { kind, id, via: "ipad" });
    return see(request, `${back}?checkedin=${id}`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${back}?notice=${e.code}`);
  }
}
