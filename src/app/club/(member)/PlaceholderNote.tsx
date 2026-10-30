import { CLASS_RULES } from "@/club/settings/class-rules";
import { EVENT_RULES } from "@/club/settings/event-rules";
import { PRACTICE_RULES } from "@/club/settings/practice-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";

/** Shown wherever booking rules are in play, while the numbers are still placeholders. */
export function PlaceholderNote() {
  if (!RULE_BOOK.placeholder) return null;
  return (
    <p className="club-placeholder" data-testid="placeholder-note">
      <strong>Placeholder rules.</strong> The limits, hours and qualification levels here are stand-ins until club staff confirm the real ones.
    </p>
  );
}

/** The same note for the class sign-up rules. */
export function ClassPlaceholderNote() {
  if (!CLASS_RULES.placeholder) return null;
  return (
    <p className="club-placeholder" data-testid="placeholder-note">
      <strong>Placeholder rules.</strong> The sign-up window, limits and cutoffs here are stand-ins until club staff confirm the real ones.
    </p>
  );
}

/** The same note for the event RSVP rules. */
export function EventPlaceholderNote() {
  if (!EVENT_RULES.placeholder) return null;
  return (
    <p className="club-placeholder" data-testid="placeholder-note">
      <strong>Placeholder rules.</strong> The RSVP deadline, guest limit and cancel cutoff here are stand-ins until club staff confirm the real ones.
    </p>
  );
}

/** The same note for the practice rules. */
export function PracticePlaceholderNote() {
  if (!PRACTICE_RULES.placeholder) return null;
  return (
    <p className="club-placeholder" data-testid="placeholder-note">
      <strong>Placeholder rules.</strong> The longest practice, the most boats and how far ahead one can be set up are stand-ins until club staff confirm the real ones.
    </p>
  );
}
