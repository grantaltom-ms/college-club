import type { EquipmentPlan, EquipmentResult } from "./engine/equipment-import";

/** What the equipment upload screen shows after each press. Plain data only, so it can travel from the server to the page. */
export type EquipmentState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "checked"; fileName: string; plan: EquipmentPlan }
  | ({ kind: "added"; fileName: string } & EquipmentResult);

/** How many problems, items and notes the screen lists before saying "and N more". */
export const EQUIPMENT_LIST_LIMIT = 50;
