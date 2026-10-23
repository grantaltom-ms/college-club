import { ordinal } from "./queries";
import type { EventView, RsvpLine } from "./events";

/** "$25", "$12.50", or "Free". */
export function priceText(cents: number | null): string {
  if (cents === null) return "";
  if (cents === 0) return "Free";
  return `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
}

/** "12 places left", "Full, 3 waiting", "18 going" (no limit), or "Cancelled". */
export function placesText(view: EventView): string {
  if (view.event.status === "cancelled") return "Cancelled";
  if (view.left === null) return `${view.going} going`;
  if (view.left > 0) return `${view.left} place${view.left === 1 ? "" : "s"} left`;
  return view.waiting > 0 ? `Full, ${view.waiting} waiting` : "Full";
}

/** Where the viewing member stands, or null if they are not on the list. */
export function yoursEventText(line: RsvpLine | null): string | null {
  if (!line) return null;
  const guests = line.guests > 0 ? `, with ${line.guests} guest${line.guests === 1 ? "" : "s"}` : "";
  if (line.status === "going") return `You are going${guests}.`;
  if (line.status === "waitlisted") return `You are on the waiting list${guests}, ${ordinal(line.place ?? 1)} in line.`;
  return null;
}
