import type { NextRequest } from "next/server";
import { changeMembershipType } from "@/club/engine/households";
import { MEMBERSHIP_TYPES, type MembershipType } from "@/club/types";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff change a household's membership type. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  const type = field(form, "type") as MembershipType;
  if (!householdId || !(MEMBERSHIP_TYPES as readonly string[]).includes(type)) return see(request, "/club?notice=invalid");
  try {
    await changeMembershipType(store, ctx, householdId, type);
    return see(request, `/club/household/${householdId}?changed=type`);
  } catch (e) {
    return see(request, `/club/household/${householdId}?notice=${noticeCode(e)}`);
  }
}
