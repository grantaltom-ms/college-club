"use client";

import { useState, useTransition } from "react";
import type { HistoryPlan } from "@/club/engine/history";
import { formatDay } from "@/club/time";
import { HISTORY_LIST_LIMIT, type HistoryImportState } from "@/club/web-history";
import { importHistory } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Limited({ items }: { items: string[] }) {
  const shown = items.slice(0, HISTORY_LIST_LIMIT);
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

function Checked({ fileName, plan, pending, onAdd }: { fileName: string; plan: HistoryPlan; pending: boolean; onAdd: () => void }) {
  if (plan.problems.length > 0) {
    return (
      <section className="club-alert" role="alert" data-testid="history-problems">
        <h3>
          {fileName} has {plural(plan.problems.length, "problem")}
        </h3>
        <p>Nothing can be added until the file is fixed. Fix these in your spreadsheet, save it as CSV again, and check it again.</p>
        <Limited items={plan.problems} />
      </section>
    );
  }
  return (
    <section data-testid="history-preview" aria-label="What this file would do">
      <h3>{fileName}: what adding it would do</h3>
      {plan.toAdd > 0 ? (
        <p data-testid="history-summary">
          This would add <strong>{plural(plan.toAdd, "old booking")}</strong>
          {plan.firstDay && plan.lastDay ? `, from ${formatDay(plan.firstDay)} to ${formatDay(plan.lastDay)}` : ""}.
          {plan.alreadyStored > 0 ? ` ${plural(plan.alreadyStored, "booking")} in the file ${plan.alreadyStored === 1 ? "is" : "are"} already stored and will be skipped.` : ""}
        </p>
      ) : (
        <p data-testid="history-summary">There is nothing to add: {plan.alreadyStored > 0 ? "every booking in the file is already stored." : "the file has no past bookings."}</p>
      )}
      {plan.byType.length > 0 && (
        <div data-testid="history-types">
          <h4>What kinds</h4>
          <ul className="club-list">
            {plan.byType.map((t) => (
              <li key={t.itemType}>
                {t.itemType}: {t.rows.toLocaleString("en-US")}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.names.total > 0 && (
        <div data-testid="history-names">
          <h4>The people named</h4>
          <p>
            {plural(plan.names.total, "different name")}: <span data-testid="names-one">{plan.names.matchedOne}</span> match exactly one member, <span data-testid="names-many">{plan.names.matchedMany}</span> match more than one, and{" "}
            <span data-testid="names-none">{plan.names.matchedNone}</span> match no member.
          </p>
          <p className="club-meta">
            A booking is kept whether or not its name matches. A member sees the bookings whose name matches only them, looked up at the time they ask.
          </p>
          {plan.unmatched.length > 0 && (
            <>
              <p>The names with the most bookings that match no member:</p>
              <Limited items={plan.unmatched.map((u) => `${u.name} (${plural(u.rows, "booking")})`)} />
            </>
          )}
        </div>
      )}
      {plan.notices.length > 0 && (
        <div data-testid="history-notices">
          <h4>Worth a look</h4>
          <Limited items={plan.notices} />
        </div>
      )}
      {plan.toAdd > 0 && (
        <p>
          <button type="button" className="club-button" onClick={onAdd} disabled={pending} data-testid="history-add">
            {pending ? "Adding…" : `Add ${plural(plan.toAdd, "old booking")}`}
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Upload an iCrew report, check it, then add it. The page keeps the chosen file itself between the two presses (a form would
 * clear it after the first), and the second press sends it again with a fingerprint, so only the file that was checked can be added.
 */
export function HistoryForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<HistoryImportState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const run = (intent: "check" | "add") => {
    if (!file) {
      setState({ kind: "error", message: "Choose a file first." });
      return;
    }
    const data = new FormData();
    data.set("file", file);
    data.set("intent", intent);
    if (intent === "add" && state.kind === "checked") {
      data.set("fingerprint", state.plan.fingerprint);
      data.set("toAdd", String(state.plan.toAdd));
    }
    startTransition(async () => {
      setState(await importHistory(data));
    });
  };

  return (
    <div className="club-form" data-testid="history-form">
      <p>
        <label htmlFor="history-file">iCrew Reservations report (CSV)</label>
        <input
          id="history-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setState({ kind: "idle" });
          }}
        />
      </p>
      <p>
        <button type="button" className="club-button" onClick={() => run("check")} disabled={pending || !file} data-testid="history-check">
          {pending && state.kind !== "checked" ? "Checking…" : "Check the file"}
        </button>
      </p>
      {state.kind === "error" && (
        <p className="club-alert" role="alert" data-testid="history-error">
          {state.message}
        </p>
      )}
      {state.kind === "checked" && <Checked fileName={state.fileName} plan={state.plan} pending={pending} onAdd={() => run("add")} />}
      {state.kind === "added" && (
        <section className="club-success" role="status" data-testid="history-done">
          <p>
            <strong>Added {plural(state.added, "old booking")}.</strong>
            {state.skipped > 0 && ` ${plural(state.skipped, "row")} in the file ${state.skipped === 1 ? "was" : "were"} skipped (already stored, repeated, or for a day that has not passed).`}
          </p>
        </section>
      )}
    </div>
  );
}
