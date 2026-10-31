import type { NextRequest } from "next/server";
import { snackMemberPath } from "@/club/engine/ipad-address";
import { recordSnacks } from "@/club/engine/snacks";
import { ClubError } from "@/club/errors";
import { SNACK_RULES } from "@/club/settings/snack-rules";
import { field, see, startIpadPost } from "@/club/web-post";

/**
 * "Add to my account" on the honor snack bar iPad: a member says how many snacks they took, and one charge goes on their
 * household's account. The address must carry the snack bar's own private code; the person is whoever was picked on the screen.
 */
export async function POST(request: NextRequest) {
  const started = await startIpadPost(request, "snacks");
  if ("response" in started) return started.response;
  const { ctx, form, store, code, memberId } = started;
  const back = snackMemberPath(code, memberId);
  const typed = field(form, "items", 4);
  if (!/^[0-9]{1,3}$/.test(typed)) return see(request, `${back}?notice=snacks`);
  try {
    const result = await recordSnacks(store, ctx, SNACK_RULES, { memberId, items: Number(typed), entryToken: field(form, "token", 80) });
    return see(request, `${back}?done=${result.charge.id}`);
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
    return see(request, `${back}?notice=snacks`);
  }
}
