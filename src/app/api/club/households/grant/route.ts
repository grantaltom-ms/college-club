import type { NextRequest } from "next/server";
import { grantQualification } from "@/club/engine/households";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff grant a rowing qualification. A member can never give themselves one. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  const memberId = idParam(field(form, "member"));
  const code = field(form, "code", 40);
  if (!householdId || !memberId || !/^[a-z0-9-]+$/.test(code)) return see(request, "/club?notice=invalid");
  try {
    await grantQualification(store, ctx, memberId, code);
    return see(request, `/club/household/${householdId}?changed=granted`);
  } catch (e) {
    return see(request, `/club/household/${householdId}?notice=${noticeCode(e)}`);
  }
}
