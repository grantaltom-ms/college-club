"use client";

import { useState } from "react";
import { describeChange, describeParty } from "@/club/party-words";

/**
 * "How many people are coming, including you?" with a minus and a plus. The words under it change as the number does, so
 * a member knows before pressing anything whether the spots are there (and, if not, that there is a waitlist and how long
 * a place on it is held). The server checks everything again when the form is sent; this only saves a round trip.
 *
 * Without JavaScript the buttons do nothing but the form still sends the number it started with.
 */
interface Shared {
  /** The name of the field the number is sent in. */
  name: string;
  initial: number;
  min?: number;
  max: number;
  /** Price of one spot in cents, to show the total. */
  priceCents: number | null;
}

export type PartyStepperProps =
  | (Shared & { mode: "join"; left: number | null; waitlistOpen: boolean; waitlistRoom: number; holdMinutes: number })
  | (Shared & { mode: "change"; fits: number | null; hasSpots: boolean; submitLabel: string });

const dollars = (cents: number) => (cents === 0 ? "Free" : `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`);

export function PartyStepper(props: PartyStepperProps) {
  const min = props.min ?? 1;
  const [people, setPeople] = useState(Math.min(Math.max(props.initial, min), props.max));
  const step = (by: number) => setPeople((n) => Math.min(Math.max(n + by, min), props.max));

  const join = props.mode === "join" ? describeParty({ people, left: props.left, waitlistOpen: props.waitlistOpen, waitlistRoom: props.waitlistRoom, holdMinutes: props.holdMinutes }) : null;
  const change = props.mode === "change" ? describeChange({ people, fits: props.fits, hasSpots: props.hasSpots }) : null;
  const notice = join?.notice ?? change?.notice ?? "";
  const canSubmit = join?.canSubmit ?? change?.canSubmit ?? true;

  return (
    <div className="party" data-testid="party">
      <p id={`${props.name}-label`} className="party-label">
        How many people are coming, including you?
      </p>
      <div className="party-stepper" role="group" aria-labelledby={`${props.name}-label`}>
        <button type="button" className="party-step" aria-label="Fewer people" onClick={() => step(-1)} disabled={people <= min}>
          &minus;
        </button>
        <output className="party-count" data-testid="party-count" aria-live="polite">
          {people}
        </output>
        <button type="button" className="party-step" aria-label="More people" onClick={() => step(1)} disabled={people >= props.max}>
          +
        </button>
      </div>
      <input type="hidden" name={props.name} value={people} />
      {props.priceCents !== null && props.priceCents > 0 && (
        <p className="club-meta" data-testid="price-total">
          {people} {people === 1 ? "spot" : "spots"} × {dollars(props.priceCents)} = {dollars(people * props.priceCents)}
        </p>
      )}
      {notice && (
        <p className={join && join.outcome !== "room" ? "club-alert" : "club-meta"} role="status" data-testid="party-notice">
          {notice}
        </p>
      )}
      <p>
        <button type="submit" className="club-button" disabled={!canSubmit} data-testid="party-submit">
          {join ? join.submitLabel : props.mode === "change" ? props.submitLabel : "RSVP"}
        </button>
        {join?.insteadPeople ? (
          <>
            {" "}
            <button type="submit" name="instead" value={join.insteadPeople} className="club-button club-button-quiet" data-testid="party-instead">
              RSVP for {join.insteadPeople} instead
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
