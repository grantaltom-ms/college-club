import type { RetireEffects } from "@/club/engine/equipment-edit";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const when = (startsAt: string, endsAt: string) => `${formatDayLong(pacificDate(new Date(startsAt)))}, ${formatRange(startsAt, endsAt)}`;

/**
 * Everything that still reaches an item and has not finished: upcoming bookings (with the people to contact), classes that hold the
 * room, and practices that reserve the boat. Retiring never cancels any of it, so staff read this to know who to tell.
 */
export function LeftInPlace({ effects, heading }: { effects: RetireEffects; heading: string }) {
  const { bookings, sessions, practices } = effects;
  const total = bookings.length + sessions.length + practices.length;
  return (
    <div data-testid="left-in-place" data-count={total}>
      <h3>{heading}</h3>
      {total === 0 ? (
        <p>Nothing is booked, scheduled or reserved on it.</p>
      ) : (
        <>
          <p>
            {plural(total, "thing")} reach{total === 1 ? "es" : ""} it. Nothing is cancelled for you; contact the people, and cancel on the All bookings, Classes or Practices screens if needed.
          </p>
          {bookings.length > 0 && (
            <>
              <h4>{plural(bookings.length, "upcoming booking")}</h4>
              <ul className="club-list">
                {bookings.map((b) => (
                  <li key={b.bookingId} data-testid="left-booking">
                    {when(b.startsAt, b.endsAt)}: {b.people.map((p) => `${p.name} (${p.role}, ${p.email}, ${p.phone})`).join("; ")}
                  </li>
                ))}
              </ul>
            </>
          )}
          {sessions.length > 0 && (
            <>
              <h4>{plural(sessions.length, "scheduled class", "scheduled classes")} in this room</h4>
              <ul className="club-list">
                {sessions.map((x) => (
                  <li key={x.id} data-testid="left-session">
                    {x.title}, {when(x.startsAt, x.endsAt)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {practices.length > 0 && (
            <>
              <h4>{plural(practices.length, "scheduled practice")} that reserve this boat</h4>
              <ul className="club-list">
                {practices.map((x) => (
                  <li key={x.id} data-testid="left-practice">
                    {x.name}, {when(x.startsAt, x.endsAt)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
