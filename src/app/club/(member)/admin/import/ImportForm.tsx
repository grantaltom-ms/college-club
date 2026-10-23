"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { ImportPlan } from "@/club/engine/import";
import { IMPORT_LIST_LIMIT, type ImportState } from "@/club/web-import";
import { importRoster } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Limited({ items, render }: { items: string[]; render?: (item: string) => React.ReactNode }) {
  const shown = items.slice(0, IMPORT_LIST_LIMIT);
  return (
    <>
      <ul className="club-list">
        {shown.map((item, i) => (
          <li key={i}>{render ? render(item) : item}</li>
        ))}
      </ul>
      {items.length > shown.length && <p className="club-meta">&hellip;and {items.length - shown.length} more.</p>}
    </>
  );
}

function Checked({ fileName, plan, pending, onAdd }: { fileName: string; plan: ImportPlan; pending: boolean; onAdd: () => void }) {
  if (plan.problems.length > 0) {
    return (
      <section className="club-alert" role="alert" data-testid="import-problems">
        <h3>
          {fileName} has {plural(plan.problems.length, "problem")}
        </h3>
        <p>Nothing can be added until the file is fixed. Fix these in your spreadsheet, save it as CSV again, and check it again.</p>
        <Limited items={plan.problems} />
      </section>
    );
  }
  return (
    <section data-testid="import-preview" aria-label="What this file would do">
      <h3>{fileName}: what adding it would do</h3>
      {plan.toAdd.length > 0 ? (
        <p data-testid="import-summary">
          This would add <strong>{plural(plan.toAdd.length, "household")}</strong> with <strong>{plural(plan.adultsToAdd, "adult")}</strong>.
        </p>
      ) : (
        <p data-testid="import-summary">There is nothing to add: {plan.rowCount === 0 ? "the file has no households." : "every household in the file is already here."}</p>
      )}
      {plan.toAdd.length > 0 && (
        <ul className="club-cards" aria-label="Households to add">
          {plan.toAdd.slice(0, IMPORT_LIST_LIMIT).map((h) => (
            <li key={h.quickbooksId} className="club-card" data-testid="import-household">
              <h4>{h.displayName}</h4>
              <p className="club-meta">
                {h.membershipType} &middot; joined {h.joinedOn} &middot; QuickBooks ID {h.quickbooksId}
              </p>
              <ul className="club-list">
                {h.adults.map((a) => (
                  <li key={a.email + a.name}>
                    {a.name} ({a.role === "primary" ? "primary adult" : "additional adult"}) &middot; {a.email}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {plan.toAdd.length > IMPORT_LIST_LIMIT && <p className="club-meta">&hellip;and {plan.toAdd.length - IMPORT_LIST_LIMIT} more households.</p>}
      {plan.alreadyHere.length > 0 && (
        <div data-testid="import-already-here">
          <h4>{plural(plan.alreadyHere.length, "household")} already here, left alone</h4>
          <p className="club-meta">Matched by QuickBooks ID. Nothing about them is changed by an import; change them in the household desk.</p>
          <Limited items={plan.alreadyHere.map((h) => `${h.existingName} (QuickBooks ID ${h.quickbooksId})${h.ended ? ", membership ended" : ""}`)} />
        </div>
      )}
      {plan.notices.length > 0 && (
        <div data-testid="import-notices">
          <h4>Worth a look</h4>
          <Limited items={plan.notices} />
        </div>
      )}
      {plan.toAdd.length > 0 && (
        <p>
          <button type="button" className="club-button" onClick={onAdd} disabled={pending} data-testid="import-add">
            {pending ? "Adding…" : `Add ${plural(plan.toAdd.length, "household")}`}
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Upload a roster, check it, then add it. The page keeps the chosen file itself between the two presses (a form would clear it
 * after the first), and the second press sends it again with a fingerprint, so only the file that was checked can be added.
 */
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
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
      data.set("households", String(state.plan.toAdd.length));
      data.set("adults", String(state.plan.adultsToAdd));
    }
    startTransition(async () => {
      setState(await importRoster(data));
    });
  };

  return (
    <div className="club-form" data-testid="import-form">
      <p>
        <label htmlFor="roster-file">Roster file (CSV)</label>
        <input
          id="roster-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setState({ kind: "idle" });
          }}
        />
      </p>
      <p>
        <button type="button" className="club-button" onClick={() => run("check")} disabled={pending || !file} data-testid="import-check">
          {pending && state.kind !== "checked" ? "Checking…" : "Check the file"}
        </button>
      </p>
      {state.kind === "error" && (
        <p className="club-alert" role="alert" data-testid="import-error">
          {state.message}
        </p>
      )}
      {state.kind === "checked" && <Checked fileName={state.fileName} plan={state.plan} pending={pending} onAdd={() => run("add")} />}
      {state.kind === "added" && (
        <section className="club-success" role="status" data-testid="import-done">
          <p>
            <strong>
              Added {plural(state.added, "household")} with {plural(state.adults, "adult")}.
            </strong>
            {state.alreadyHere > 0 && ` ${plural(state.alreadyHere, "household")} in the file ${state.alreadyHere === 1 ? "was" : "were"} already here and left alone.`}
          </p>
          <p>
            <Link href="/club">See the households</Link>
          </p>
        </section>
      )}
    </div>
  );
}
