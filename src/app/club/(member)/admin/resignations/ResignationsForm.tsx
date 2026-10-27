"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ResignationPlan } from "@/club/engine/resignations";
import { formatDay } from "@/club/time";
import { RESIGNATION_LIST_LIMIT, type ResignationState } from "@/club/web-resignations";
import { DeparturePreviewView } from "../DeparturePreviewView";
import { endHouseholds } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Limited({ items }: { items: string[] }) {
  const shown = items.slice(0, RESIGNATION_LIST_LIMIT);
  return (
    <>
      <ul className="club-list">
        {shown.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      {items.length > shown.length && <p className="club-meta">&hellip;and {items.length - shown.length} more.</p>}
    </>
  );
}

function Checked({ fileName, plan, pending, onEnd }: { fileName: string; plan: ResignationPlan; pending: boolean; onEnd: () => void }) {
  if (plan.problems.length > 0) {
    return (
      <section className="club-alert" role="alert" data-testid="resign-problems">
        <h3>
          {fileName} has {plural(plan.problems.length, "problem")}
        </h3>
        <p>Nothing can be ended until the file is fixed. Fix these in your spreadsheet, save it as CSV again, and check it again.</p>
        <Limited items={plan.problems} />
      </section>
    );
  }
  return (
    <section data-testid="resign-preview" aria-label="What this file would do">
      <h3>{fileName}: what ending these memberships would do</h3>
      {plan.toEnd.length > 0 ? (
        <p data-testid="resign-summary">
          This would end <strong>{plural(plan.toEnd.length, "household")}</strong> today, {formatDay(plan.endsOn)}, and block <strong>{plural(plan.adultsToBlock, "adult")}</strong> from booking. Ending a membership is final: a household that comes back later is
          added as a new household.
        </p>
      ) : (
        <p data-testid="resign-summary">There is nothing to end: {plan.rowCount === 0 ? "the file has no households." : "every household in the file has already ended."}</p>
      )}
      {plan.notices.length > 0 && (
        <div data-testid="resign-notices">
          <h4>Worth a look</h4>
          <Limited items={plan.notices} />
        </div>
      )}
      {plan.toEnd.length > 0 && (
        <ul className="club-cards" aria-label="Households to end">
          {plan.toEnd.slice(0, RESIGNATION_LIST_LIMIT).map((h) => (
            <li key={h.quickbooksId} className="club-card" data-testid="resign-household">
              <h4>{h.displayName}</h4>
              <p className="club-meta">QuickBooks ID {h.quickbooksId}</p>
              <p>{h.adults.join(", ")}</p>
              {h.note && <p className="club-meta">Note: {h.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {plan.toEnd.length > RESIGNATION_LIST_LIMIT && <p className="club-meta">&hellip;and {plan.toEnd.length - RESIGNATION_LIST_LIMIT} more households.</p>}
      {plan.toEnd.length > 0 && (
        <div data-testid="resign-cancels">
          <h4>What it will cancel</h4>
          <DeparturePreviewView preview={plan.preview} limit={RESIGNATION_LIST_LIMIT} />
        </div>
      )}
      {plan.alreadyEnded.length > 0 && (
        <div data-testid="resign-already-ended">
          <h4>{plural(plan.alreadyEnded.length, "household")} already ended, skipped</h4>
          <Limited items={plan.alreadyEnded.map((h) => `${h.displayName} (QuickBooks ID ${h.quickbooksId}), ended ${formatDay(h.endedOn)}`)} />
        </div>
      )}
      {plan.toEnd.length > 0 && (
        <p>
          <button type="button" className="club-button club-button-danger" onClick={onEnd} disabled={pending} data-testid="resign-end">
            {pending ? "Ending…" : `Yes, end ${plural(plan.toEnd.length, "membership")}`}
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Upload a resignations file, check it, then end the memberships. The page keeps the chosen file itself between the two presses
 * (a form would clear it after the first), and the second press sends it again with a fingerprint, so only the file that was
 * checked can be acted on.
 */
export function ResignationsForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ResignationState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const run = (intent: "check" | "end") => {
    if (!file) {
      setState({ kind: "error", message: "Choose a file first." });
      return;
    }
    const data = new FormData();
    data.set("file", file);
    data.set("intent", intent);
    if (intent === "end" && state.kind === "checked") {
      data.set("fingerprint", state.plan.fingerprint);
      data.set("households", String(state.plan.toEnd.length));
      data.set("adults", String(state.plan.adultsToBlock));
    }
    startTransition(async () => {
      setState(await endHouseholds(data));
    });
  };

  return (
    <div className="club-form" data-testid="resign-form">
      <p>
        <label htmlFor="resign-file">Resignations file (CSV)</label>
        <input
          id="resign-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setState({ kind: "idle" });
          }}
        />
      </p>
      <p>
        <button type="button" className="club-button" onClick={() => run("check")} disabled={pending || !file} data-testid="resign-check">
          {pending && state.kind !== "checked" ? "Checking…" : "Check the file"}
        </button>
      </p>
      {state.kind === "error" && (
        <p className="club-alert" role="alert" data-testid="resign-error">
          {state.message}
        </p>
      )}
      {state.kind === "checked" && <Checked fileName={state.fileName} plan={state.plan} pending={pending} onEnd={() => run("end")} />}
      {state.kind === "ended" && (
        <section className="club-success" role="status" data-testid="resign-done">
          <p>
            <strong>
              Ended {plural(state.ended, "membership")} and blocked {plural(state.adults, "adult")}.
            </strong>{" "}
            {state.cancelledBookings + state.cancelledSignUps + state.cancelledRsvps === 0
              ? "Nothing was booked, signed up for or RSVPed to from now on, so nothing was cancelled."
              : `Cancelled ${plural(state.cancelledBookings, "booking")}, ${plural(state.cancelledSignUps, "class place")} and ${plural(state.cancelledRsvps, "event RSVP")}.`}
            {state.alreadyEnded > 0 && ` ${plural(state.alreadyEnded, "household")} in the file had already ended and ${state.alreadyEnded === 1 ? "was" : "were"} skipped.`}
          </p>
          <p>
            <Link href="/club">See the households</Link>
          </p>
        </section>
      )}
    </div>
  );
}
