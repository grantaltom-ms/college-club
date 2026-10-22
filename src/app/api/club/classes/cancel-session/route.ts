import type { NextRequest } from "next/server";
import { cancelSession } from "@/club/engine/classes";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const sessionId = idParam(field(form, "session"));
  if (!sessionId) return see(request, "/club/classes?notice=invalid");
  try {
    await cancelSession(store, ctx, sessionId, { reason: field(form, "reason") });
    return see(request, `/club/classes/${sessionId}?changed=1`);
  } catch (e) {
    return see(request, `/club/classes/${sessionId}?notice=${noticeCode(e)}`);
  }
}
