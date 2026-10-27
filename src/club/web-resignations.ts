import type { ResignationPlan } from "./engine/resignations";

/** What the resignations screen shows after each press. Plain data only, so it can travel from the server to the page. */
export type ResignationState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "checked"; fileName: string; plan: ResignationPlan }
  | { kind: "ended"; fileName: string; ended: number; adults: number; cancelledBookings: number; cancelledSignUps: number; cancelledRsvps: number; alreadyEnded: number };

/** How many problems, households and notes the screen lists before saying "and N more". */
export const RESIGNATION_LIST_LIMIT = 50;
