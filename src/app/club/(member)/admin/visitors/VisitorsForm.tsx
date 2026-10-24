"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { addVisitors } from "./actions";

/** Enter the visitors a member brought, on today or an earlier open day. */
export function VisitorsForm({ members, today }: { members: { id: string; name: string }[]; today: string }) {
  const { state, pending, run } = useStaffAction(addVisitors);
  return (
    <form
      className="club-form"
      data-testid="visitors-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => form.reset());
      }}
    >
      <ActionMessage state={state} />
      <p>
        <label htmlFor="visitors-member">Member who brought them</label>
        <select id="visitors-member" name="member" required defaultValue="">
          <option value="" disabled>
            Choose a member
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="visitors-count">How many visitors</label>
        <input id="visitors-count" type="text" name="visitors" inputMode="numeric" autoComplete="off" required />
      </p>
      <p>
        <label htmlFor="visitors-day">Day</label>
        <input id="visitors-day" type="date" name="day" defaultValue={today} max={today} required />
      </p>
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          Record visitors
        </button>
      </p>
    </form>
  );
}
