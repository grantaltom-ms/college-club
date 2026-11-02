import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DEMO_COOKIE, DEMO_PASS_DAYS, DEMO_PASSWORD_MIN_LENGTH, demoGateState, demoNext, demoPassValid, demoPassword } from "@/club/demo-gate";
import { Eyebrow, Logo } from "@/components/ds/Pieces";
import "@/components/ds/ds.css";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Nothing about the keypad, not even its title, appears where it is switched off (the live site, development). */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  if (demoGateState() === "off") return {};
  return { title: "College Club Seattle: demo (test build)", robots: { index: false, follow: false } };
}

/**
 * The demo keypad: where a visitor types the shared demo password before they can open the invented club. A browser that already
 * holds a good pass is sent straight on to the page it asked for. Where the keypad is off this page does not exist.
 */
export default async function DemoKeypad({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const state = demoGateState();
  if (state === "off") notFound();
  const query = await searchParams;
  const next = demoNext(one(query.next));
  const jar = await cookies();
  const justLocked = one(query.locked) === "1";
  if (state === "on" && !justLocked && demoPassValid(jar.get(DEMO_COOKIE)?.value, demoPassword(), new Date())) redirect(next);

  return (
    <div className="ds-app ds-ui">
      <header className="ds-app-band ds-dark">
        <div className="ds-app-inner">
          <Logo tone="white" size={48} />
          <Eyebrow tone="sun">Demo</Eyebrow>
          <h1>Try the club system.</h1>
          <p className="ds-app-lead">A test version with invented people and bookings. Nothing here is real.</p>
        </div>
      </header>
      <main className="ds-app-body">
        <div className="ds-app-inner">
          {state === "weak" ? (
            <p className="ds-error" role="alert" data-testid="demo-weak">
              The demo password has not been set up properly, so the demo is locked for everyone. It needs at least {DEMO_PASSWORD_MIN_LENGTH} characters. Set CCS_DEMO_PASSWORD in the site&apos;s private settings in Vercel, then redeploy.
            </p>
          ) : (
            <>
              <p className="ds-app-intro">Everything inside is invented: the members, the bookings and the bills. Type the demo password to go in.</p>
              {one(query.wrong) === "1" && (
                <p className="ds-error" role="alert" data-testid="demo-wrong">
                  That password is not right. Check it and try again.
                </p>
              )}
              {justLocked && (
                <p className="ds-status" role="status" data-testid="demo-locked">
                  The demo is locked on this device.
                </p>
              )}
              <form method="post" action="/api/demo/unlock" className="ds-form" data-testid="demo-form">
                <input type="hidden" name="next" value={next} />
                <div className="ds-field">
                  <label className="ds-label" htmlFor="demo-password">
                    Demo password
                  </label>
                  <input id="demo-password" name="password" type="password" className="ds-input" maxLength={200} autoComplete="current-password" required />
                </div>
                <button type="submit" className="ds-button ds-button-large">
                  Open the demo
                </button>
                <p className="ds-hint">This device stays unlocked for {DEMO_PASS_DAYS} days.</p>
              </form>
            </>
          )}
          <Link href="/" className="ds-back" data-testid="demo-back">
            <span aria-hidden="true">←</span> Back to the dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
