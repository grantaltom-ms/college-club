import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { damageQueue, PRIORITY_WORDS } from "@/club/engine/damage";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay, pacificDate } from "@/club/time";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Staff only: every damage report, the ones still to fix first (major, then the most urgent, then the oldest), and the closed ones
 * on a second list. Each report has its own page with the log and the buttons.
 */
export default async function DamageQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const params = await searchParams;
  const closed = one(params.show) === "closed";
  const state = await (await getClubStore()).read();
  const now = clubNow();
  const open = damageQueue(state, now, "open");
  const rows = closed ? damageQueue(state, now, "closed") : open;
  const major = open.filter((r) => r.major).length;

  return (
    <section>
      <h1>Damage reports</h1>
      <p>
        Anyone signed in can report damage on a boat or space. A report marked major does not close the boat by itself: open it and press &ldquo;Take out of service&rdquo; if it should be. <Link href="/club/admin">Back to the Staff office</Link> &middot; <Link href="/club/damage">Report damage</Link>
      </p>
      <p data-testid="damage-summary">
        {open.length === 0 ? "Nothing is waiting to be fixed." : `${open.length} report${open.length === 1 ? " is" : "s are"} waiting to be fixed${major > 0 ? `, ${major} marked major` : ""}.`}
      </p>
      <nav aria-label="Which reports" className="club-chips">
        <Link href="/club/admin/damage" aria-current={closed ? undefined : "page"}>
          To fix
        </Link>
        <Link href="/club/admin/damage?show=closed" aria-current={closed ? "page" : undefined}>
          Closed
        </Link>
      </nav>

      {rows.length === 0 ? (
        <p data-testid="no-damage">{closed ? "Nothing has been closed yet." : "Nothing to fix."}</p>
      ) : (
        <ul className="club-cards" aria-label={closed ? "Closed damage reports" : "Damage reports to fix"}>
          {rows.map((r) => (
            <li key={r.reportId} className="club-card" data-testid="damage-row" data-item={r.itemName} data-status={r.status}>
              <h2>
                <Link href={`/club/admin/damage/${r.reportId}`}>{r.itemName}</Link>
                {r.major && <span className="club-tag">Major</span>}
                {r.outOfService && !closed && <span className="club-tag">Out of service</span>}
              </h2>
              <p>{r.description}</p>
              <p className="club-meta">
                {r.statusWords}
                {!closed ? ` · priority ${r.priority} (${PRIORITY_WORDS[r.priority].toLowerCase()})` : ""} &middot; reported {formatDay(pacificDate(new Date(r.reportedAt)))} by {r.reporter}
                {r.assignedTo ? ` · ${r.assignedTo} is on it` : closed ? "" : " · nobody assigned"}
                {!closed ? ` · open ${r.daysOpen} day${r.daysOpen === 1 ? "" : "s"}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
