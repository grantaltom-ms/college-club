"use client";

import { useState, type ReactNode } from "react";
import type { ActionResult } from "@/club/web-actions";
import { ActionMessage } from "../admin/ActionMessage";
import { useStaffAction } from "../admin/useStaffAction";
import { bringItemBack, changeItem, retireTheItem } from "./actions";

const submit = (run: (form: HTMLFormElement) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  run(e.currentTarget);
};

export interface EditFormProps {
  itemId: string;
  name: string;
  /** Every size this kind of item comes in, with the current one's number; null when it has only one size. */
  seats: { current: number; choices: { value: number; label: string }[] } | null;
  /** The skill level choices, and which is chosen now. Null when the item is retired (only its name can change). */
  skill: { current: string; choices: { value: string; label: string }[] } | null;
  /** A pool's number of places; null when the item is not a pool or is retired. */
  places: number | null;
  /** Weight class and maker for boats; undefined when the item is not a boat or is retired. */
  weight:
    | {
        minWeightLbs: number | null;
        maxWeightLbs: number | null;
        manufacturer: string | null;
      }
    | undefined;
}

/** The boxes to fix on one item. Whatever staff leave as it is stays as it is. */
export function EditItemForm({ itemId, name, seats, skill, places, weight }: EditFormProps) {
  const { state, pending, run } = useStaffAction(changeItem);
  return (
    <form className="club-form" data-testid="edit-item-form" onSubmit={submit(run)}>
      <input type="hidden" name="item" value={itemId} />
      <p>
        <label htmlFor={`item-name-${itemId}`}>Name</label>
        <input id={`item-name-${itemId}`} name="name" type="text" maxLength={80} defaultValue={name} autoComplete="off" required />
      </p>
      {seats && (
        <p>
          <label htmlFor={`item-seats-${itemId}`}>Seats</label>
          <select id={`item-seats-${itemId}`} name="seats" defaultValue={String(seats.current)}>
            {seats.choices.map((c) => (
              <option key={c.value} value={String(c.value)}>
                {c.label}
              </option>
            ))}
          </select>
        </p>
      )}
      {skill && (
        <p>
          <label htmlFor={`item-skill-${itemId}`}>Skill level needed</label>
          <select id={`item-skill-${itemId}`} name="skill" defaultValue={skill.current}>
            {skill.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </p>
      )}
      {places !== null && (
        <p>
          <label htmlFor={`item-places-${itemId}`}>Places in this pool</label>
          <input id={`item-places-${itemId}`} name="places" type="number" inputMode="numeric" min={2} max={500} step={1} defaultValue={places} required />
        </p>
      )}
      {weight !== undefined && (
        <>
          <p>
            <label htmlFor={`item-min-weight-${itemId}`}>Min weight (pounds)</label>
            <input
              id={`item-min-weight-${itemId}`}
              name="minWeightLbs"
              type="number"
              inputMode="numeric"
              min={50}
              max={800}
              step={1}
              defaultValue={weight.minWeightLbs ?? ""}
              placeholder="Leave blank if not on file"
              autoComplete="off"
            />
          </p>
          <p>
            <label htmlFor={`item-weight-${itemId}`}>Max weight (pounds)</label>
            <input
              id={`item-weight-${itemId}`}
              name="maxWeightLbs"
              type="number"
              inputMode="numeric"
              min={50}
              max={800}
              step={1}
              defaultValue={weight.maxWeightLbs ?? ""}
              placeholder="Leave blank if not on file"
              autoComplete="off"
            />
            <span className="club-meta">Combined rower weight class. Leave both blank when weight is not on file. A single value means min = max.</span>
          </p>
          <p>
            <label htmlFor={`item-manufacturer-${itemId}`}>Manufacturer</label>
            <input
              id={`item-manufacturer-${itemId}`}
              name="manufacturer"
              type="text"
              maxLength={80}
              defaultValue={weight.manufacturer ?? ""}
              placeholder="Maker not listed"
              autoComplete="off"
            />
          </p>
        </>
      )}
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </p>
    </form>
  );
}

/**
 * Retiring an item and bringing it back. Doing either swaps the form for the other one, so what a button said ("Gannet is retired")
 * is kept here, in the part that stays on the page, and not inside the form that goes away. The page passes in what it wants shown
 * between the message and the form (the list of what stays in place), so that stays in the server's hands.
 */
export function ItemLifecycle({ itemId, itemName, retired, children }: { itemId: string; itemName: string; retired: boolean; children: ReactNode }) {
  const retire = useStaffAction(retireTheItem);
  const back = useStaffAction(bringItemBack);
  const [last, setLast] = useState<"retire" | "back" | null>(null);
  const said: ActionResult = last === "retire" ? retire.state : last === "back" ? back.state : { kind: "idle" };
  return (
    <div data-testid="item-lifecycle">
      <ActionMessage state={said} />
      {children}
      {retired ? (
        <form
          data-testid="bring-back-form"
          onSubmit={submit((form) => {
            setLast("back");
            back.run(form);
          })}
        >
          <input type="hidden" name="item" value={itemId} />
          <p>
            <button type="submit" className="club-button" disabled={back.pending} aria-label={`Bring ${itemName} back`}>
              {back.pending ? "Bringing back…" : `Bring ${itemName} back`}
            </button>
          </p>
        </form>
      ) : (
        <form
          className="club-form"
          data-testid="retire-form"
          onSubmit={submit((form) => {
            setLast("retire");
            retire.run(form);
          })}
        >
          <input type="hidden" name="item" value={itemId} />
          <p>
            <label htmlFor={`retire-reason-${itemId}`}>Why is it being retired? (kept in its file)</label>
            <input id={`retire-reason-${itemId}`} name="reason" type="text" maxLength={200} autoComplete="off" required />
          </p>
          <p>
            <button type="submit" className="club-button" disabled={retire.pending} aria-label={`Retire ${itemName}`}>
              {retire.pending ? "Retiring…" : `Retire ${itemName}`}
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
