"use server";

import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { clubEnabled } from "@/club/enabled";
import { ClubError } from "@/club/errors";
import { planHistoryImport, runHistoryImport } from "@/club/engine/history";
import { MAX_HISTORY_BYTES } from "@/club/engine/icrew";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { getHistoryStore } from "@/club/store/history-instance";
import type { HistoryImportState } from "@/club/web-history";

/**
 * The old-bookings import screen's two buttons. "check" reads the file and says what it would do, changing nothing; "add" does
 * it, all or nothing, and only if the file is the one that was checked. Staff only: anyone else, and the live site, gets the same
 * "not found" as every other member-area page.
 */
export async function importHistory(formData: FormData): Promise<HistoryImportState> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") notFound();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { kind: "error", message: "Choose a file first." };
  if (file.size > MAX_HISTORY_BYTES) {
    return { kind: "error", message: `The file is too big: it can be up to ${MAX_HISTORY_BYTES / 1_000_000} MB, which is about 30,000 rows. Export a shorter date range from iCrew and upload the pieces one after another.` };
  }
  const text = await file.text();
  const history = await getHistoryStore();
  const now = clubNow();

  if (formData.get("intent") === "check") {
    const members = (await (await getClubStore()).read()).members;
    return { kind: "checked", fileName: file.name, plan: await planHistoryImport(history, members, text, now) };
  }
  if (formData.get("intent") !== "add") return { kind: "error", message: "Something was missing. Check the file again." };

  const fingerprint = String(formData.get("fingerprint") ?? "");
  const count = String(formData.get("toAdd") ?? "");
  // Plain digits only: an empty box would otherwise read as 0, and "2.5" or "1e3" as numbers.
  if (!/^[0-9a-f]{64}$/.test(fingerprint) || !/^\d{1,6}$/.test(count)) return { kind: "error", message: "Check the file first, then add." };
  try {
    const result = await runHistoryImport(history, { actor: toEngineActor(actor), now }, { fileName: file.name, text }, { fingerprint, toAdd: Number(count) });
    return { kind: "added", fileName: file.name, ...result };
  } catch (e) {
    if (e instanceof ClubError) return { kind: "error", message: e.message };
    throw e;
  }
}
