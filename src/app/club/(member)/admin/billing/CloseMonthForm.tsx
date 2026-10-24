"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { closeMonth } from "./actions";

/** The one button that closes a month. It carries the fingerprint of the preview, so only that exact preview can be closed. */
export function CloseMonthForm({ month, label, fingerprint }: { month: string; label: string; fingerprint: string }) {
  const { state, pending, run } = useStaffAction(closeMonth);
  return (
    <form
      className="club-form"
      data-testid="close-month-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <ActionMessage state={state} />
      <p className="club-placeholder">
        Closing {label} freezes every household&apos;s lines exactly as shown above. It cannot be undone: a mistake found afterwards is put right with an adjustment in a later month.
      </p>
      <p>
        <button type="submit" className="club-button" disabled={pending} data-testid="close-month">
          {pending ? "Closing…" : `Close ${label} and create the files`}
        </button>
      </p>
    </form>
  );
}
