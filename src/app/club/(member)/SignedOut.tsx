import Link from "next/link";

export function SignedOut() {
  return (
    <section>
      <h1>Choose a test member</h1>
      <p>
        There are no real logins yet. <Link href="/club/act-as">Choose a test member</Link> to book as them.
      </p>
    </section>
  );
}
