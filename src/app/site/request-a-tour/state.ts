import type { TourFieldErrors } from "@/club/engine/tours";

/** What the Request a tour form knows after a press of the button. (Kept apart from actions.ts: a server-action file may only export actions.) */
export type TourFormState =
  | { kind: "idle" }
  | { kind: "sent"; firstName: string }
  /** The whole site is getting too many requests this hour: the form asks the person to phone. */
  | { kind: "busy" }
  | { kind: "error"; errors: TourFieldErrors; values: { name: string; email: string; phone: string; note: string } };

export const IDLE: TourFormState = { kind: "idle" };
