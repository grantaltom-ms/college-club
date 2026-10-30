import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { canRunPractices, practiceList } from "@/club/engine/practices";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { SignedOut } from "../SignedOut";
import { whenWords } from "./words";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Coaches and staff: the practices still to come and the ones that are over or cancelled. A practice is a coached or organized
 * rowing session that reserves its boats and holds a lineup. Anyone else gets "page not found" (members seated in a practice see it
 * on My practices).
 */
export default async function PracticesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const me = toEngineActor(actor);
  const state = await (await getClubStore()).read();
  if (!canRunPractices(state, me)) notFound();
  const past = one((await searchParams).show) === "past";
  const rows = practiceList(state, RULE_BOOK, me, clubNow(), past ? "past" : "upcoming");

  return (
    <section>
      <h1>Practices</h1>
      <p>
        A practice is a coached or organized rowing session. It reserves its boats while it runs and holds the lineup: who sits where. Ordinary bookings never need one.{" "}
        <Link href="/club/practices/new" data-testid="new-practice-link">
          Set up a practice
        </Link>
      </p>
      <nav aria-label="Which practices" className="club-chips">
        <Link href="/club/practices" aria-current={past ? undefined : "page"}>
          Coming up
        </Link>
        <Link href="/club/practices?show=past" aria-current={past ? "page" : undefined}>
          Past and cancelled
        </Link>
      </nav>

      {rows.length === 0 ? (
        <p data-testid="no-practices">{past ? "No past or cancelled practices yet." : "No practices are set up."}</p>
      ) : (
        <ul className="club-cards" aria-label={past ? "Past and cancelled practices" : "Practices coming up"}>
          {rows.map((r) => (
            <li key={r.id} className="club-card" data-testid="practice-card" data-practice={r.name} data-status={r.status}>
              <h2>
                <Link href={`/club/practices/${r.id}`}>{r.name}</Link>
                {r.status === "cancelled" && <span className="club-tag">Cancelled</span>}
              </h2>
              <p>{whenWords(r.startsAt, r.endsAt)}</p>
              <p className="club-meta">
                Run by {r.coachName} &middot; {r.boats === 0 ? "no boats yet" : `${r.boats} boat${r.boats === 1 ? "" : "s"}`} &middot; {r.seated} of {r.seatsTotal} seats filled
              </p>
              {r.clashes > 0 && r.status === "scheduled" && (
                <p className="club-alert" role="note" data-testid="practice-clashes">
                  {r.clashes} booking{r.clashes === 1 ? "" : "s"} already made on its boats overlap{r.clashes === 1 ? "s" : ""} it.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
