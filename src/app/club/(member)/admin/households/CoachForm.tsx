"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { markCoach } from "./actions";

/** Mark an adult as a coach, or take the mark off. A coach can set up practices and seat crews, and nothing else in the staff office. */
export function CoachForm({ memberId, name, isCoach }: { memberId: string; name: string; isCoach: boolean }) {
  const { state, pending, run } = useStaffAction(markCoach);
  return (
    <form
      className="club-form"
      data-testid="coach-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="member" value={memberId} />
      <input type="hidden" name="coach" value={isCoach ? "no" : "yes"} />
      <p className="club-meta" data-testid="coach-status">
        {isCoach ? "A coach: can set up practices and seat crews." : "Not a coach."}
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending} aria-label={isCoach ? `Take the coach mark off ${name}` : `Mark ${name} as a coach`}>
          {isCoach ? "Take the coach mark off" : "Mark as a coach"}
        </button>
      </p>
    </form>
  );
}
