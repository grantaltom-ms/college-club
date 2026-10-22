import type { NextRequest } from "next/server";
import { cancelBooking } from "@/club/engine/bookings";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "id"));
  if (!id) return see(request, "/club/my-bookings?notice=invalid");
  try {
    await cancelBooking(store, RULE_BOOK, ctx, id);
    return see(request, `/club/my-bookings?cancelled=${id}`);
  } catch (e) {
    return see(request, `/club/my-bookings?notice=${noticeCode(e)}`);
  }
}
