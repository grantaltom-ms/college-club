"use client";

import { ActionMessage } from "../admin/ActionMessage";
import { useStaffAction } from "../admin/useStaffAction";
import { addBoatToPractice, cancelThePractice, seatPerson, setUpPractice, takeBoatOffPractice, takeOutOfSeat } from "./actions";

const submit = (run: (form: HTMLFormElement, afterOk?: () => void) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const form = e.currentTarget;
  run(form, () => form.reset());
};

/** The form that sets up a practice: a name, a day and times, an optional coach (staff only), a note, and the boats to reserve. */
export function NewPracticeForm({
  boats,
  coaches,
  canNameCoach,
  today,
  limits,
}: {
  boats: { id: string; name: string; className: string; seats: number }[];
  coaches: { id: string; name: string }[];
  canNameCoach: boolean;
  today: string;
  limits: { name: number; notes: number; boats: number };
}) {
  const { state, pending, run } = useStaffAction(setUpPractice);
  return (
    <form
      className="club-form"
      data-testid="practice-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <p>
        <label htmlFor="practice-name">Name</label>
        <input id="practice-name" name="name" type="text" maxLength={limits.name} autoComplete="off" required />
      </p>
      <p>
        <label htmlFor="practice-day">Day</label>
        <input id="practice-day" name="day" type="date" min={today} required />
      </p>
      <p>
        <label htmlFor="practice-start">Starts</label>
        <input id="practice-start" name="start" type="time" required />
      </p>
      <p>
        <label htmlFor="practice-end">Ends</label>
        <input id="practice-end" name="end" type="time" required />
      </p>
      {canNameCoach && (
        <p>
          <label htmlFor="practice-coach">Run by</label>
          <select id="practice-coach" name="coach" defaultValue="">
            <option value="">Staff</option>
            {coaches.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (coach)
              </option>
            ))}
          </select>
        </p>
      )}
      <p>
        <label htmlFor="practice-notes">Note for the crew (optional)</label>
        <textarea id="practice-notes" name="notes" rows={3} maxLength={limits.notes} />
      </p>
      <fieldset>
        <legend>Boats to reserve (up to {limits.boats})</legend>
        <p className="club-meta">Nobody else can book a reserved boat while the practice runs. Bookings already made on it are not cancelled: you will see who made them.</p>
        <ul className="club-list" data-testid="practice-boats">
          {boats.map((b) => (
            <li key={b.id}>
              <label className="club-check">
                <input type="checkbox" name="boat" value={b.id} /> {b.name} <span className="club-meta">{b.className}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending} data-testid="practice-submit">
          Set up the practice
        </button>
      </p>
    </form>
  );
}

/** Reserve one more boat for a practice. */
export function AddBoatForm({ practiceId, boats }: { practiceId: string; boats: { id: string; name: string }[] }) {
  const { state, pending, run } = useStaffAction(addBoatToPractice);
  if (boats.length === 0) return <p className="club-meta">Every boat that can go on a practice is already on this one.</p>;
  return (
    <form className="club-form" data-testid="add-boat-form" onSubmit={submit(run)}>
      <input type="hidden" name="practice" value={practiceId} />
      <p>
        <label htmlFor={`add-boat-${practiceId}`}>Add a boat</label>
        <select id={`add-boat-${practiceId}`} name="boat" defaultValue="">
          <option value="" disabled>
            Choose a boat
          </option>
          {boats.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Add the boat
        </button>
      </p>
    </form>
  );
}

/** Take a boat off a practice: its seats are emptied and it can be booked again. */
export function TakeBoatOffButton({ practiceId, boatId, boat, seated }: { practiceId: string; boatId: string; boat: string; seated: number }) {
  const { state, pending, run } = useStaffAction(takeBoatOffPractice);
  return (
    <form
      data-testid="take-boat-off-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="practice" value={practiceId} />
      <input type="hidden" name="boat" value={boatId} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} aria-label={`Take ${boat} off the practice`}>
        {seated > 0 ? `Take off the practice (empties ${seated} ${seated === 1 ? "seat" : "seats"})` : "Take off the practice"}
      </button>
    </form>
  );
}

/** Seat a person the coach found by name: pick an empty seat and a side. */
export function SeatForm({
  practiceId,
  memberId,
  name,
  places,
}: {
  practiceId: string;
  memberId: string;
  name: string;
  places: { value: string; label: string }[];
}) {
  const { state, pending, run } = useStaffAction(seatPerson);
  if (places.length === 0) return <p className="club-meta">Every seat is taken.</p>;
  return (
    <form className="club-form" data-testid="seat-form" onSubmit={submit(run)}>
      <input type="hidden" name="practice" value={practiceId} />
      <input type="hidden" name="member" value={memberId} />
      <p>
        <label htmlFor={`place-${memberId}`}>Seat for {name}</label>
        <select id={`place-${memberId}`} name="place" defaultValue={places[0].value}>
          {places.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </p>
      <p>
        <label htmlFor={`side-${memberId}`}>Side</label>
        <select id={`side-${memberId}`} name="side" defaultValue="">
          <option value="">No side</option>
          <option value="port">Port</option>
          <option value="starboard">Starboard</option>
        </select>
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending} aria-label={`Seat ${name}`}>
          Seat
        </button>
      </p>
    </form>
  );
}

/** Take the person out of a seat. */
export function TakeOutButton({ practiceId, boatId, seat, name }: { practiceId: string; boatId: string; seat: number; name: string }) {
  const { state, pending, run } = useStaffAction(takeOutOfSeat);
  return (
    <form
      data-testid="take-out-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="practice" value={practiceId} />
      <input type="hidden" name="boat" value={boatId} />
      <input type="hidden" name="seat" value={String(seat)} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} aria-label={`Take ${name} out of seat ${seat}`}>
        Take out
      </button>
    </form>
  );
}

/** Cancel a practice that has not started. */
export function CancelPracticeForm({ practiceId, reasonMax }: { practiceId: string; reasonMax: number }) {
  const { state, pending, run } = useStaffAction(cancelThePractice);
  return (
    <form
      className="club-form"
      data-testid="cancel-practice-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="practice" value={practiceId} />
      <p>
        <label htmlFor={`cancel-reason-${practiceId}`}>Why? (optional)</label>
        <input id={`cancel-reason-${practiceId}`} name="reason" type="text" maxLength={reasonMax} autoComplete="off" />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-danger" disabled={pending}>
          Cancel the practice
        </button>
      </p>
    </form>
  );
}
