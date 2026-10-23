import type { Pool } from "pg";
import { clubEnabled } from "../enabled";
import { createClubPool } from "../store/postgres";
import { PgAuthStore } from "./postgres";
import { MemoryAuthStore, type AuthStore } from "./store";

const g = globalThis as unknown as { __ccsAuthStore?: AuthStore; __ccsAuthPool?: Pool };

/**
 * The one shared place sign-in links and signed-in browsers are kept for the running server. With CLUB_DATABASE_URL set it is
 * that Postgres (the same refusals of hosted Supabase addresses apply); otherwise it is in memory.
 */
export function getAuthStore(): AuthStore {
  if (!clubEnabled()) throw new Error("The member area is switched off.");
  if (!g.__ccsAuthStore) {
    const url = process.env.CLUB_DATABASE_URL;
    if (url) {
      g.__ccsAuthPool ??= createClubPool(url, 2);
      g.__ccsAuthStore = new PgAuthStore(g.__ccsAuthPool);
    } else {
      g.__ccsAuthStore = new MemoryAuthStore();
    }
  }
  return g.__ccsAuthStore;
}
