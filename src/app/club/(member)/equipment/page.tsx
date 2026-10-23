import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { affectedBookings, outOfServiceAt } from "@/club/engine/bookings";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDay, formatDayLong, formatRange, pacificDate } from "@/club/time";
import { idParam, NOTICES } from "@/club/web";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

/** Staff only: what is in service, and taking things out of service or back. A fuller staff screen comes in step 5. */
export default async function Equipment({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const periodId = idParam(params.affected);
  const period = periodId ? state.outOfService.find((p) => p.id === periodId) : undefined;
  const affected = period ? affectedBookings(state, period.itemId, new Date(period.from), period.until ? new Date(period.until) : null) : [];
  const notice = NOTICES[one(params.notice) ?? ""];

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

      <ul className="club-cards" aria-label="Equipment">
        {state.items.map((item) => {
          const out = outOfServiceAt(state, item.id, now);
          return (
            <li key={item.id} className="club-card" data-testid="equipment-row" data-item={item.name}>
              <h3>
                {item.name} <span className="club-meta">{classOf(RULE_BOOK, item).name}</span>
              </h3>
              {out ? (
                <>
                  <p data-testid="equipment-status">
                    <strong>Out of service</strong>: {out.reason}
                    {out.expectedReturn ? `, expected back ${formatDay(out.expectedReturn)}` : ""}
                  </p>
                  <form method="post" action="/api/club/equipment/return">
                    <input type="hidden" name="period" value={out.id} />
                    <button type="submit" className="club-button club-button-quiet" aria-label={`Return ${item.name} to service`}>
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
                      <input type="hidden" name="item" value={item.id} />
                      <p>
                        <label htmlFor={`reason-${item.id}`}>Why (members will see this)</label>
                        <input id={`reason-${item.id}`} name="reason" type="text" maxLength={200} required />
                      </p>
                      <p>
                        <label htmlFor={`back-${item.id}`}>Expected back (optional)</label>
                        <input id={`back-${item.id}`} name="expectedReturn" type="date" />
                      </p>
                      <button type="submit" className="club-button" aria-label={`Take ${item.name} out of service`}>
                        Take out of service
                      </button>
                    </form>
                  </details>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
