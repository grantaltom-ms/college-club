"use client";

import { ActionMessage } from "../admin/ActionMessage";
import { useStaffAction } from "../admin/useStaffAction";
import { addDamageNoteAction, fileDamage } from "./actions";

/**
 * The "Report damage" form. Open to anyone signed in. What is wrong and where on the boat are shown to everyone who books it, so the
 * form says so; how it happened is for staff only.
 */
export function FileDamageForm({ items, selected, limits }: { items: { id: string; name: string }[]; selected: string; limits: { description: number; location: number; how: number } }) {
  const { state, pending, run } = useStaffAction(fileDamage);
  return (
    <form
      className="club-form"
      data-testid="damage-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => form.reset());
      }}
    >
      <p>
        <label htmlFor="damage-item">Which boat or space?</label>
        <select id="damage-item" name="item" defaultValue={items.some((i) => i.id === selected) ? selected : ""} required>
          <option value="" disabled>
            Choose one
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="damage-description">What is wrong?</label>
        <textarea id="damage-description" name="description" rows={3} maxLength={limits.description} required />
        <span className="club-meta"> Everyone who books it will read this. Please do not put anyone&apos;s name in it.</span>
      </p>
      <p>
        <label htmlFor="damage-location">Where on the boat? (optional)</label>
        <input id="damage-location" name="location" type="text" maxLength={limits.location} autoComplete="off" />
        <span className="club-meta"> Everyone who books it will read this too, for example &ldquo;bow seat&rdquo; or &ldquo;port rigger&rdquo;.</span>
      </p>
      <p>
        <label htmlFor="damage-how">How did it happen? (optional)</label>
        <textarea id="damage-how" name="how" rows={2} maxLength={limits.how} />
        <span className="club-meta"> Only club staff read this.</span>
      </p>
      <fieldset>
        <legend>How serious is it?</legend>
        <p>
          <label className="club-check">
            <input type="radio" name="severity" value="minor" defaultChecked /> Minor: it can still be used
          </label>
        </p>
        <p>
          <label className="club-check">
            <input type="radio" name="severity" value="major" /> Major: it should not be used until someone has looked at it
          </label>
        </p>
      </fieldset>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending} data-testid="damage-submit">
          File the report
        </button>
      </p>
    </form>
  );
}

/** A note on a report: the person who filed it while it is open, and staff any time. */
export function DamageNoteForm({ reportId, label }: { reportId: string; label: string }) {
  const { state, pending, run } = useStaffAction(addDamageNoteAction);
  return (
    <form
      className="club-form"
      data-testid="damage-note-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => form.reset());
      }}
    >
      <input type="hidden" name="report" value={reportId} />
      <p>
        <label htmlFor={`note-${reportId}`}>{label}</label>
        <textarea id={`note-${reportId}`} name="text" rows={2} maxLength={1000} required />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Add note
        </button>
      </p>
    </form>
  );
}
