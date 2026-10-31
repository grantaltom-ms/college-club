"use client";

import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { closeIncidentAction, reviewIncidentAction } from "./actions";

const submit = (run: (form: HTMLFormElement) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  run(e.currentTarget);
};

/**
 * What staff find out after the report is filed: the cause, what will change so it does not happen again, who is following up, and
 * the damage report it led to. Each box starts with what is on file; saving changes only what is different.
 */
export function ReviewIncidentForm({
  incidentId,
  cause,
  change,
  followUpBy,
  damageReportId,
  damageChoices,
  limits,
}: {
  incidentId: string;
  cause: string | null;
  change: string | null;
  followUpBy: string | null;
  damageReportId: string | null;
  damageChoices: { reportId: string; label: string }[];
  limits: { cause: number; change: number; followUpBy: number };
}) {
  const { state, pending, run } = useStaffAction(reviewIncidentAction);
  return (
    <form className="club-form" data-testid="incident-review-form" onSubmit={submit(run)}>
      <input type="hidden" name="incident" value={incidentId} />
      <p>
        <label htmlFor={`incident-cause-${incidentId}`}>Cause</label>
        <textarea id={`incident-cause-${incidentId}`} name="cause" rows={3} maxLength={limits.cause} defaultValue={cause ?? ""} />
      </p>
      <p>
        <label htmlFor={`incident-change-${incidentId}`}>What will change so it does not happen again</label>
        <textarea id={`incident-change-${incidentId}`} name="change" rows={3} maxLength={limits.change} defaultValue={change ?? ""} />
      </p>
      <p>
        <label htmlFor={`incident-follow-${incidentId}`}>Who is following up</label>
        <input id={`incident-follow-${incidentId}`} name="followUpBy" type="text" maxLength={limits.followUpBy} defaultValue={followUpBy ?? ""} autoComplete="off" />
      </p>
      <p>
        <label htmlFor={`incident-damage-${incidentId}`}>Damage report this led to (optional)</label>
        <select id={`incident-damage-${incidentId}`} name="damage" defaultValue={damageReportId ?? ""}>
          <option value="">None</option>
          {damageChoices.map((d) => (
            <option key={d.reportId} value={d.reportId}>
              {d.label}
            </option>
          ))}
        </select>
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          Save what we found
        </button>
      </p>
    </form>
  );
}

/** Closing a report: what was done, or why nothing more is needed. A closed report never changes. */
export function CloseIncidentForm({ incidentId, limit }: { incidentId: string; limit: number }) {
  const { state, pending, run } = useStaffAction(closeIncidentAction);
  return (
    <form className="club-form" data-testid="incident-close-form" onSubmit={submit(run)}>
      <input type="hidden" name="incident" value={incidentId} />
      <p>
        <label htmlFor={`incident-outcome-${incidentId}`}>What was done, or why nothing more is needed</label>
        <textarea id={`incident-outcome-${incidentId}`} name="outcome" rows={3} maxLength={limit} required />
      </p>
      <p className="club-meta">A closed report cannot be changed. If it happens again, file a new report.</p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          Close the report
        </button>
      </p>
    </form>
  );
}
