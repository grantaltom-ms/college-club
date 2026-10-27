"use server";

import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ClubError } from "@/club/errors";
import { clubLedger } from "@/club/engine/ledger";
import { MAX_RESIGNATION_BYTES, planResignations, runResignations } from "@/club/engine/resignations";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import type { ResignationState } from "@/club/web-resignations";

/**
 * The resignations screen's two buttons. "check" reads the file and says what it would do, changing nothing; "end" does it,
 * all or nothing, and only if the file is the one that was checked. Staff only: anyone else, and the live site, gets the same
 * "not found" as every other member-area page.
 */
export async function endHouseholds(formData: FormData): Promise<ResignationState> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") notFound();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "error", message: "Choose a file first." };
  if (file.size > MAX_RESIGNATION_BYTES) return { kind: "error", message: `The file is too big: it can be up to ${MAX_RESIGNATION_BYTES / 1000} KB, which is far more households than one file can end.` };
  const text = await file.text();
  const store = await getClubStore();
  const now = clubNow();

  if (formData.get("intent") === "check") {
    return { kind: "checked", fileName: file.name, plan: planResignations(await store.read(), text, now) };
  }
  if (formData.get("intent") !== "end") return { kind: "error", message: "Something was missing. Check the file again." };

  const fingerprint = String(formData.get("fingerprint") ?? "");
  const counts = [String(formData.get("households") ?? ""), String(formData.get("adults") ?? "")];
  // Plain digits only: an empty box would otherwise read as 0, and "2.5" or "1e3" as numbers.
  if (!/^[0-9a-f]{64}$/.test(fingerprint) || !counts.every((c) => /^\d{1,6}$/.test(c))) return { kind: "error", message: "Check the file first, then end the memberships." };
  const [households, adults] = counts.map(Number);
  try {
    const result = await runResignations(store, clubLedger, { actor: toEngineActor(actor), now }, text, { fingerprint, households, adults });
    return { kind: "ended", fileName: file.name, ...result };
  } catch (e) {
    if (e instanceof ClubError) return { kind: "error", message: e.message };
    throw e;
  }
}
