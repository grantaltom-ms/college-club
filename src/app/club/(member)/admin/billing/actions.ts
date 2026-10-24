"use server";

import { runBilling } from "@/club/engine/billing";
import { formatMoney, monthLabel } from "@/club/engine/billing-words";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

/**
 * Staff close a month: only the month that was previewed, as it was previewed. Closing freezes every household's lines and
 * cannot be undone. Staff only; anyone else gets "page not found".
 */
export async function closeMonth(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const month = textOf(formData, "month", 7);
  const fingerprint = textOf(formData, "fingerprint", 64);
  if (!/^\d{4}-\d{2}$/.test(month) || !/^[0-9a-f]{64}$/.test(fingerprint)) return error("Preview the month first, then close it.");
  try {
    const done = await runBilling(store, ctx, BILLING_RULES, month, { fingerprint });
    return ok(`${monthLabel(month)} is closed: ${done.invoiceCount} invoice${done.invoiceCount === 1 ? "" : "s"}, ${formatMoney(done.totalCents)} in all. The files are below.`);
  } catch (e) {
    return refusal(e);
  }
}
