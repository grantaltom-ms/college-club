import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ipadCode, ipadPath, snackCode, snackPath } from "@/club/engine/ipad-address";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getIpadSecret } from "@/club/ipad-secret";
import { SignedOut } from "../../SignedOut";

/**
 * Staff only: the front-desk iPad's private address. Open it once on the iPad and add it to the Home Screen. Anyone with the
 * address can use the iPad screens (check in, nothing else), so it is shown here and nowhere else. Changing the iPad secret
 * switches the old address off.
 */
export default async function IpadSetup() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const secret = getIpadSecret();
  const asked = await headers();
  const host = asked.get("x-forwarded-host") ?? asked.get("host") ?? "";
  const proto = asked.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const path = secret ? ipadPath(ipadCode(secret)) : null;
  const snackAddress = secret ? snackPath(snackCode(secret)) : null;
  const permanent = !!process.env.CLUB_IPAD_SECRET;

  return (
    <section>
      <h1>Front-desk iPad</h1>
      <p>Members check themselves in on this screen: they type the first letters of their name, tap it, and tap &ldquo;I&apos;m here&rdquo;.</p>
      {path === null ? (
        <p className="club-alert" role="status" data-testid="ipad-off">
          The iPad is switched off on this site, because no iPad secret has been set. Set CLUB_IPAD_SECRET (at least 16 random characters) where this site is run, then come back here for the address.
        </p>
      ) : (
        <>
          <h2>The address</h2>
          <p>
            <a href={path} data-testid="ipad-link">
              Open the iPad screen
            </a>
          </p>
          <p>
            <code data-testid="ipad-address">{host ? `${proto}://${host}${path}` : path}</code>
          </p>
          {!permanent && (
            <p className="club-placeholder" data-testid="ipad-temporary">
              <strong>Temporary address.</strong> No CLUB_IPAD_SECRET is set, so this run made one up. It stops working when the server restarts.
            </p>
          )}
          <h2>Setting it up</h2>
          <ol>
            <li>On the iPad, open the address above in Safari.</li>
            <li>Tap Share, then &ldquo;Add to Home Screen&rdquo;, so it opens in one tap.</li>
            <li>Leave it on the start screen. It goes back to the start by itself a few seconds after anyone checks in.</li>
          </ol>
          <h2>What the iPad shows, and what it does not</h2>
          <ul className="club-list" data-testid="ipad-facts">
            <li>Only people who have a boat, space or class they can check in for right now. Not the whole membership.</li>
            <li>Nothing else: no bookings list, no member details, no menu. Events are checked off by staff.</li>
            <li>Every check-in is on the record as &ldquo;on the iPad&rdquo;, and staff can correct any of them.</li>
          </ul>
          <h2>If the address gets out</h2>
          <p>
            Anyone who has the address can use the iPad screens. If it leaks, change CLUB_IPAD_SECRET where this site is run: the old address stops working at once and this page shows the new one.
          </p>
          {snackAddress && (
            <>
              <h2>The honor snack bar iPad</h2>
              <p>
                The snack bar has its own address, so it can sit on its own iPad. A member types their name, says how many snacks they took, and taps once: it goes on their household&apos;s account for the month, and the screen goes back to its start for the next person.
              </p>
              <p>
                <a href={snackAddress} data-testid="snack-link">
                  Open the snack bar screen
                </a>
              </p>
              <p>
                <code data-testid="snack-address">{host ? `${proto}://${host}${snackAddress}` : snackAddress}</code>
              </p>
              <ol>
                <li>On the snack bar iPad, open the address above in Safari and tap Share, then &ldquo;Add to Home Screen&rdquo;.</li>
                <li>Leave it on the start screen. It goes back there by itself after every purchase, and after a quiet spell.</li>
                <li>
                  Every purchase is on the <a href="/club/admin/charges">Charges</a> screen as &ldquo;entered on the snack bar iPad&rdquo;. A wrong one is voided there, with a reason.
                </li>
              </ol>
              <p>Changing CLUB_IPAD_SECRET switches off this address too, and this page shows the new one. It is a different address from the check-in iPad, so one leaking does not open the other.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
