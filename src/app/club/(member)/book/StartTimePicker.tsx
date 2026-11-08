import type { SlotView } from "@/club/engine/availability";
import { formatClock, formatRange } from "@/club/time";

/** The words for a slot that cannot be chosen, by its state. */
export const SLOT_WORDS: Record<SlotView["state"], string> = {
  free: "Free",
  yours: "Yours",
  booked: "Booked",
  class: "Class",
  practice: "Practice",
  out_of_service: "Out of service",
  not_open: "Not open yet",
  past: "Past",
};

/**
 * One item's start times as a dropdown and a Book button (Grant, Nov 7: a wall of time boxes on a phone is replaced by a
 * dropdown everywhere). It is a plain form that sends `item` and `start` to the booking form by GET, so it needs no script:
 * the booking form already reads exactly those two from the address, as the old slot links did.
 *
 * Every open slot is listed, so a member still sees what is taken and by what ("7:00 am · Class", "7:00 am · Yours",
 * staff see "7:00 am · Sasha Bellweather"), but only a free slot can be chosen. Each option carries the same aria-label the
 * old slot cells did ("Heron, 7:00 to 7:30 am, free"), so the browser tests find a time the same way a screen reader names it.
 */
export function StartTimePicker({
  itemId,
  itemName,
  slots,
  places,
  bookable,
  coachBlocked,
  unavailableWords,
  compact = false,
}: {
  itemId: string;
  itemName: string;
  slots: SlotView[];
  /** How many places the item has at once (a pool); 1 for a boat or a room. */
  places: number;
  /** Whether this viewer may book this item at all (not locked, not coaches-only for a member). */
  bookable: boolean;
  /** A free slot on a coaches-only boat shown to a member who is not a coach. */
  coachBlocked: boolean;
  /** When nothing is bookable, the short reason shown as the placeholder (for example "Coaches only"). */
  unavailableWords?: string;
  /** The dense shell list: the label is read out but not drawn, and the row is tighter. */
  compact?: boolean;
}) {
  const choices = slots.map((slot) => {
    const counted = slot.placesLeft !== null && !slot.heldFor && (slot.state === "free" || slot.state === "booked" || slot.state === "yours");
    const coachesOnlySlot = slot.state === "free" && coachBlocked;
    const words = slot.heldFor
      ? `${slot.heldFor} class`
      : coachesOnlySlot
        ? "coaches only"
        : counted && slot.state !== "yours"
          ? `${slot.placesLeft} of ${places} places left`
          : SLOT_WORDS[slot.state].toLowerCase();
    const label = `${itemName}, ${formatRange(slot.startsAt, slot.endsAt)}, ${words}`;
    const free = slot.state === "free" && bookable && !coachesOnlySlot;
    const taken = slot.state === "booked" || slot.state === "class" || slot.state === "practice" || slot.state === "out_of_service" || slot.state === "not_open";
    // What the dropdown shows after the time: nothing for a plain free slot, the places left on a pool, or what holds it.
    const shortTaken = slot.bookedBy ?? slot.heldFor ?? (slot.state === "booked" && slot.placesLeft !== null ? "Full" : SLOT_WORDS[slot.state]);
    const note = coachesOnlySlot
      ? "Coaches only"
      : slot.state === "free"
        ? slot.placesLeft !== null
          ? `${slot.placesLeft} left`
          : ""
        : slot.state === "yours"
          ? "Yours"
          : taken
            ? shortTaken
            : SLOT_WORDS[slot.state];
    return {
      value: slot.startsAt,
      label,
      free,
      state: coachesOnlySlot ? "coaches_only" : slot.state,
      text: note ? `${formatClock(slot.startsAt)} · ${note}` : formatClock(slot.startsAt),
      title: slot.holders.length > 0 ? slot.holders.join(", ") : undefined,
    };
  });
  const anyFree = choices.some((c) => c.free);
  const selectId = `start-${itemId}`;

  return (
    <form className={`club-start-pick${compact ? " club-start-pick-compact" : ""}`} action="/club/book/new" method="get" data-testid="start-pick" data-item={itemName}>
      <input type="hidden" name="item" value={itemId} />
      <label htmlFor={selectId} className={compact ? "sr-only" : "club-start-pick-label"}>
        Start time
      </label>
      <div className="club-start-pick-row">
        <select
          id={selectId}
          name="start"
          required
          disabled={!anyFree}
          defaultValue=""
          aria-label={`Start time for ${itemName}`}
          data-testid="start-select"
        >
          <option value="" disabled>
            {anyFree ? "Choose a time" : (unavailableWords ?? "Nothing free")}
          </option>
          {choices.map((c) => (
            <option key={c.value} value={c.value} disabled={!c.free} aria-label={c.label} data-state={c.state} title={c.title}>
              {c.text}
            </option>
          ))}
        </select>
        <button type="submit" className="club-button" disabled={!anyFree} aria-label={`Book ${itemName} at the chosen time`}>
          Book
        </button>
      </div>
    </form>
  );
}
