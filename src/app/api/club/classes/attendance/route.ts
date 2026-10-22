import type { NextRequest } from "next/server";
import { markClassAttendance } from "@/club/engine/classes";
import { ClubError } from "@/club/errors";
import { idParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  const outcome = field(form, "outcome");
  if (!id || (outcome !== "attended" && outcome !== "no_show")) return see(request, "/club/classes?notice=invalid");
  try {
    const line = await markClassAttendance(store, ctx, id, outcome);
    return see(request, `/club/classes/${line.sessionId}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `/club/classes?notice=${e.code}`);
  }
}
