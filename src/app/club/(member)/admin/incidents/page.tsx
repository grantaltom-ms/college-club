import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { incidentQueue } from "@/club/engine/incidents";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatMoment } from "@/club/time";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Staff only: every incident report. The open ones first (anyone hurt, then emergency services called, then the oldest), the closed
 * ones on a second list. Each report has its own page with the log and the buttons.
 */
export default async function IncidentQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const params = await searchParams;
  const closed = one(params.show) === "closed";
  const state = await (await getClubStore()).read();
  const now = clubNow();
  const open = incidentQueue(state, now, "open");
  const rows = closed ? incidentQueue(state, now, "closed") : open;
  const hurt = open.filter((r) => r.hurtCount > 0).length;

  return (
    <section>
      <h1>Incident reports</h1>
      <p>
        Staff and coaches file these when someone is hurt or something nearly goes wrong. Only staff read them all. <Link href="/club/admin">Back to the Staff office</Link> &middot; <Link href="/club/incidents">Report an incident</Link>
      </p>
      <p data-testid="incident-summary">
        {open.length === 0 ? "No incident report is open." : `${open.length} report${open.length === 1 ? " is" : "s are"} open${hurt > 0 ? `, ${hurt} with someone hurt` : ""}.`}
      </p>
      <nav aria-label="Which reports" className="club-chips">
        <Link href="/club/admin/incidents" aria-current={closed ? undefined : "page"}>
          Open
        </Link>
        <Link href="/club/admin/incidents?show=closed" aria-current={closed ? "page" : undefined}>
          Closed
        </Link>
      </nav>

      {rows.length === 0 ? (
        <p data-testid="no-incidents">{closed ? "Nothing has been closed yet." : "Nothing is open."}</p>
      ) : (
        <ul className="club-cards" aria-label={closed ? "Closed incident reports" : "Open incident reports"}>
          {rows.map((r) => (
            <li key={r.incidentId} className="club-card" data-testid="incident-row" data-status={r.status}>
              <h2>
                <Link href={`/club/admin/incidents/${r.incidentId}`}>{formatMoment(r.occurredAt)}</Link>
                {r.hurtCount > 0 && <span className="club-tag">{r.hurtCount === 1 ? "1 hurt" : `${r.hurtCount} hurt`}</span>}
                {r.emergencyCalled && <span className="club-tag">Emergency services called</span>}
              </h2>
              <p>{r.whatHappened}</p>
              <p className="club-meta">
                {r.statusWords}
                {r.location !== "" ? ` · ${r.location}` : ""}
                {r.boats.length > 0 ? ` · ${r.boats.join(", ")}` : ""} &middot; filed by {r.reporter}
                {r.followUpBy ? ` · ${r.followUpBy} is following up` : closed ? "" : " · nobody following up"}
                {!closed ? ` · open ${r.daysOpen} day${r.daysOpen === 1 ? "" : "s"}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
