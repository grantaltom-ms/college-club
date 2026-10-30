"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { assignReport, changePriority, dismissReport, outOfServiceForReport, repairedReport, startReport } from "./actions";

const submit = (run: (form: HTMLFormElement) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  run(e.currentTarget);
};

export function AssignForm({ reportId, current }: { reportId: string; current: string | null }) {
  const { state, pending, run } = useStaffAction(assignReport);
  return (
    <form className="club-form" data-testid="assign-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`assign-${reportId}`}>Who is fixing it? (leave empty for nobody)</label>
        <input id={`assign-${reportId}`} name="assignedTo" type="text" maxLength={120} defaultValue={current ?? ""} autoComplete="off" />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Save who is fixing it
        </button>
      </p>
    </form>
  );
}

export function PriorityForm({ reportId, current }: { reportId: string; current: number }) {
  const { state, pending, run } = useStaffAction(changePriority);
  return (
    <form className="club-form" data-testid="priority-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`priority-${reportId}`}>Priority</label>
        <select id={`priority-${reportId}`} name="priority" defaultValue={String(current)}>
          <option value="1">1 · Urgent</option>
          <option value="2">2 · High</option>
          <option value="3">3 · Normal</option>
          <option value="4">4 · Low</option>
        </select>
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Save priority
        </button>
      </p>
    </form>
  );
}

export function StartButton({ reportId }: { reportId: string }) {
  const { state, pending, run } = useStaffAction(startReport);
  return (
    <form data-testid="start-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending}>
        Mark as being fixed
      </button>
    </form>
  );
}

export function OutOfServiceForm({ reportId, boat }: { reportId: string; boat: string }) {
  const { state, pending, run } = useStaffAction(outOfServiceForReport);
  return (
    <form className="club-form" data-testid="oos-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`oos-${reportId}`}>Expected back (optional)</label>
        <input id={`oos-${reportId}`} name="expectedReturn" type="date" />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending} aria-label={`Take ${boat} out of service`}>
          Take {boat} out of service
        </button>
      </p>
    </form>
  );
}

export function RepairedForm({ reportId, today, otherOpenMajor, outOfService }: { reportId: string; today: string; otherOpenMajor: number; outOfService: boolean }) {
  const { state, pending, run } = useStaffAction(repairedReport);
  return (
    <form className="club-form" data-testid="repaired-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`repaired-on-${reportId}`}>Repaired on</label>
        <input id={`repaired-on-${reportId}`} name="repairedOn" type="date" defaultValue={today} max={today} required />
      </p>
      <p>
        <label htmlFor={`repaired-by-${reportId}`}>Repaired by</label>
        <input id={`repaired-by-${reportId}`} name="repairedBy" type="text" maxLength={120} autoComplete="off" required />
      </p>
      <p>
        <label htmlFor={`hours-${reportId}`}>Hours spent (optional)</label>
        <input id={`hours-${reportId}`} name="hours" type="text" inputMode="decimal" placeholder="1.5" autoComplete="off" />
      </p>
      <p>
        <label htmlFor={`cost-${reportId}`}>Cost in dollars (optional)</label>
        <input id={`cost-${reportId}`} name="cost" type="text" inputMode="decimal" placeholder="12.50" autoComplete="off" />
      </p>
      <p>
        <label htmlFor={`notes-${reportId}`}>What was done (optional)</label>
        <textarea id={`notes-${reportId}`} name="notes" rows={3} maxLength={2000} />
      </p>
      {outOfService && (
        <p>
          <label className="club-check">
            <input type="checkbox" name="returnToService" defaultChecked={otherOpenMajor === 0} /> Also return the boat to service
          </label>
          {otherOpenMajor > 0 && (
            <span className="club-meta" data-testid="other-major-note">
              {" "}
              {otherOpenMajor} other major report{otherOpenMajor === 1 ? " is" : "s are"} still open on it, so this is not ticked for you.
            </span>
          )}
        </p>
      )}
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          Mark as repaired
        </button>
      </p>
    </form>
  );
}

export function DismissForm({ reportId }: { reportId: string }) {
  const { state, pending, run } = useStaffAction(dismissReport);
  return (
    <form className="club-form" data-testid="dismiss-form" onSubmit={submit(run)}>
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`dismiss-${reportId}`}>Why is it being dismissed? (a duplicate, or nothing was wrong)</label>
        <input id={`dismiss-${reportId}`} name="reason" type="text" maxLength={200} autoComplete="off" required />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Dismiss the report
        </button>
      </p>
    </form>
  );
}
