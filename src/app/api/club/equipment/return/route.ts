import type { NextRequest } from "next/server";
import { returnToService } from "@/club/engine/bookings";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const id = idParam(field(form, "period"));
  if (!id) return see(request, "/club/equipment?notice=invalid");
  try {
    await returnToService(store, ctx, id);
    return see(request, "/club/equipment?returned=1");
  } catch (e) {
    return see(request, `/club/equipment?notice=${noticeCode(e)}`);
  }
}
