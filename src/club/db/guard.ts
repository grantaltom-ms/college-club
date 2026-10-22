/**
 * The live project, or any hosted Supabase address. Phase 1 work (tests, development, previews) must never
 * connect to these: it uses a local or throwaway Postgres only.
 */
export function looksLikeHostedSupabase(url: string): boolean {
  return /supabase\.(co|com|net|in)|hgjcnuwxhemynnvsnmou|pooler\.supabase/i.test(url);
}

export const HOSTED_REFUSAL = "Refusing to connect: that database address looks like a hosted Supabase project. Phase 1 uses a local or throwaway Postgres only.";

export function assertNotHosted(url: string): void {
  if (looksLikeHostedSupabase(url)) throw new Error(HOSTED_REFUSAL);
}
