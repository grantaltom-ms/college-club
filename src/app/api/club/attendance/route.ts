import type { NextRequest } from "next/server";
import { recordAttendance } from "@/club/engine/attendance";
import { ClubError } from "@/club/errors";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { ATTENDANCE_KINDS, type AttendanceKind } from "@/club/types";
import { backPath, idParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

/** The one handler behind every Check in / No-show / They were there button for staff. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const kind = field(form, "kind") as AttendanceKind;
  const id = idParam(field(form, "id"));
  const outcome = field(form, "outcome");
  const memberId = idParam(field(form, "member")) ?? undefined;
  const back = backPath(field(form, "back", 300), "/club/admin");
  const withQuery = (extra: string) => `${back}${back.includes("?") ? "&" : "?"}${extra}`;
  if (!(ATTENDANCE_KINDS as readonly string[]).includes(kind) || !id || (outcome !== "attended" && outcome !== "no_show")) return see(request, withQuery("notice=invalid"));
  try {
    await recordAttendance(store, ctx, ATTENDANCE_RULES, { kind, id, outcome, memberId, note: field(form, "note", 300) });
    return see(request, withQuery("checked=1"));
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, withQuery(`notice=${e.code}`));
  }
}
