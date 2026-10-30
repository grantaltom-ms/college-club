import { PgTourStore } from "./tours-postgres";
import { MemoryTourStore, type TourStore } from "./tours";
import { createClubPool } from "./postgres";

const g = globalThis as unknown as { __ccsTourStore?: TourStore };

/**
 * The one shared list of tour requests for the running server: Postgres when CLUB_DATABASE_URL is set (a local or throwaway
 * one only; hosted Supabase addresses are refused), otherwise an in-memory list that starts empty. Unlike the member area's
 * stores this one is also asked for by the public site's form, which has its own on/off switch, so it does not check
 * `clubEnabled()` itself: whoever asks for it checks the switch that guards their page.
 */
export function getTourStore(): TourStore {
  if (!g.__ccsTourStore) {
    const url = process.env.CLUB_DATABASE_URL;
    g.__ccsTourStore = url ? new PgTourStore(createClubPool(url, 2)) : new MemoryTourStore();
  }
  return g.__ccsTourStore;
}
