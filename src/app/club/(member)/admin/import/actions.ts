"use server";

import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ClubError } from "@/club/errors";
import { planImport, runImport } from "@/club/engine/import";
import { MAX_ROSTER_BYTES } from "@/club/engine/roster";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { pacificDate } from "@/club/time";
import type { ImportState } from "@/club/web-import";

/**
 * The roster import screen's two buttons. "check" reads the file and says what it would do, changing nothing; "add" does it,
 * all or nothing, and only if the file is the one that was checked. Staff only: anyone else, and the live site, gets the same
 * "not found" as every other member-area page.
 */
export async function importRoster(formData: FormData): Promise<ImportState> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") notFound();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "error", message: "Choose a file first." };
  if (file.size > MAX_ROSTER_BYTES) return { kind: "error", message: `The file is too big: it can be up to ${MAX_ROSTER_BYTES / 1000} KB, which is about 3,000 people.` };
  const text = await file.text();
  const store = await getClubStore();
  const now = clubNow();

  if (formData.get("intent") === "check") {
    return { kind: "checked", fileName: file.name, plan: planImport(await store.read(), text, pacificDate(now)) };
  }
  if (formData.get("intent") !== "add") return { kind: "error", message: "Something was missing. Check the file again." };

  const fingerprint = String(formData.get("fingerprint") ?? "");
  const counts = [String(formData.get("households") ?? ""), String(formData.get("adults") ?? "")];
  // Plain digits only: an empty box would otherwise read as 0, and "2.5" or "1e3" as numbers.
  if (!/^[0-9a-f]{64}$/.test(fingerprint) || !counts.every((c) => /^\d{1,6}$/.test(c))) return { kind: "error", message: "Check the file first, then add." };
  const [households, adults] = counts.map(Number);
  try {
    const result = await runImport(store, { actor: toEngineActor(actor), now }, text, { fingerprint, households, adults });
    return { kind: "added", fileName: file.name, ...result };
  } catch (e) {
    if (e instanceof ClubError) return { kind: "error", message: e.message };
    throw e;
  }
}
