import { createClubPool } from "../store/postgres";
import { PgTestMail } from "./test-mail";

const g = globalThis as unknown as { __ccsTestMail?: PgTestMail };

/**
 * The shared test outbox for the running server: Postgres when CLUB_DATABASE_URL is set (a local or throwaway one only; hosted
 * Supabase addresses are refused), otherwise nothing, and the in-memory outbox in `mail.ts` is the only copy. Whoever asks checks
 * that this is a test build (`outboxEnabled()`): the live site never reaches here.
 */
export function sharedTestMail(env: Partial<Record<string, string | undefined>> = process.env): PgTestMail | null {
  const url = env.CLUB_DATABASE_URL;
  if (!url) return null;
  return (g.__ccsTestMail ??= new PgTestMail(createClubPool(url, 2)));
}
