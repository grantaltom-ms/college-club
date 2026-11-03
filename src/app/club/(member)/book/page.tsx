import Link from "next/link";
import { dayView, pickableDays, type SlotView } from "@/club/engine/availability";
import { itemVisibleTo } from "@/club/engine/boat-access";
import { noticeWords, openDamageNotices } from "@/club/engine/damage";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { clubNow } from "@/club/clock";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { readClubOnce } from "@/club/store/read-once";
import { formatClock, formatDay, formatDayLong, formatRange, pacificDate, weekdayName } from "@/club/time";
import { bookingFormHref, pickDay, typeParam } from "@/club/web";
import {
  browseById,
  browseFromType,
  itemMatchesBrowse,
  shellKindById,
  visibleBrowse,
  SHELL_KINDS,
  type BookBrowse,
} from "@/club/web-book";
import { blockedReason, viewerOf } from "@/club/web-actor";
import { PlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";

const SLOT_WORDS: Record<SlotView["state"], string> = {
  free: "Free",
  booked: "Booked",
  yours: "Yours",
  class: "Class",
  practice: "Practice",
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
  const state = await readClubOnce();
  const params = await searchParams;
  const days = pickableDays(state, RULE_BOOK, now);
  const { day, note: dayNote } = pickDay(params.day, days);
  const viewer = viewerOf(actor);
  const askedType = typeParam(params.type);
  const whatRaw = first(params.what);
  const kindRaw = first(params.kind);

  const options = visibleBrowse(state, RULE_BOOK, now, (i) => itemVisibleTo(state, i, viewer));
  // Prefer an explicit what=; else map a legacy type= so deep links and tests still open the grid.
  const browse = (whatRaw ? browseById(whatRaw) : null) ?? browseFromType(askedType);
  // Deep links (what= or type=) still open even when a seasonal category is hidden from the chooser (dock in winter).
  const browseLive = browse && (options.some((o) => o.id === browse.id) || Boolean(whatRaw || askedType)) ? browse : null;
  // Shell size is required on the new what=shell path; a legacy type=Shell link still shows every shell.
  const needsKind = Boolean(browseLive && "kinds" in browseLive && browseLive.kinds && !askedType);
  const kind = shellKindById(kindRaw);
  // Ready to show times only after the person has named what (and, for shells on the new path, which size).
  const ready = Boolean(browseLive && (!needsKind || kind));

  const typeFilter = askedType && browseLive?.types.length === 1 ? askedType : browseLive?.types.length === 1 ? browseLive.types[0] : null;
  const view = ready
    ? dayView(state, RULE_BOOK, { day, now, viewer, type: typeFilter && browseLive!.types.includes(typeFilter as never) ? typeFilter : null })
    : { day, items: [] };
  const items = ready
    ? view.items.filter((row) => itemMatchesBrowse(RULE_BOOK, row.item, browseLive!, kind)).filter((row) => {
        // When a legacy type= narrows paddle craft to one kind, honour it.
        if (!askedType || browseLive!.types.length === 1) return true;
        return classOf(RULE_BOOK, row.item).type === askedType;
      })
    : [];

  const blocked = blockedReason(actor);
  const today = pacificDate(now);
  const href = (opts: { day?: string; what?: string | null; kind?: string | null }) => {
    const d = opts.day ?? day;
    const w = opts.what === undefined ? browseLive?.id ?? null : opts.what;
    const k = opts.kind === undefined ? (needsKind ? kind?.id ?? null : null) : opts.kind;
    const q = new URLSearchParams();
    q.set("day", d);
    if (w) q.set("what", w);
    if (k) q.set("kind", k);
    return `/club/book?${q.toString()}`;
  };

  return (
    <section className="club-book">
      <header className="club-launch-head">
        <p className="club-kicker">Book</p>
        <h1>Reservations</h1>
        <p className="club-lead">{ready ? "Tap a free time." : needsKind && browseLive ? "Which size of shell?" : "What would you like to reserve?"}</p>
      </header>
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

      {dayNote && (
        <p className="club-alert" role="status" data-testid="day-note">
          {dayNote}
        </p>
      )}

      {!browseLive && (
        <nav aria-label="What to reserve" className="club-book-choose" data-testid="book-choose">
          {options.map((b) => (
            <Link key={b.id} href={href({ what: b.id, kind: null })} className="club-book-choose-card" data-browse={b.id}>
              <span className="club-book-choose-label">{b.label}</span>
              <span className="club-book-choose-hint">{chooseHint(b)}</span>
            </Link>
          ))}
        </nav>
      )}

      {browseLive && needsKind && !kind && (
        <>
          <p className="club-back">
            <Link href="/club/book">All categories</Link>
          </p>
          <nav aria-label="Shell size" className="club-book-choose club-book-choose-kinds" data-testid="shell-kinds">
            {SHELL_KINDS.map((k) => (
              <Link key={k.id} href={href({ what: "shell", kind: k.id })} className="club-book-choose-card" data-kind={k.id}>
                <span className="club-book-choose-label">{k.label}</span>
                <span className="club-book-choose-hint">{k.seats === 1 ? "One seat" : `${k.seats} seats`}</span>
              </Link>
            ))}
          </nav>
        </>
      )}

      {ready && browseLive && (
        <>
          <div className="club-book-context">
            <p className="club-back">
              <Link href={needsKind ? href({ what: "shell", kind: null }) : "/club/book"}>{needsKind ? "Change shell size" : "All categories"}</Link>
            </p>
            <p className="club-book-context-label" data-testid="browse-label">
              {browseLive.label}
              {kind ? ` · ${kind.label}` : ""}
            </p>
          </div>

          <div className="club-book-day">
            <div className="club-book-day-now">
              <p className="club-book-day-label">{day === today ? "Today" : shortDay(day)}</p>
              <p className="club-book-day-long" data-testid="day-heading">
                {formatDayLong(day)}
              </p>
            </div>
            <details className="club-book-day-more" open={Boolean(dayNote) || day !== today}>
              <summary>{day === today ? "Pick another day" : "Change day"}</summary>
              <nav aria-label="Pick a day" className="club-chips club-chips-days">
                {days.map((d) => (
                  <Link key={d} href={href({ day: d })} aria-current={d === day ? "page" : undefined}>
                    {d === today ? "Today" : shortDay(d)}
                  </Link>
                ))}
              </nav>
            </details>
          </div>

          <ul className="club-legend club-book-legend" aria-label="Legend">
            <li>
              <span className="slot slot-free" aria-hidden="true" /> Free
            </li>
            <li>
              <span className="slot slot-yours" aria-hidden="true" /> Yours
            </li>
            <li>
              <span className="slot slot-booked" aria-hidden="true" /> Taken
            </li>
            <li>
              <span className="slot slot-practice" aria-hidden="true" /> Practice
            </li>
          </ul>

          {items.length === 0 && <p className="club-empty-inline">Nothing of that type is free to show yet.</p>}
          <div className="club-book-list">
            {items.map((item) => {
              const openSlots = item.slots.filter((s) => s.state !== "past");
              return (
                <article key={item.item.id} className="club-book-item" aria-label={item.item.name} data-testid="item-card" data-item={item.item.name}>
                  <header className="club-book-item-head">
                    <h3>
                      {item.item.name}
                      {item.isPrivate && <span className="club-tag">Private</span>}
                    </h3>
                    <p className="club-meta">
                      {item.className}
                      {item.seats > 1 ? ` · ${item.seats} seats` : ""}
                      {item.places > 1 ? ` · ${item.places} places` : ""}
                      {item.needs ? ` · needs ${item.needs}` : ""}
                    </p>
                  </header>
                  {item.qualified === false && <p className="club-meta">You do not hold that qualification yet, so you cannot book this one.</p>}
                  {item.note && <p className="club-meta">{item.note}</p>}
                  {(() => {
                    const notices = openDamageNotices(state, item.item.id);
                    return notices.length === 0 ? null : (
                      <div className={`club-damage${notices.some((n) => n.major) ? " club-damage-major" : ""}`} data-testid="damage-notice">
                        {notices.map((n) => (
                          <p key={n.reportId}>{noticeWords(n)}</p>
                        ))}
                      </div>
                    );
                  })()}
                  {item.locked && (
                    <p className="club-meta" data-testid="boat-locked-note">
                      Locked: this private boat has no owner right now, so it cannot be booked until club staff add one.
                    </p>
                  )}
                  <ol className="slots">
                    {openSlots.map((slot) => {
                      const counted = slot.placesLeft !== null && !slot.heldFor && (slot.state === "free" || slot.state === "booked" || slot.state === "yours");
                      const words = slot.heldFor ? `${slot.heldFor} class` : counted && slot.state !== "yours" ? `${slot.placesLeft} of ${item.places} places left` : SLOT_WORDS[slot.state].toLowerCase();
                      const label = `${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, ${words}`;
                      const taken = slot.state === "booked" || slot.state === "class" || slot.state === "practice" || slot.state === "out_of_service" || slot.state === "not_open";
                      return (
                        <li key={slot.startsAt}>
                          {slot.state === "free" && !item.locked ? (
                            <Link className="slot slot-free" href={bookingFormHref({ itemId: item.item.id, start: slot.startsAt })} aria-label={label}>
                              {formatClock(slot.startsAt)}
                              {slot.placesLeft !== null && <small>{slot.placesLeft} left</small>}
                            </Link>
                          ) : (
                            <span
                              className={`slot slot-${slot.state}${taken ? " slot-taken" : ""}`}
                              aria-label={label}
                              data-state={slot.state}
                              title={slot.holders.length > 0 ? slot.holders.join(", ") : undefined}
                            >
                              {formatClock(slot.startsAt)}
                              <small>{slot.bookedBy ?? slot.heldFor ?? (slot.state === "booked" && slot.placesLeft !== null ? "Full" : SLOT_WORDS[slot.state])}</small>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <p className="club-book-item-foot">
                    <Link href={`/club/damage?item=${item.item.id}`} data-testid="report-damage-link" aria-label={`Report damage on ${item.item.name}`}>
                      Report damage
                    </Link>
                  </p>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const first = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

function chooseHint(b: BookBrowse): string {
  if (b.id === "shell") return "Singles, doubles, quads";
  if (b.id === "paddle") return "Kayaks and paddle boards";
  if (b.id === "dock") return "Warm months";
  if (b.id === "gym") return "Ergs and floor";
  if (b.id === "room") return "Club rooms";
  return "Desks and quiet work";
}
