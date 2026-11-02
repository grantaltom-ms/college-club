import { ordinal } from "./queries";
import type { SessionView, SheetLine } from "./classes";

/** "3 places left", "Full, 2 waiting", "Full", or "Cancelled". */
export function chairsText(view: SessionView): string {
  if (view.session.status === "cancelled") return "Cancelled";
  const left = view.session.capacity - view.enrolled;
  if (left > 0) return `${left} place${left === 1 ? "" : "s"} left`;
  return view.waiting > 0 ? `Full, ${view.waiting} waiting` : "Full";
}

/** Where the viewing member stands, or null if they are not on the sheet. */
export function yoursText(line: SheetLine | null): string | null {
  if (!line) return null;
  if (line.status === "enrolled") return "You have a place.";
  if (line.status === "waitlisted") return `You are on the waiting list, ${ordinal(line.place ?? 1)} in line.`;
  return null;
}
