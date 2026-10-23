import Link from "next/link";
import { cookies } from "next/headers";
import { getLoginDeps } from "@/club/auth/deps";
import { identityKey, type SignInIdentity } from "@/club/auth/identities";
import { LINK_PROBLEM_WORDS, previewSignIn, rememberedIdentity } from "@/club/auth/login";
import { clubNow } from "@/club/clock";
import { requireClub } from "@/club/guard";
import { REMEMBER_COOKIE } from "@/club/identity";

const describe = (i: SignInIdentity) => (i.kind === "staff" ? `${i.name} (club staff)` : i.name);

/**
 * Where a sign-in link lands. Looking at this page records nothing (email programs open links to check them); the person
 * presses a button to sign in. If the address is shared by partners, the page asks which of them this is, and offers the one
 * this device chose last time first. A link that does not work, for any reason, says the same thing.
 */
export default async function SignInLink({ params }: { params: Promise<{ token: string }> }) {
  await requireClub();
  const { token } = await params;
  const seen = await previewSignIn(await getLoginDeps(), { secret: token, now: clubNow() });

  if (!seen) {
    return (
      <section>
        <h1>Sign in</h1>
        <p className="club-alert" role="status" data-testid="link-problem">
          {LINK_PROBLEM_WORDS}
        </p>
        <p>
          <Link href="/club/sign-in" className="club-button">
            Get a new link
          </Link>
        </p>
      </section>
    );
  }

  const jar = await cookies();
  const remembered = rememberedIdentity(seen.identities, jar.get(REMEMBER_COOKIE)?.value);
  const others = seen.identities.filter((i) => !remembered || identityKey(i) !== identityKey(remembered));
  const several = seen.identities.length > 1;

  return (
    <section>
      <h1>{several && !remembered ? "Which of you?" : "Sign in"}</h1>
      <p>
        This link is for <strong>{seen.email}</strong>.
      </p>
      {several && !remembered && <p data-testid="which-of-you">More than one person is signed up with this address. Choose who you are.</p>}
      <form method="post" action="/api/club/sign-in/confirm" className="club-actions" data-testid="confirm-form">
        <input type="hidden" name="token" value={token} />
        {remembered && (
          <button type="submit" name="identity" value={identityKey(remembered)} className="club-button">
            Sign in as {describe(remembered)}
          </button>
        )}
        {remembered && others.length > 0 && <p className="club-meta">Not {remembered.name}?</p>}
        {others.map((i) => (
          <button key={identityKey(i)} type="submit" name="identity" value={identityKey(i)} className={remembered ? "club-button club-button-quiet" : "club-button"}>
            {remembered || several ? `I am ${describe(i)}` : `Sign in as ${describe(i)}`}
          </button>
        ))}
      </form>
    </section>
  );
}
