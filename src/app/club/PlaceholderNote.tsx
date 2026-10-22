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
