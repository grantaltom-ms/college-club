import type { HistoryPlan } from "./engine/history";

/** What the old-bookings import screen shows after each press. Plain data only, so it can travel from the server to the page. */
export type HistoryImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "checked"; fileName: string; plan: HistoryPlan }
  | { kind: "added"; fileName: string; added: number; skipped: number };

/** How many problems and names the screen lists before saying "and N more". */
export const HISTORY_LIST_LIMIT = 50;
