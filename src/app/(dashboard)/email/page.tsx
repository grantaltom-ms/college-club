import { cookies } from "next/headers";
import { EmailSection } from "@/components/sections/EmailSection";
import { EmailListsPanel } from "@/components/EmailListsPanel";
import { EMAIL_LISTS_COOKIE, emailListsPassword, listsTokenValid, UNLOCK_DAYS } from "@/lib/email-lists-lock";

/**
 * The Email page. The campaign figures below are open to anyone with the link and show counts only. The list builder at the
 * top shows member names and addresses and writes to Mailchimp, so it sits behind its own shared password
 * (DASHBOARD_EMAIL_LISTS_PASSWORD); until this browser has typed it, only the password box shows.
 */
export default async function EmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const password = emailListsPassword();
  const jar = await cookies();
  const unlocked = listsTokenValid(jar.get(EMAIL_LISTS_COOKIE)?.value, password, new Date());
  const params = await searchParams;
  return (
    <>
      <h1 className="page-title">Email.</h1>
      <section className="card lists-card" id="lists" aria-label="Build an email list">
        <h2 className="card-title">Build an email list</h2>
        {unlocked ? (
          <>
            <EmailListsPanel />
            <form method="post" action="/api/email-lists/lock" className="lists-lock-out">
              <button type="submit" className="link-button">
                Lock the list builder on this device
              </button>
            </form>
          </>
        ) : password ? (
          <form method="post" action="/api/email-lists/unlock" className="finance-lock">
            <p className="card-sub">
              Describe a group of members, see who they are, and have a draft campaign waiting for them in Mailchimp. It shows member names
              and addresses, so it needs the list builder password.
            </p>
            {params.wrong === "1" && (
              <p className="status-error" role="alert">
                That password is not right. Check it and try again.
              </p>
            )}
            {params.locked === "1" && (
              <p className="finance-lock-note" role="status">
                The list builder is locked on this device.
              </p>
            )}
            <label htmlFor="lists-password">Password</label>
            <input id="lists-password" name="password" type="password" autoComplete="current-password" required className="search" />
            <button type="submit" className="link-button">
              Unlock
            </button>
            <p className="finance-lock-note">This device stays unlocked for {UNLOCK_DAYS} days.</p>
          </form>
        ) : (
          <div className="status-error" role="alert">
            <p>The list builder password has not been set up yet, so the list builder is locked for everyone.</p>
            <p>Add DASHBOARD_EMAIL_LISTS_PASSWORD (at least 8 characters) in the site&apos;s private settings in Vercel, then redeploy.</p>
          </div>
        )}
      </section>
      <h2 className="lists-figures-title">How the emails are doing</h2>
      <EmailSection />
    </>
  );
}
