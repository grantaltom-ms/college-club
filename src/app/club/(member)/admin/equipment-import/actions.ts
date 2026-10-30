"use server";

import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ClubError } from "@/club/errors";
import { MAX_EQUIPMENT_BYTES, planEquipment, runEquipment } from "@/club/engine/equipment-import";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import type { EquipmentState } from "@/club/web-equipment";

/**
 * The equipment upload screen's two buttons. "check" reads the file and says what it would do, changing nothing; "add" does it,
 * all or nothing, and only if the file is the one that was checked. Staff only: anyone else, and the live site, gets the same
 * "not found" as every other member-area page.
 */
export async function loadEquipment(formData: FormData): Promise<EquipmentState> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") notFound();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "error", message: "Choose a file first." };
  if (file.size > MAX_EQUIPMENT_BYTES) return { kind: "error", message: `The file is too big: it can be up to ${MAX_EQUIPMENT_BYTES / 1000} KB, which is far more equipment than the club has.` };
  const text = await file.text();
  const store = await getClubStore();
  const now = clubNow();

  if (formData.get("intent") === "check") {
    return { kind: "checked", fileName: file.name, plan: planEquipment(await store.read(), text) };
  }
  if (formData.get("intent") !== "add") return { kind: "error", message: "Something was missing. Check the file again." };

  const fingerprint = String(formData.get("fingerprint") ?? "");
  const items = String(formData.get("items") ?? "");
  // Plain digits only: an empty box would otherwise read as 0, and "2.5" or "1e3" as numbers.
  if (!/^[0-9a-f]{64}$/.test(fingerprint) || !/^\d{1,6}$/.test(items)) return { kind: "error", message: "Check the file first, then add the equipment." };
  try {
    const result = await runEquipment(store, { actor: toEngineActor(actor), now }, text, { fingerprint, items: Number(items) });
    return { kind: "added", fileName: file.name, ...result };
  } catch (e) {
    if (e instanceof ClubError) return { kind: "error", message: e.message };
    throw e;
  }
}
