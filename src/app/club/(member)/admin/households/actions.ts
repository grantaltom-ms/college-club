"use server";

import { setQuickbooksId } from "@/club/engine/households";
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
