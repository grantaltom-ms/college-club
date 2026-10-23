import Link from "next/link";
import { getMailer } from "@/club/auth/mail";
import { outboxEnabled, pickerEnabled } from "@/club/enabled";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { LOGIN_RULES } from "@/club/settings/login-rules";
import { NOTICES } from "@/club/web";
import { fullName } from "@/club/engine/queries";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Where anyone signs in: type the email address, get a one-time link. Nothing here ever says whether an address belongs to
 * a member; the answer is the same for everyone. Opens to people who are not signed in (that is the point of it).
 */
export default async function SignIn({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  const query = await searchParams;
  const notice = NOTICES[one(query.notice)];
  const minutes = LOGIN_RULES.defaults.linkMinutes;
  const emailOn = getMailer() !== null;

  if (actor?.source === "login") {
    const name = actor.kind === "staff" ? actor.label : fullName(actor.member);
    return (
      <section>
        <h1>Sign in</h1>
        <p data-testid="already-signed-in">You are signed in as {name}.</p>
        <form method="post" action="/api/club/sign-out">
          <button type="submit" className="club-button club-button-quiet">
            Sign out
          </button>
        </form>
      </section>
    );
  }

  return (
    <section>
      <h1>Sign in</h1>
      <p>Type the email address the club has for you. We will email you a link that signs you in. There is no password to remember.</p>
      {one(query.out) && (
        <p className="club-success" role="status" data-testid="signed-out-note">
          You are signed out.
        </p>
      )}
      {one(query.sent) && (
        <p className="club-success" role="status" data-testid="link-sent">
          If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in {minutes} minutes. If it does not arrive, check your spam folder.
        </p>
      )}
      {one(query.sent) && outboxEnabled() && (
        <p className="club-meta" data-testid="test-outbox-note">
          Test build: no real email is sent. <Link href="/club/outbox">Open the test outbox</Link> to see it.
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {emailOn ? (
        <form method="post" action="/api/club/sign-in/request" className="club-form" data-testid="sign-in-form">
          <p>
            <label htmlFor="email">Your email address</label>
            <input id="email" name="email" type="email" maxLength={254} autoComplete="email" required />
          </p>
          <p>
            <button type="submit" className="club-button">
              Email me a sign-in link
            </button>
          </p>
        </form>
      ) : (
        <p className="club-alert" role="status" data-testid="sign-in-off">
          Email sign-in is not switched on yet.
        </p>
      )}
      {pickerEnabled() && (
        <p className="club-meta">
          Just trying it out? <Link href="/club/act-as">Choose a test member</Link> instead.
        </p>
      )}
    </section>
  );
}
