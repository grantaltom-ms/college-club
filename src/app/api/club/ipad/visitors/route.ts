import type { NextRequest } from "next/server";
import { recordVisitors } from "@/club/engine/billing";
import { ipadVisitorsMemberPath } from "@/club/engine/ipad-address";
import { ClubError } from "@/club/errors";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { field, see, startIpadPost } from "@/club/web-post";

/** "Sign in my visitors" on the front-desk iPad: a member says how many people they are bringing today. Only a count is kept. */
export async function POST(request: NextRequest) {
  const started = await startIpadPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store, code, memberId } = started;
  const back = ipadVisitorsMemberPath(code, memberId);
  const typed = field(form, "visitors", 4);
  if (!/^[0-9]{1,3}$/.test(typed)) return see(request, `${back}?notice=visitors`);
  try {
    const result = await recordVisitors(store, ctx, BILLING_RULES, { memberId, visitors: Number(typed), via: "ipad" });
    return see(request, `${back}?done=${result.entry.id}`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${back}?notice=visitors`);
  }
}
