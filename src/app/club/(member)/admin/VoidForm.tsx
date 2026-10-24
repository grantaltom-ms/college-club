"use client";

import { voidChargeAction } from "./charges/actions";
import { voidVisitorsAction } from "./visitors/actions";
import { ActionMessage } from "./ActionMessage";
import { useStaffAction } from "./useStaffAction";

/** Void a wrong charge or visitor entry, with a reason. Voided rows stay in the list: nothing is ever deleted. */
export function VoidForm({ kind, id, label }: { kind: "charge" | "visitors"; id: string; label: string }) {
  const { state, pending, run } = useStaffAction(kind === "charge" ? voidChargeAction : voidVisitorsAction);
  return (
    <form
      className="club-void"
      data-testid="void-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`void-${id}`}>
        Reason for voiding {label}
      </label>
      <input id={`void-${id}`} type="text" name="reason" maxLength={300} placeholder="Why void it?" required />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} aria-label={`Void ${label}`}>
        Void
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
