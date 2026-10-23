import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";

export function SignedOut() {
  return (
    <section>
      <h1>{pickerEnabled() ? "Choose a test member" : "Sign in"}</h1>
      <p>
        <Link href="/club/sign-in">Sign in</Link> with your email address to see this page.
      </p>
      {pickerEnabled() && (
        <p>
          Just trying it out? <Link href="/club/act-as">Choose a test member</Link> to see the club the way they would.
        </p>
      )}
    </section>
  );
}
