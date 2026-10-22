import type { NextRequest } from "next/server";
import { createClass } from "@/club/engine/classes";
import { ClubError } from "@/club/errors";
import { CLASS_RULES } from "@/club/settings/class-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { idParam, intParam } from "@/club/web";
import { field, see, startPost } from "@/club/web-post";

export async function POST(request: NextRequest) {
  const started = await startPost(request);
  if ("response" in started) return started.response;
  const { ctx, form, store } = started;
  try {
    const created = await createClass(store, RULE_BOOK, CLASS_RULES, ctx, {
      name: field(form, "name", 80),
      description: field(form, "description", 500),
      instructor: field(form, "instructor", 120),
      defaultCapacity: intParam(field(form, "chairs"), 1, 200, 0),
      defaultMinutes: intParam(field(form, "minutes"), 15, 480, 0),
      roomItemId: idParam(field(form, "room")),
    });
    return see(request, `/club/classes/manage?created=${created.id}`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `/club/classes/manage?notice=${e.code === "conflict" ? "duplicate_class" : e.code === "forbidden" ? "forbidden" : "invalid"}`);
  }
}
