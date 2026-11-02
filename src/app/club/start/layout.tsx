import { notFound } from "next/navigation";
import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";
import { requireClub } from "@/club/guard";

/**
 * The test landing page's frame: a plain header and the test-build banner, with none of the member menu (nobody is signed in
 * as anyone yet; this page is where you choose who to be). It sits beside (member) on purpose, like the iPad screens.
 * It is a test tool, so it hangs off the same switch as the "act as" picker and does not exist on the live site.
 */
export default async function StartLayout({ children }: { children: React.ReactNode }) {
  await requireClub();
  if (!pickerEnabled()) notFound();
  return (
    <>
      <header className="club-header">
        <div className="club-frame">
          <Link href="/club" className="club-wordmark">
            College Club Seattle
          </Link>
        </div>
      </header>
      <div className="club-frame">
        <p className="club-banner" role="note">
          Test build. Every household, member and booking here is invented. Nothing is connected to real club data.
        </p>
        <main>{children}</main>
      </div>
    </>
  );
}
