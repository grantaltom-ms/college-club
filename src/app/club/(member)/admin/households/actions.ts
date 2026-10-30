"use server";

import { setQuickbooksId } from "@/club/engine/households";
import { setCoach } from "@/club/engine/practices";
import { idParam } from "@/club/web";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/** Staff set or correct a household's QuickBooks ID. Staff only; anyone else gets "page not found". */
export async function saveQuickbooksId(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const householdId = idParam(textOf(formData, "household"));
  if (!householdId) return error("That household could not be found.");
  try {
    const household = await setQuickbooksId(store, ctx, householdId, textOf(formData, "quickbooks", 200));
    return ok(`QuickBooks ID saved: ${household.quickbooksId}. The change is in the household's file.`);
  } catch (e) {
    return refusal(e);
  }
}

/** Staff mark a member as a coach, or take the mark off. Staff only; anyone else gets "page not found". */
export async function markCoach(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const memberId = idParam(textOf(formData, "member"));
  if (!memberId) return error("That member could not be found.");
  const coach = textOf(formData, "coach", 3) === "yes";
  try {
    await setCoach(store, ctx, memberId, coach);
    return ok(coach ? "Marked as a coach. They can now set up practices and seat crews. The change is in the household's file." : "No longer marked as a coach. The change is in the household's file.");
  } catch (e) {
    return refusal(e);
  }
}
