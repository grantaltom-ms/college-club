import type { NextRequest } from "next/server";
import { getMailer } from "@/club/auth/mail";
import { clubNow } from "@/club/clock";
import { cancelSession } from "@/club/engine/classes";
import { classWhenWords, notifyClassCancelled } from "@/club/engine/class-notify";
import { idParam } from "@/club/web";
import { field, noticeCode, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  const sessionId = idParam(field(form, "session"));
  if (!sessionId) return see(request, "/club/classes?notice=invalid");
  try {
    const { session, affected } = await cancelSession(store, ctx, sessionId, { reason: field(form, "reason") });
    const state = await store.read();
    const template = state.classes.find((c) => c.id === session.classId);
    const room = session.roomItemId ? state.items.find((i) => i.id === session.roomItemId) : null;
    const mailed = await notifyClassCancelled(
      getMailer(),
      {
        className: template?.name ?? "A class",
        when: classWhenWords(session),
        roomName: room?.name ?? null,
        reason: session.cancelReason ?? field(form, "reason").trim(),
      },
      affected,
      clubNow(),
    );
    const q = new URLSearchParams({ changed: "1" });
    if (affected.length > 0) {
      q.set("emailed", String(mailed.sent));
      q.set("of", String(affected.length));
      if (mailed.failed > 0) q.set("mailfail", String(mailed.failed));
    }
    return see(request, `/club/classes/${sessionId}?${q.toString()}`);
  } catch (e) {
    return see(request, `/club/classes/${sessionId}?notice=${noticeCode(e)}`);
  }
}
