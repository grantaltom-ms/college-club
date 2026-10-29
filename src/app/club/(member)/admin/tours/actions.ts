"use server";

import { markTourFollowedUp } from "@/club/engine/tours";
import { getTourStore } from "@/club/store/tours-instance";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/** Staff mark a tour request followed up, once. Staff only; anyone else, and the live site, gets "page not found". */
export async function markFollowedUp(formData: FormData): Promise<ActionResult> {
  const { ctx } = await startStaffAction();
  const id = textOf(formData, "id", 60);
  if (!id) return error("That tour request could not be found.");
  try {
    const request = await markTourFollowedUp(getTourStore(), ctx.actor, id, ctx.now);
    return ok(`${request.name} is marked as followed up.`);
  } catch (e) {
    return refusal(e);
  }
}
