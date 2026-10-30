"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { EquipmentPlan } from "@/club/engine/equipment-import";
import { EQUIPMENT_LIST_LIMIT, type EquipmentState } from "@/club/web-equipment";
import { loadEquipment } from "./actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Limited({ items }: { items: string[] }) {
  const shown = items.slice(0, EQUIPMENT_LIST_LIMIT);
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

/** "3 Singles, 2 Doubles": what the file would add, by kind. */
function kinds(plan: EquipmentPlan): string {
  const counts = new Map<string, number>();
  for (const i of plan.toAdd) counts.set(i.className, (counts.get(i.className) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${n} ${name.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ");
}

function Checked({ fileName, plan, pending, onAdd }: { fileName: string; plan: EquipmentPlan; pending: boolean; onAdd: () => void }) {
  if (plan.problems.length > 0) {
    return (
      <section className="club-alert" role="alert" data-testid="equip-problems">
        <h3>
          {fileName} has {plural(plan.problems.length, "problem")}
        </h3>
        <p>Nothing can be added until the file is fixed. Fix these in your spreadsheet, save it as CSV again, and check it again.</p>
        <Limited items={plan.problems} />
      </section>
    );
  }
  return (
    <section data-testid="equip-preview" aria-label="What this file would do">
      <h3>{fileName}: what loading this list would do</h3>
      {plan.toAdd.length > 0 ? (
        <p data-testid="equip-summary">
          This would add <strong>{plural(plan.toAdd.length, "item")}</strong> to the club ({kinds(plan)}).
        </p>
      ) : (
        <p data-testid="equip-summary">There is nothing to add: {plan.rowCount === 0 ? "the file has no equipment." : "everything in the file is already here."}</p>
      )}
      {plan.notices.length > 0 && (
        <div data-testid="equip-notices">
          <h4>Worth a look</h4>
          <Limited items={plan.notices} />
        </div>
      )}
      {plan.toAdd.length > 0 && (
        <ul className="club-cards" aria-label="Items to add">
          {plan.toAdd.slice(0, EQUIPMENT_LIST_LIMIT).map((i) => (
            <li key={i.name.toLowerCase()} className="club-card" data-testid="equip-item">
              <h4>{i.name}</h4>
              <p className="club-meta">
                {i.type} &middot; {i.className}
                {i.pool ? "" : `, ${i.seats === 1 ? "1 seat" : `${i.seats} seats`}`}
              </p>
              {i.pool && (
                <p data-testid="equip-item-pool">
                  Pool &middot; {plural(i.places, "place")}, counted rather than numbered
                </p>
              )}
              <p>Skill level: {i.skill}</p>
              {i.private && (
                <p data-testid="equip-item-private">
                  Private boat &middot; {i.owners.length > 0 ? `owned by ${i.owners.map((o) => o.name).join(", ")}` : "no owner yet, so it starts locked until staff add one"}
                </p>
              )}
              {i.outOfService && <p className="club-meta">Added out of service: {i.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      {plan.toAdd.length > EQUIPMENT_LIST_LIMIT && <p className="club-meta">&hellip;and {plan.toAdd.length - EQUIPMENT_LIST_LIMIT} more items.</p>}
      {plan.alreadyHere.length > 0 && (
        <div data-testid="equip-already-here">
          <h4>{plural(plan.alreadyHere.length, "item")} already here, left alone</h4>
          <Limited items={plan.alreadyHere.map((i) => i.name)} />
        </div>
      )}
      {plan.toAdd.length > 0 && (
        <p>
          <button type="button" className="club-button" onClick={onAdd} disabled={pending} data-testid="equip-add">
            {pending ? "Adding…" : `Yes, add ${plural(plan.toAdd.length, "item")}`}
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Upload the equipment sheet, check it, then add the items. The page keeps the chosen file itself between the two presses (a
 * form would clear it after the first), and the second press sends it again with a fingerprint, so only the file that was
 * checked can be added.
 */
export function EquipmentForm() {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<EquipmentState>({ kind: "idle" });
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
      data.set("items", String(state.plan.toAdd.length));
    }
    startTransition(async () => {
      setState(await loadEquipment(data));
    });
  };

  return (
    <div className="club-form" data-testid="equip-form">
      <p>
        <label htmlFor="equip-file">Equipment sheet (CSV)</label>
        <input
          id="equip-file"
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setState({ kind: "idle" });
          }}
        />
      </p>
      <p>
        <button type="button" className="club-button" onClick={() => run("check")} disabled={pending || !file} data-testid="equip-check">
          {pending && state.kind !== "checked" ? "Checking…" : "Check the file"}
        </button>
      </p>
      {state.kind === "error" && (
        <p className="club-alert" role="alert" data-testid="equip-error">
          {state.message}
        </p>
      )}
      {state.kind === "checked" && <Checked fileName={state.fileName} plan={state.plan} pending={pending} onAdd={() => run("add")} />}
      {state.kind === "added" && (
        <section className="club-success" role="status" data-testid="equip-done">
          <p>
            <strong>Added {plural(state.added, "item")}.</strong>
            {state.outOfService > 0 && ` ${plural(state.outOfService, "item")} ${state.outOfService === 1 ? "was" : "were"} added out of service.`}
            {state.alreadyHere > 0 && ` ${plural(state.alreadyHere, "item")} in the file ${state.alreadyHere === 1 ? "was" : "were"} already here and left alone.`}
            {state.privateBoats > 0 && ` ${state.privateBoats === 1 ? "1 of them is a private boat." : `${state.privateBoats} of them are private boats.`}`}
            {state.locked > 0 && ` ${plural(state.locked, "private boat")} ${state.locked === 1 ? "has" : "have"} no owner yet and ${state.locked === 1 ? "is" : "are"} locked until staff add one.`}
            {state.pools > 0 && ` ${state.pools === 1 ? "1 of them is a pool of places." : `${state.pools} of them are pools of places.`}`}
          </p>
          <p>
            <Link href="/club/equipment">See the equipment</Link>
            {state.privateBoats > 0 && (
              <>
                {" "}&middot; <Link href="/club/admin/boats">Private boats</Link>
              </>
            )}
          </p>
        </section>
      )}
    </div>
  );
}
