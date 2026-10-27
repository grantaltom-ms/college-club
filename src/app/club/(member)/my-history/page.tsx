import Link from "next/link";
import { HISTORY_PAGE_SIZE, memberHistory } from "@/club/engine/history";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { getHistoryStore } from "@/club/store/history-instance";
import { formatDayLong, formatRange } from "@/club/time";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

/** A member's own bookings from the club's previous reservation system. A record only: nothing here can be changed, and no one else's name is shown. */
export default async function MyHistory({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  if (actor.kind === "staff") {
    return (
      <section>
        <h1>Old bookings</h1>
        <p>
          Staff look up old bookings by name in <Link href="/club/admin/history">the staff office</Link>.
        </p>
      </section>
    );
  }

  const params = await searchParams;
  const requested = Number(one(params.page));
  const members = (await (await getClubStore()).read()).members;
  const view = await memberHistory(await getHistoryStore(), members, actor.member.id, Number.isFinite(requested) ? requested : 1);

  return (
    <section>
      <h1>My old bookings</h1>
      <p>These are your bookings from the club&apos;s previous reservation system. They are a record only.</p>
      {!view.findable ? (
        <p data-testid="history-unfindable">We could not match your name to your old bookings with confidence, so none are shown here. Please ask club staff to look them up.</p>
      ) : view.total === 0 ? (
        <p data-testid="history-none">No old bookings were found under your name.</p>
      ) : (
        <>
          <p data-testid="history-count">
            {view.total.toLocaleString("en-US")} old booking{view.total === 1 ? "" : "s"}, newest first
            {view.pages > 1 ? ` (page ${view.page} of ${view.pages}, ${HISTORY_PAGE_SIZE} to a page)` : ""}.
          </p>
          <ul className="club-cards" aria-label="Your old bookings">
            {view.items.map((i) => (
              <li key={i.id} className="club-card" data-testid="history-row" data-item={i.itemName}>
                <h3>{i.itemName}</h3>
                <p>
                  {formatDayLong(i.day)}, {formatRange(i.startsAt, i.endsAt)}
                </p>
                <p className="club-meta">
                  {i.itemType} &middot; {i.role}
                  {i.others > 0 ? ` · with ${i.others} other${i.others === 1 ? "" : "s"}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <p className="club-meta">
            {view.page > 1 && (
              <Link href={`/club/my-history?page=${view.page - 1}`} data-testid="history-newer">
                Newer
              </Link>
            )}
            {view.page > 1 && view.page < view.pages && " · "}
            {view.page < view.pages && (
              <Link href={`/club/my-history?page=${view.page + 1}`} data-testid="history-older">
                Older
              </Link>
            )}
          </p>
        </>
      )}
      <p className="club-meta">
        <Link href="/club/my-bookings">Back to My bookings</Link>
      </p>
    </section>
  );
}
