import { cookies } from "next/headers";
import { FINANCIALS_COOKIE, financialsPassword, tokenValid, UNLOCK_DAYS } from "@/lib/financials-lock";
import { FinancialsView } from "./FinancialsView";

/**
 * The Financials page is behind one shared board password (DASHBOARD_FINANCIALS_PASSWORD). Until this browser has typed
 * it, the page shows only the password box, and the figures endpoint answers "locked" too, so the numbers never reach
 * a browser without the password.
 */
export default async function FinancialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const password = financialsPassword();
  const jar = await cookies();
  if (tokenValid(jar.get(FINANCIALS_COOKIE)?.value, password, new Date())) {
    return (
      <>
        <FinancialsView />
        <form method="post" action="/api/financials/lock" className="finance-lock-out">
          <button type="submit" className="link-button">
            Lock Financials on this device
          </button>
        </form>
      </>
    );
  }
  const params = await searchParams;
  return (
    <>
      <h1 className="page-title">Financials.</h1>
      {password ? (
        <form method="post" action="/api/financials/unlock" className="finance-lock">
          <p>The club&apos;s finance figures are for the board. Type the Financials password to see them.</p>
          {params.wrong === "1" && (
            <p className="status-error" role="alert">
              That password is not right. Check it and try again.
            </p>
          )}
          {params.locked === "1" && (
            <p className="finance-lock-note" role="status">
              Financials is locked on this device.
            </p>
          )}
          <label htmlFor="finance-password">Password</label>
          <input id="finance-password" name="password" type="password" autoComplete="current-password" required className="search" />
          <button type="submit" className="link-button">
            Unlock
          </button>
          <p className="finance-lock-note">This device stays unlocked for {UNLOCK_DAYS} days.</p>
        </form>
      ) : (
        <div className="status-error" role="alert">
          <p>The Financials password has not been set up yet, so this page is locked for everyone.</p>
          <p>Add DASHBOARD_FINANCIALS_PASSWORD (at least 8 characters) in the site&apos;s private settings in Vercel, then redeploy.</p>
        </div>
      )}
    </>
  );
}
