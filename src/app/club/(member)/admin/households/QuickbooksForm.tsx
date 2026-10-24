"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { saveQuickbooksId } from "./actions";

/** Set or correct a household's QuickBooks ID, the link the monthly billing file needs. */
export function QuickbooksForm({ householdId, current }: { householdId: string; current: string | null }) {
  const { state, pending, run } = useStaffAction(saveQuickbooksId);
  return (
    <form
      className="club-form"
      data-testid="quickbooks-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="household" value={householdId} />
      <ActionMessage state={state} />
      <p>
        <label htmlFor="quickbooks-id">QuickBooks ID</label>
        <input id="quickbooks-id" type="text" name="quickbooks" maxLength={100} autoComplete="off" defaultValue={current ?? ""} required />
      </p>
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          {current ? "Correct QuickBooks ID" : "Save QuickBooks ID"}
        </button>
      </p>
    </form>
  );
}
