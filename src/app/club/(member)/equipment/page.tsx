import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { affectedBookings } from "@/club/engine/bookings";
import { equipmentList, type EquipmentLine } from "@/club/engine/equipment-edit";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatDayLong, formatMoment, formatRange, pacificDate } from "@/club/time";
import { idParam, NOTICES } from "@/club/web";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What kind of thing an item is, in one line: "Shell · Double, 2 seats", "Dock space · pool of 60 places". */
function describe(l: EquipmentLine): string {
  const size = l.pool ? `pool of ${plural(l.places, "place")}` : plural(l.seats, "seat");
  return `${l.type} · ${l.className}, ${size}${l.isPrivate ? " · private boat" : ""}`;
}

/**
 * Staff only: what is in service, taking things out of service or back, and a way into each item to fix it or retire it. The find
 * box narrows the list by the first letters of any word of a name; retired items are kept apart, below.
 */
export default async function Equipment({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const find = (one(params.find) ?? "").slice(0, 80);
  const list = equipmentList(state, RULE_BOOK, now, find);
  const periodId = idParam(params.affected);
  const period = periodId ? state.outOfService.find((p) => p.id === periodId) : undefined;
  const affected = period ? affectedBookings(state, period.itemId, new Date(period.from), period.until ? new Date(period.until) : null) : [];
  const notice = NOTICES[one(params.notice) ?? ""];
  const shown = list.active.length + list.retired.length;

  return (
    <section>
      <h1>Equipment</h1>
      <p className="club-meta">Taking something out of service stops new bookings. Bookings already made are kept; you will see who to contact.</p>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {one(params.returned) && (
        <p className="club-success" role="status">
          Back in service. New bookings are allowed again.
        </p>
      )}
      {period && (
        <div className="club-card" role="status" data-testid="affected">
          <h2>{state.items.find((i) => i.id === period.itemId)?.name} is now out of service</h2>
          {affected.length === 0 ? (
            <p>No existing bookings are affected.</p>
          ) : (
            <>
              <p>
                {affected.length} existing booking{affected.length === 1 ? " is" : "s are"} affected. Nothing was cancelled; please contact:
              </p>
              <ul>
                {affected.map((a) => (
                  <li key={a.bookingId} data-testid="affected-booking">
                    {formatDayLong(pacificDate(new Date(a.startsAt)))}, {formatRange(a.startsAt, a.endsAt)}:{" "}
                    {a.people.map((p) => `${p.name} (${p.role}, ${p.email}, ${p.phone})`).join("; ")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <form method="get" action="/club/equipment" className="club-form" role="search" data-testid="equipment-find">
        <p>
          <label htmlFor="equipment-find-box">Find by name</label>
          <input id="equipment-find-box" name="find" type="search" defaultValue={find} maxLength={80} autoComplete="off" />
        </p>
        <p>
          <button type="submit" className="club-button club-button-quiet">
            Find
          </button>
          {find !== "" && (
            <>
              {" "}
              <Link href="/club/equipment">Show everything</Link>
            </>
          )}
        </p>
      </form>
      <p className="club-meta" data-testid="equipment-count">
        {find === "" ? `${plural(list.total, "item")}.` : `Showing ${shown} of ${plural(list.total, "item")}.`}
      </p>
      {find !== "" && shown === 0 && <p>Nothing has a name starting that way.</p>}

      <ul className="club-cards" aria-label="Equipment">
        {list.active.map((l) => (
          <li key={l.itemId} className="club-card" data-testid="equipment-row" data-item={l.name}>
            <h3>
              {l.name} <span className="club-meta">{l.className}</span>
            </h3>
            <p className="club-meta" data-testid="equipment-kind">
              {describe(l)}
            </p>
            {l.out ? (
              <>
                <p data-testid="equipment-status">
                  <strong>Out of service</strong>: {l.out.reason}
                  {l.out.expectedReturn ? `, expected back ${formatDay(l.out.expectedReturn)}` : ""}
                </p>
                <form method="post" action="/api/club/equipment/return">
                  <input type="hidden" name="period" value={l.out.periodId} />
                  <button type="submit" className="club-button club-button-quiet" aria-label={`Return ${l.name} to service`}>
                    Return to service
                  </button>
                </form>
              </>
            ) : (
              <>
                <p data-testid="equipment-status">In service</p>
                <details>
                  <summary>Take out of service</summary>
                  <form method="post" action="/api/club/equipment/out-of-service" className="club-form">
                    <input type="hidden" name="item" value={l.itemId} />
                    <p>
                      <label htmlFor={`reason-${l.itemId}`}>Why (members will see this)</label>
                      <input id={`reason-${l.itemId}`} name="reason" type="text" maxLength={200} required />
                    </p>
                    <p>
                      <label htmlFor={`back-${l.itemId}`}>Expected back (optional)</label>
                      <input id={`back-${l.itemId}`} name="expectedReturn" type="date" />
                    </p>
                    <button type="submit" className="club-button" aria-label={`Take ${l.name} out of service`}>
                      Take out of service
                    </button>
                  </form>
                </details>
              </>
            )}
            <p>
              <Link href={`/club/equipment/${l.itemId}`} aria-label={`Edit or retire ${l.name}`} data-testid="equipment-edit-link">
                Edit or retire
              </Link>
            </p>
          </li>
        ))}
      </ul>

      {list.retired.length > 0 && (
        <details data-testid="equipment-retired" open={find !== ""}>
          <summary>{plural(list.retired.length, "retired item")}</summary>
          <ul className="club-cards" aria-label="Retired equipment">
            {list.retired.map((l) => (
              <li key={l.itemId} className="club-card" data-testid="retired-row" data-item={l.name}>
                <h3>
                  {l.name} <span className="club-meta">{l.className}</span>
                </h3>
                <p className="club-meta">{describe(l)}</p>
                <p data-testid="retired-status">
                  Retired {l.retired ? formatMoment(l.retired.at) : ""} by {l.retired?.by}: {l.retired?.reason}
                </p>
                {l.upcoming > 0 && (
                  <p className="club-meta" data-testid="retired-upcoming">
                    {plural(l.upcoming, "upcoming booking")} still on it.
                  </p>
                )}
                <p>
                  <Link href={`/club/equipment/${l.itemId}`} aria-label={`Open retired ${l.name}`}>
                    Open, to rename or bring back
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
