/**
 * Whether the member area (and the "act as this test member" picker) exists at all.
 *
 * Phase 1 runs on invented data only, so the area is on while developing, or when the sample-data
 * switch is set (preview deployments, automated tests), and is always off on the live production
 * site. Turn-on for real members is a later, deliberate change.
 */
export function clubEnabled(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env.NODE_ENV !== "production" || env.CCS_ALLOW_SAMPLE_DATA === "1";
}
