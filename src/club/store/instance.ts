import { clubNow } from "../clock";
import { clubEnabled } from "../enabled";
import { buildSampleStore, seedSample } from "../sample/club";
import { CLASS_RULES } from "../settings/class-rules";
import { EVENT_RULES } from "../settings/event-rules";
import { RULE_BOOK } from "../settings/rulebook";
import { sequentialIds, type ClubStore } from "./memory";
import { PgClubStore, createClubPool } from "./postgres";

const g = globalThis as unknown as { __ccsClubStore?: Promise<ClubStore> };

/**
 * Opens the Postgres store: the rule tables are brought in line with the rules file, and the invented sample club
 * is loaded if (and only if) sample data is allowed and the database holds no households yet.
 */
async function openPostgres(url: string): Promise<ClubStore> {
  const store = new PgClubStore(createClubPool(url), { now: clubNow });
  await store.syncRules(RULE_BOOK, CLASS_RULES, EVENT_RULES);
  if (process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    // Fixed IDs while seeding, so the sample's addresses read the same as the in-memory sample's.
    await store.seedIfEmpty((empty) => seedSample(empty.withIds(sequentialIds())));
  }
  return store;
}

/**
 * The one shared store for the running server. With CLUB_DATABASE_URL set it is that (local or throwaway)
 * Postgres; otherwise it is the in-memory sample club. Hosted Supabase addresses are refused.
 */
export function getClubStore(): Promise<ClubStore> {
  // Defense in depth: even a page that forgot its own check cannot read the club while it is switched off.
  if (!clubEnabled()) throw new Error("The member area is switched off.");
  const url = process.env.CLUB_DATABASE_URL;
  if (!g.__ccsClubStore) {
    const opening = url ? openPostgres(url) : buildSampleStore();
    // If opening fails (the database is down, or the address is refused), do not remember the failure: try again next time.
    opening.catch(() => {
      if (g.__ccsClubStore === opening) delete g.__ccsClubStore;
    });
    g.__ccsClubStore = opening;
  }
  return g.__ccsClubStore;
}
