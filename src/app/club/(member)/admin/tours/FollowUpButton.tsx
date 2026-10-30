"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { markFollowedUp } from "./actions";

/** "Mark followed up" for one request. */
export function FollowUpButton({ id, name }: { id: string; name: string }) {
  const { state, pending, run } = useStaffAction(markFollowedUp);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="id" value={id} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} data-testid="tour-follow-up" aria-label={`Mark ${name} as followed up`}>
        Mark followed up
      </button>
    </form>
  );
}
