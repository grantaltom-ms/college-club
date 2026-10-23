import type { NextRequest } from "next/server";
import { endHousehold } from "@/club/engine/households";
import { clubLedger } from "@/club/engine/ledger";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff end a membership. Every adult is blocked and all their future bookings, class places and RSVPs are cancelled, in one step. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  if (!householdId) return see(request, "/club?notice=invalid");
  try {
    await endHousehold(store, clubLedger, ctx, householdId);
    return see(request, `/club/household/${householdId}?changed=ended`);
  } catch (e) {
    return see(request, `/club/admin/households/${householdId}/end?notice=${noticeCode(e)}`);
  }
}
