import type { NextRequest } from "next/server";
import { SignUpRefused, signUp } from "@/club/engine/classes";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** The sign-up button posts here. A refusal sends the person back to the class page, which explains it in words. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { actor, ctx, form, store } = started;
  const sessionId = idParam(field(form, "session"));
  const memberId = actor.kind === "member" ? actor.member.id : idParam(field(form, "for"));
  if (!sessionId || !memberId) return see(request, "/club/classes?notice=invalid");
  const page = `/club/classes/${sessionId}`;
  const forQuery = actor.kind === "staff" ? `for=${memberId}` : "";
  try {
    const { signUp: line } = await signUp(store, RULE_BOOK, CLASS_RULES, ctx, { sessionId, memberId });
    return see(request, `${page}?joined=${line.id}${forQuery ? `&${forQuery}` : ""}`);
  } catch (e) {
    if (e instanceof SignUpRefused) return see(request, `${page}${forQuery ? `?${forQuery}` : ""}`);
    return see(request, `${page}?notice=${noticeCode(e)}${forQuery ? `&${forQuery}` : ""}`);
  }
}
