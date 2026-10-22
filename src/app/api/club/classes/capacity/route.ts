import type { NextRequest } from "next/server";
import { ChairsTooFew, setCapacity } from "@/club/engine/classes";
import { ClubError } from "@/club/errors";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { idParam, intParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const sessionId = idParam(field(form, "session"));
  const chairs = intParam(field(form, "capacity"), 1, 200, 0);
  if (!sessionId || !chairs) return see(request, "/club/classes?notice=invalid");
  try {
    await setCapacity(store, CLASS_RULES, ctx, sessionId, chairs);
    return see(request, `/club/classes/${sessionId}?changed=1`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `/club/classes/${sessionId}?notice=${e instanceof ChairsTooFew ? "capacity" : e.code === "conflict" ? "started" : e.code}`);
  }
}
