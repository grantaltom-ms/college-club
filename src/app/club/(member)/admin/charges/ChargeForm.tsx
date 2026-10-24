"use client";

import { BILLING_KINDS } from "@/club/types";
import { ActionMessage } from "../ActionMessage";
import { useStaffAction } from "../useStaffAction";
import { addCharge } from "./actions";

const LABEL: Record<(typeof BILLING_KINDS)[number], string> = { dues: "Dues", event_tickets: "Event tickets", visitor_fees: "Visitor fees", bar: "Bar", snack_bar: "Snack bar" };

/** Enter a bar or snack-bar sale, or an adjustment, on a household's account. */
export function ChargeForm({ households, today }: { households: { id: string; name: string }[]; today: string }) {
  const { state, pending, run } = useStaffAction(addCharge);
  return (
    <form
      className="club-form"
      data-testid="charge-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => form.reset());
      }}
    >
      <ActionMessage state={state} />
      <p>
        <label htmlFor="charge-household">Household</label>
        <select id="charge-household" name="household" required defaultValue="">
          <option value="" disabled>
            Choose a household
          </option>
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </p>
      <fieldset className="club-radios">
        <legend>What is it?</legend>
        <label className="club-check">
          <input type="radio" name="type" value="bar" defaultChecked /> Bar
        </label>
        <label className="club-check">
          <input type="radio" name="type" value="snack_bar" /> Snack bar
        </label>
        <label className="club-check">
          <input type="radio" name="type" value="adjustment" /> Adjustment
        </label>
      </fieldset>
      <p>
        <label htmlFor="charge-amount">Amount (for an adjustment, a minus sign makes it a credit)</label>
        <input id="charge-amount" type="text" name="amount" inputMode="decimal" autoComplete="off" placeholder="12.50" required />
      </p>
      <p>
        <label htmlFor="charge-goes-under">An adjustment goes under</label>
        <select id="charge-goes-under" name="goesUnder" defaultValue="dues">
          {BILLING_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {LABEL[kind]}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor="charge-day">Day</label>
        <input id="charge-day" type="date" name="day" defaultValue={today} max={today} required />
      </p>
      <p>
        <label htmlFor="charge-note">Note (required for an adjustment)</label>
        <input id="charge-note" type="text" name="note" maxLength={200} autoComplete="off" />
      </p>
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          Add charge
        </button>
      </p>
    </form>
  );
}
