import Link from "next/link";
import { dayView, pickableDays, type SlotView } from "@/club/engine/availability";
import { itemVisibleTo } from "@/club/engine/boat-access";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { clubNow } from "@/club/clock";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatClock, formatDay, formatDayLong, formatRange, pacificDate, weekdayName } from "@/club/time";
import { BOOKING_TYPES } from "@/club/types";
import { bookingFormHref, dayParam, typeParam } from "@/club/web";
import { blockedReason, viewerOf } from "@/club/web-actor";
import { PlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";

const SLOT_WORDS: Record<SlotView["state"], string> = {
  free: "Free",
  booked: "Booked",
  yours: "Yours",
  class: "Class",
  out_of_service: "Out of service",
  past: "Past",
  not_open: "Not open yet",
};

const shortDay = (day: string) => `${weekdayName(day).slice(0, 3)} ${formatDay(day).replace(/, \d{4}$/, "")}`;

export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const days = pickableDays(state, RULE_BOOK, now);
  const day = dayParam(params.day, days, days[0]);
  const viewer = viewerOf(actor);
  const present = new Set(state.items.filter((i) => itemVisibleTo(state, i, viewer)).map((i) => classOf(RULE_BOOK, i).type));
  const types = BOOKING_TYPES.filter((t) => present.has(t));
  const type = typeParam(params.type);
  const view = dayView(state, RULE_BOOK, { day, now, viewer, type: type && present.has(type) ? type : null });
  const blocked = blockedReason(actor);
  const href = (d: string, t: string | null) => `/club/book?day=${d}${t ? `&type=${encodeURIComponent(t)}` : ""}`;
  const today = pacificDate(now);

  return (
    <section>
      <h1>Book a boat or space</h1>
      <PlaceholderNote />
      {blocked && (
        <p className="club-alert" role="alert" data-testid="blocked-note">
          You cannot make new bookings. {blocked}
        </p>
      )}

      {actor.kind === "member" && state.boatAccess.some((a) => a.memberId === actor.member.id && a.endedAt === null) && (
        <p className="club-meta" data-testid="my-boats-link">
          You can use private boats. <Link href="/club/my-boats">My boats</Link>
        </p>
      )}

      <nav aria-label="Pick a day" className="club-chips">
        {days.map((d) => (
          <Link key={d} href={href(d, type)} aria-current={d === day ? "page" : undefined}>
            {d === today ? "Today" : shortDay(d)}
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by type" className="club-chips">
        <Link href={href(day, null)} aria-current={type ? undefined : "page"}>
          All
        </Link>
        {types.map((t) => (
          <Link key={t} href={href(day, t)} aria-current={t === type ? "page" : undefined}>
            {t}
          </Link>
        ))}
      </nav>

      <h2 data-testid="day-heading">{formatDayLong(day)}</h2>
      <ul className="club-legend" aria-label="Legend">
        {(["free", "booked", "yours", "class", "out_of_service", "past"] as const).map((s) => (
          <li key={s}>
            <span className={`slot slot-${s}`} aria-hidden="true" /> {SLOT_WORDS[s]}
          </li>
        ))}
      </ul>

      {view.items.length === 0 && <p>Nothing of that type is set up yet.</p>}
      <div className="club-cards">
        {view.items.map((item) => (
          <article key={item.item.id} className="club-card" aria-label={item.item.name} data-testid="item-card" data-item={item.item.name}>
            <h3>
              {item.item.name} <span className="club-meta">{item.className}</span>
              {item.isPrivate && <span className="club-tag">Private</span>}
            </h3>
            <p className="club-meta">
              {item.type}
              {item.seats > 1 ? ` · ${item.seats} seats` : ""}
              {item.places > 1 ? ` · ${item.places} places` : ""}
              {item.needs ? ` · needs ${item.needs}` : ""}
            </p>
            {item.qualified === false && <p className="club-meta">You do not hold that qualification yet, so you cannot book this one.</p>}
            {item.note && <p className="club-meta">{item.note}</p>}
            {item.locked && (
              <p className="club-meta" data-testid="boat-locked-note">
                Locked: this private boat has no owner right now, so it cannot be booked until club staff add one.
              </p>
            )}
            <ol className="slots">
              {item.slots.map((slot) => {
                const counted = slot.placesLeft !== null && !slot.heldFor && (slot.state === "free" || slot.state === "booked" || slot.state === "yours");
                const words = slot.heldFor ? `${slot.heldFor} class` : counted && slot.state !== "yours" ? `${slot.placesLeft} of ${item.places} places left` : SLOT_WORDS[slot.state].toLowerCase();
                const label = `${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, ${words}`;
                return (
                  <li key={slot.startsAt}>
                    {slot.state === "free" && !item.locked ? (
                      <Link className="slot slot-free" href={bookingFormHref({ itemId: item.item.id, start: slot.startsAt })} aria-label={label}>
                        {formatClock(slot.startsAt)}
                        {slot.placesLeft !== null && <small>{slot.placesLeft} left</small>}
                      </Link>
                    ) : (
                      <span className={`slot slot-${slot.state}`} aria-label={label} data-state={slot.state} title={slot.holders.length > 0 ? slot.holders.join(", ") : undefined}>
                        {formatClock(slot.startsAt)}
                        <small>{slot.bookedBy ?? slot.heldFor ?? (slot.state === "past" ? "" : slot.state === "booked" && slot.placesLeft !== null ? "Full" : SLOT_WORDS[slot.state])}</small>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
