import type { NextRequest } from "next/server";
import { takeOutOfService } from "@/club/engine/bookings";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

/** Staff take a boat or space out of service. Bookings already made are kept; the page lists who is affected. */
export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const itemId = idParam(field(form, "item"));
  if (!itemId) return see(request, "/club/equipment?notice=invalid");
  try {
    const { period } = await takeOutOfService(store, ctx, itemId, { reason: field(form, "reason", 200), expectedReturn: field(form, "expectedReturn", 10) || null });
    return see(request, `/club/equipment?affected=${period.id}`);
  } catch (e) {
    return see(request, `/club/equipment?notice=${noticeCode(e)}`);
  }
}
