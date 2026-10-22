import type { NextRequest } from "next/server";
import { leaveClass } from "@/club/engine/classes";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { actor, ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  if (!id) return see(request, "/club/my-classes?notice=invalid");
  try {
    const { signUp } = await leaveClass(store, CLASS_RULES, ctx, id);
    return see(request, actor.kind === "staff" ? `/club/classes/${signUp.sessionId}?changed=1` : `/club/my-classes?left=${id}`);
  } catch (e) {
    return see(request, `/club/my-classes?notice=${noticeCode(e)}`);
  }
}
