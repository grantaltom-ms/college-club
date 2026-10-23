import type { NextRequest } from "next/server";
import { removeMember } from "@/club/engine/households";
import { clubLedger } from "@/club/engine/ledger";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff take an adult off a household that carries on. Their future bookings, class places and RSVPs are cancelled in the same step. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const householdId = idParam(field(form, "household"));
  const memberId = idParam(field(form, "member"));
  if (!householdId || !memberId) return see(request, "/club?notice=invalid");
  try {
    await removeMember(store, clubLedger, ctx, memberId, { newPrimaryId: idParam(field(form, "newPrimary")) ?? undefined });
    return see(request, `/club/household/${householdId}?changed=removed`);
  } catch (e) {
    return see(request, `/club/admin/households/${householdId}/remove/${memberId}?notice=${noticeCode(e)}`);
  }
}
