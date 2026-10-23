type Env = Partial<Record<string, string | undefined>>;

/**
 * Whether invented sample data is allowed to run at all: while developing, or when the sample-data switch is set (preview
 * deployments, automated tests), and never on the live production site.
 *
 * Everything that only makes sense with invented data (the sample club, the "act as this test member" picker, the test outbox
 * that shows sign-in emails on screen) hangs off this, not off `clubEnabled`. So when the member area is one day switched on
 * for real members, those test tools stay off.
 */
export function sampleDataAllowed(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env.NODE_ENV !== "production" || env.CCS_ALLOW_SAMPLE_DATA === "1";
}

/**
 * Whether the member area exists at all.
 *
 * Phase 1 runs on invented data only, so the area is on exactly when sample data is allowed. Turn-on for real members is a
 * later, deliberate change, and it changes this function only.
 */
export function clubEnabled(env: Env = process.env): boolean {
  return sampleDataAllowed(env);
}

/** The "act as this test member" picker: a stand-in for logging in that only exists with invented data. */
export function pickerEnabled(env: Env = process.env): boolean {
  return sampleDataAllowed(env);
}

/**
 * The test outbox: in a test build no real email is sent, and the sign-in "email" is shown on the test outbox page instead.
 * Anyone who can see that page can sign in as anyone, so it must never exist where real members could be signing in.
 */
export function outboxEnabled(env: Env = process.env): boolean {
  return sampleDataAllowed(env);
}
