import Link from "next/link";
import { getMailer } from "@/club/auth/mail";
import { Logo, Eyebrow, LaneLine } from "@/components/ds/Pieces";
import { outboxEnabled, pickerEnabled } from "@/club/enabled";
import { fullName } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { LOGIN_RULES } from "@/club/settings/login-rules";
import { NOTICES } from "@/club/web";
import { SITE, phoneHref } from "@/site/content";
import { PUBLIC_SITE_URL } from "@/site/links";
import { HomeScreenCard } from "./HomeScreenCard";
import { SignInForm } from "./SignInForm";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Where anyone signs in: type the email address, get a one-time link. Nothing here ever says whether an address belongs to
 * a member; the answer is the same for everyone. Opens to people who are not signed in (that is the point of it). There is no
 * password: the link is the key.
 */
export default async function SignIn({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  const query = await searchParams;
  const notice = NOTICES[one(query.notice)];
  const minutes = LOGIN_RULES.defaults.linkMinutes;
  const emailOn = getMailer() !== null;
  const { club } = SITE;

  return (
    <>
      <header className="ds-app-band ds-dark">
        <div className="ds-app-inner">
          <Logo tone="white" size={48} />
          <Eyebrow tone="sun">Members</Eyebrow>
          <h1>Welcome back.</h1>
          <p className="ds-app-lead">Your calendar, classes, account and the Weekly Watercooler, all in one place.</p>
        </div>
      </header>
      <main className="ds-app-body">
        <div className="ds-app-inner">
          {actor?.source === "login" ? (
            <>
              <p className="ds-status" data-testid="already-signed-in">
                You are signed in as {actor.kind === "staff" ? actor.label : fullName(actor.member)}.
              </p>
              <p>
                <Link href="/club" className="ds-button ds-button-large">
                  Go to the club
                </Link>
              </p>
              <form method="post" action="/api/club/sign-out">
                <button type="submit" className="ds-button ds-button-outline ds-button-large">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="ds-app-intro">Type the email address the club has for you. We will email you a link that signs you in. There is no password to remember.</p>
              {one(query.out) && (
                <p className="ds-status" role="status" data-testid="signed-out-note">
                  You are signed out.
                </p>
              )}
              {one(query.sent) && (
                <p className="ds-status" role="status" data-testid="link-sent">
                  If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in {minutes} minutes. If it does not arrive, check your spam folder.
                </p>
              )}
              {one(query.sent) && outboxEnabled() && (
                <p className="ds-hint" data-testid="test-outbox-note">
                  Test build: no real email is sent. <Link href="/club/outbox">Open the test outbox</Link> to see it.
                </p>
              )}
              {notice && (
                <p className="club-alert" role="alert">
                  {notice}
                </p>
              )}
              {emailOn ? (
                <SignInForm />
              ) : (
                <p className="club-alert" role="status" data-testid="sign-in-off">
                  Email sign-in is not switched on yet.
                </p>
              )}
              <details className="ds-details" data-testid="first-time">
                <summary>First time here?</summary>
                <p>
                  The club office sets up each household, so there is nothing to sign up for. Email <a href={`mailto:${club.email}`}>{club.email}</a> or call <a href={phoneHref(club.phone)}>{club.phone}</a>, and we will get you on the list.
                </p>
              </details>
              {pickerEnabled() && (
                <p className="ds-hint">
                  Just trying it out? <Link href="/club/act-as">Choose a test member</Link> instead.
                </p>
              )}
            </>
          )}
          <LaneLine contained={false} />
          <HomeScreenCard />
          <a href={PUBLIC_SITE_URL} className="ds-back" data-track="back-to-public-site">
            <span aria-hidden="true">←</span> Back to collegeclubseattle.com
          </a>
        </div>
      </main>
    </>
  );
}
