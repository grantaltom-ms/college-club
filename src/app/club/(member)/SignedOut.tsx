import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";

export function SignedOut() {
  return (
    <section className="club-empty">
      <h1>{pickerEnabled() ? "Choose a test member" : "Sign in"}</h1>
      <p className="club-lead">
        <Link href="/club/sign-in">Sign in</Link> with your email address to see this page.
      </p>
      <p className="club-actions">
        <Link href="/club/sign-in" className="club-button club-button-link">
          Email me a sign-in link
        </Link>
        {pickerEnabled() && (
          <Link href="/club/act-as" className="club-button club-button-quiet club-button-link">
            Choose a test member
          </Link>
        )}
      </p>
      {pickerEnabled() && (
        <p className="club-meta">Just trying it out? The test member picker lets you see the club the way they would.</p>
      )}
    </section>
  );
}
