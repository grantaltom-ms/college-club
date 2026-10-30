"use client";

import type { ActionResult } from "@/club/web-actions";
import { ActionMessage } from "./admin/ActionMessage";
import { useStaffAction } from "./admin/useStaffAction";

/** One button that puts a member on a private boat's list: "Invite" for an owner's screen, "Make owner" or "Invite" for staff. */
export function AddToBoatButton({ action, boatId, memberId, label, name }: { action: (data: FormData) => Promise<ActionResult>; boatId: string; memberId: string; label: string; name: string }) {
  const { state, pending, run } = useStaffAction(action);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="boat" value={boatId} />
      <input type="hidden" name="member" value={memberId} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} data-testid="boat-add" aria-label={`${label} ${name}`}>
        {label}
      </button>
    </form>
  );
}

/** Takes one person off a private boat's list. The button says how many bookings that cancels, so nobody is surprised. */
export function RemoveFromBoatButton({ action, accessId, name, bookings, crewSeats }: { action: (data: FormData) => Promise<ActionResult>; accessId: string; name: string; bookings: number; crewSeats: number }) {
  const { state, pending, run } = useStaffAction(action);
  const effects = [bookings > 0 ? `cancels ${bookings} booking${bookings === 1 ? "" : "s"}` : "", crewSeats > 0 ? `removes ${crewSeats} crew seat${crewSeats === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(e.currentTarget);
      }}
    >
      <input type="hidden" name="access" value={accessId} />
      <ActionMessage state={state} />
      <button type="submit" className="club-button club-button-quiet" disabled={pending} data-testid="boat-remove" aria-label={`Take ${name} off the boat`}>
        {effects ? `Take off (${effects})` : "Take off"}
      </button>
    </form>
  );
}
