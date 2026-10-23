import type { ImportPlan } from "./engine/import";

/** What the roster import screen shows after each press. Plain data only, so it can travel from the server to the page. */
export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "checked"; fileName: string; plan: ImportPlan }
  | { kind: "added"; fileName: string; added: number; adults: number; alreadyHere: number };

/** How many problems, households and notes the screen lists before saying "and N more". */
export const IMPORT_LIST_LIMIT = 50;
