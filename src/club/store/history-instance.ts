import { clubNow } from "../clock";
import { runHistoryImport } from "../engine/history";
import { clubEnabled } from "../enabled";
import { ClubError } from "../errors";
import { sampleHistoryCsv } from "../sample/icrew";
import { pacificDate } from "../time";
import { MemoryHistoryStore, type HistoryStore } from "./history";
import { PgHistoryStore } from "./history-postgres";
import { createClubPool } from "./postgres";

const g = globalThis as unknown as { __ccsHistoryStore?: Promise<HistoryStore> };

/** Loads the invented old bookings into an empty archive. Two servers seeding at once is fine: the second finds nothing to add. */
async function seedSample(store: HistoryStore): Promise<void> {
  if ((await store.summary()).rows > 0) return;
  const now = clubNow();
  try {
    await runHistoryImport(store, { actor: { kind: "staff", label: "Test staff" }, now }, { fileName: "sample-icrew-history.csv", text: sampleHistoryCsv(pacificDate(now)) });
  } catch (e) {
    if (!(e instanceof ClubError)) throw e;
  }
}

async function open(url: string | undefined): Promise<HistoryStore> {
  if (!url) {
    const store = new MemoryHistoryStore();
    await seedSample(store);
    return store;
  }
  const store = new PgHistoryStore(createClubPool(url, 2));
  if (process.env.CCS_ALLOW_SAMPLE_DATA === "1") await seedSample(store);
  return store;
}

/**
 * The one shared archive of old bookings for the running server: Postgres when CLUB_DATABASE_URL is set (a local or throwaway
 * one only; hosted Supabase addresses are refused), otherwise an in-memory copy holding the invented sample.
 */
export function getHistoryStore(): Promise<HistoryStore> {
  if (!clubEnabled()) throw new Error("The member area is switched off.");
  if (!g.__ccsHistoryStore) {
    const opening = open(process.env.CLUB_DATABASE_URL);
    opening.catch(() => {
      if (g.__ccsHistoryStore === opening) delete g.__ccsHistoryStore;
    });
    g.__ccsHistoryStore = opening;
  }
  return g.__ccsHistoryStore;
}
