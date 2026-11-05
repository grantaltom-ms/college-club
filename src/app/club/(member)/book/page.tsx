import Link from "next/link";
import { dayView, pickableDays, type ItemDayView, type SlotView } from "@/club/engine/availability";
import { itemVisibleTo } from "@/club/engine/boat-access";
import { noticeWords, openDamageNotices } from "@/club/engine/damage";
import { weightRangeWords } from "@/club/engine/equipment-edit";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { clubNow } from "@/club/clock";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { readClubOnce } from "@/club/store/read-once";
import { formatClock, formatDayLong, formatRange, pacificDate, pacificMinutes } from "@/club/time";
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
import { PageBand } from "../PageBand";
import { PlaceholderNote } from "../PlaceholderNote";
import { SignedOut } from "../SignedOut";
import { DaySelect } from "./DaySelect";
import { HourSelect } from "./HourSelect";

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

/** Members never see a boat that is entirely out of commission for the day; staff still can. */
function showItemToViewer(row: ItemDayView, staff: boolean): boolean {
  if (staff) return true;
  const open = row.slots.filter((s) => s.state !== "past");
  if (open.length === 0) return false;
  return !open.every((s) => s.state === "out_of_service");
}

function hourLabel(hour: number): string {
  if (hour === 0) return "12 am";
  if (hour < 12) return `${hour} am`;
  if (hour === 12) return "12 pm";
  return `${hour - 12} pm`;
}

function slotsInHour(row: ItemDayView, hour: number): SlotView[] {
  return row.slots.filter((s) => {
    if (s.state === "past") return false;
    return Math.floor(pacificMinutes(new Date(s.startsAt)) / 60) === hour;
  });
}

/**
 * Shells use a dense picker once an hour is chosen (F + I + J): sticky window, free-only thin
 * rows, weight on the right. Without an hour, only the day/hour controls show — no card wall.
 */
function ShellDenseList({
  items,
  hour,
  kindLabel,
  staff,
  state,
}: {
  items: ItemDayView[];
  hour: number;
  kindLabel: string | null;
  staff: boolean;
  state: Awaited<ReturnType<typeof readClubOnce>>;
}) {
  const rows = items
    .map((item) => {
      const inHour = slotsInHour(item, hour);
      if (inHour.length === 0) return null;
      const free = inHour.filter((s) => s.state === "free");
      const yours = inHour.filter((s) => s.state === "yours");
      const taken = inHour.filter((s) => s.state === "booked" || s.state === "class" || s.state === "practice" || s.state === "out_of_service" || s.state === "not_open");
      // Members: free or yours only. Staff also see boats that are fully taken this hour.
      if (free.length === 0 && yours.length === 0 && !(staff && taken.length > 0)) return null;
      if (item.locked && free.length === 0 && yours.length === 0) return null;
      return { item, free, yours, taken, inHour };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const freeCount = rows.filter((r) => r.free.length > 0 && !r.item.locked && !r.item.coachBlocked).length;

  return (
    <div className="club-shell-dense" data-testid="shell-dense">
      <p className="club-shell-dense-count" data-testid="shell-dense-count">
        {freeCount === 0 ? "No shells free in this hour." : `${freeCount} free in this hour`}
      </p>
      <ul className="club-shell-dense-list" aria-label="Shells free this hour">
        {rows.map(({ item, free, yours, taken }) => {
          const weight = weightRangeWords(item.item.minWeightLbs, item.item.maxWeightLbs);
          const maker = item.item.manufacturer?.trim() || null;
          const skill = item.needs ? item.needs.replace(/\s*\(placeholder\)\s*$/i, "") : null;
          const meta = [skill, maker].filter(Boolean).join(" · ");
          const notices = openDamageNotices(state, item.item.id);
          // Still offer free-slot links when unqualified — the booking form explains the refusal in words.
          const bookable = free.length > 0 && !item.locked && !item.coachBlocked;

          return (
            <li
              key={item.item.id}
              className={`club-shell-row${bookable ? "" : " club-shell-row-quiet"}`}
              data-testid="shell-row"
              data-item={item.item.name}
            >
              <div className="club-shell-row-top">
                <div className="club-shell-row-identity">
                  <span className="club-shell-row-name">
                    {item.item.name}
                    {item.isPrivate && <span className="club-tag">Private</span>}
                    {item.coachesOnly && <span className="club-tag">Coaches only</span>}
                  </span>
                  {(meta || kindLabel) && (
                    <span className="club-shell-row-meta">
                      {kindLabel ? `${kindLabel}` : ""}
                      {kindLabel && meta ? " · " : ""}
                      {meta}
                    </span>
                  )}
                </div>
                <span className="club-shell-row-weight" data-testid="shell-weight">
                  {weight}
                </span>
              </div>

              {item.qualified === false && <p className="club-meta">You do not hold that qualification yet, so you cannot book this one.</p>}
              {item.locked && (
                <p className="club-meta" data-testid="boat-locked-note">
                  Locked: this private boat has no owner right now, so it cannot be booked until club staff add one.
                </p>
              )}
              {item.coachBlocked && (
                <p className="club-meta" data-testid="coaches-only-note">
                  Coaches only: this boat can only be booked by coaches and club staff. Ask a coach or club staff to book it.
                </p>
              )}
              {notices.length > 0 && (
                <div className={`club-damage${notices.some((n) => n.major) ? " club-damage-major" : ""}`} data-testid="damage-notice">
                  {notices.map((n) => (
                    <p key={n.reportId}>{noticeWords(n)}</p>
                  ))}
                </div>
              )}

              <div className="club-shell-row-times">
                {free.map((slot) => {
                  const label = `${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, free`;
                  if (!bookable) {
                    return (
                      <span key={slot.startsAt} className="club-shell-chip club-shell-chip-muted" aria-label={label}>
                        {formatClock(slot.startsAt)}
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={slot.startsAt}
                      className="club-shell-chip club-shell-chip-free"
                      href={bookingFormHref({ itemId: item.item.id, start: slot.startsAt })}
                      aria-label={label}
                    >
                      {formatClock(slot.startsAt)}
                    </Link>
                  );
                })}
                {yours.map((slot) => (
                  <span
                    key={slot.startsAt}
                    className="club-shell-chip club-shell-chip-yours"
                    aria-label={`${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, yours`}
                    data-state="yours"
                  >
                    {formatClock(slot.startsAt)}
                    <small>Yours</small>
                  </span>
                ))}
                {staff &&
                  free.length === 0 &&
                  yours.length === 0 &&
                  taken.map((slot) => {
                    const short =
                      slot.bookedBy ?? slot.heldFor ?? (slot.state === "booked" ? "Booked" : SLOT_WORDS[slot.state]);
                    return (
                      <span
                        key={slot.startsAt}
                        className="club-shell-chip club-shell-chip-taken"
                        aria-label={`${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, ${SLOT_WORDS[slot.state].toLowerCase()}`}
                        data-state={slot.state}
                        title={slot.holders.length > 0 ? slot.holders.join(", ") : undefined}
                      >
                        {formatClock(slot.startsAt)}
                        <small>{short}</small>
                      </span>
                    );
                  })}
              </div>

              <p className="club-shell-row-foot">
                <Link href={`/club/damage?item=${item.item.id}`} data-testid="report-damage-link" aria-label={`Report damage on ${item.item.name}`}>
                  Report damage
                </Link>
              </p>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="club-empty-inline">Nothing free in this hour. Try another hour, or another day.</p>}
    </div>
  );
}

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
  const staff = actor.kind === "staff";
  const askedType = typeParam(params.type);
  const whatRaw = first(params.what);
  const kindRaw = first(params.kind);
  const hourRaw = first(params.hour);
  const hour = hourRaw && /^\d{1,2}$/.test(hourRaw) ? Number(hourRaw) : null;
  const hourLive = hour !== null && hour >= 0 && hour <= 23 ? hour : null;

  const options = visibleBrowse(state, RULE_BOOK, now, (i) => itemVisibleTo(state, i, viewer));
  const browse = (whatRaw ? browseById(whatRaw) : null) ?? browseFromType(askedType);
  const browseLive = browse && (options.some((o) => o.id === browse.id) || Boolean(whatRaw || askedType)) ? browse : null;
  // Shells always need a size (1x/2x/4x/8x) before times — including legacy ?type=Shell links. The full fleet is 100+ boats.
  const needsKind = Boolean(browseLive && "kinds" in browseLive && browseLive.kinds);
  const kind = shellKindById(kindRaw);
  const ready = Boolean(browseLive && (!needsKind || kind));
  const denseShells = Boolean(needsKind && kind);

  const typeFilter = askedType && browseLive?.types.length === 1 ? askedType : browseLive?.types.length === 1 ? browseLive.types[0] : null;
  // When a shell size is chosen, only build slots for that size.
  const seatsFilter = needsKind && kind ? kind.seats : null;
  const view = ready
    ? dayView(state, RULE_BOOK, {
        day,
        now,
        viewer,
        type: typeFilter && browseLive!.types.includes(typeFilter as never) ? typeFilter : null,
        seats: seatsFilter,
      })
    : { day, items: [] };
  const items = ready
    ? view.items
        .filter((row) => itemMatchesBrowse(RULE_BOOK, row.item, browseLive!, kind))
        .filter((row) => {
          if (!askedType || browseLive!.types.length === 1) return true;
          return classOf(RULE_BOOK, row.item).type === askedType;
        })
        .filter((row) => showItemToViewer(row, staff))
    : [];

  const blocked = blockedReason(actor);
  const today = pacificDate(now);
  const href = (opts: { day?: string; what?: string | null; kind?: string | null; hour?: number | null }) => {
    const d = opts.day ?? day;
    const w = opts.what === undefined ? browseLive?.id ?? null : opts.what;
    const k = opts.kind === undefined ? (needsKind ? kind?.id ?? null : null) : opts.kind;
    const h = opts.hour === undefined ? hourLive : opts.hour;
    const q = new URLSearchParams();
    q.set("day", d);
    if (w) q.set("what", w);
    if (k) q.set("kind", k);
    // Keep legacy type= links working when that is how we got here.
    if (!w && askedType) q.set("type", askedType);
    if (h !== null && h !== undefined) q.set("hour", String(h));
    return `/club/book?${q.toString()}`;
  };

  const dayLabels = Object.fromEntries(days.map((d) => [d, formatDayLong(d)]));
  const hourValues = new Set<number>();
  for (const row of items) {
    for (const slot of row.slots) {
      if (slot.state === "past" || slot.state === "out_of_service") continue;
      hourValues.add(Math.floor(pacificMinutes(new Date(slot.startsAt)) / 60));
    }
  }
  const hours = [...hourValues].sort((a, b) => a - b).map((h) => ({ value: h, label: hourLabel(h) }));
  const hourActive = hourLive !== null && hours.some((h) => h.value === hourLive) ? hourLive : null;

  const lead = !ready
    ? needsKind && browseLive
      ? "Which size of shell?"
      : "What would you like to reserve?"
    : denseShells
      ? "Pick a day and hour, then tap a free shell."
      : "Pick a day and hour, then tap a free time.";

  return (
    <section className="club-book">
      <PageBand eyebrow="Equipment & boats" title="Reservations" />
      <p className="club-lead club-band-facts">{lead}</p>
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
            <Link key={b.id} href={href({ what: b.id, kind: null, hour: null })} className="club-book-choose-card" data-browse={b.id}>
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
          <nav aria-label="Shell size" className="club-book-shell-sizes" data-testid="shell-kinds">
            {SHELL_KINDS.map((k) => (
              <Link key={k.id} href={href({ what: "shell", kind: k.id, hour: null })} className="club-book-shell-size" data-kind={k.id}>
                <span className="club-book-shell-size-label">{k.label}</span>
                <span className="club-book-shell-size-hint">{k.hint}</span>
              </Link>
            ))}
          </nav>
        </>
      )}

      {ready && browseLive && (
        <>
          <div className="club-book-context">
            <p className="club-back">
              <Link href={needsKind ? href({ what: "shell", kind: null, hour: null }) : "/club/book"}>{needsKind ? "Change shell size" : "All categories"}</Link>
            </p>
            <p className="club-book-context-label" data-testid="browse-label">
              {browseLive.label}
              {kind ? ` · ${kind.label}` : ""}
            </p>
          </div>

          <div className="club-book-day">
            <p className="club-book-day-long" data-testid="day-heading">
              {day === today ? `Today · ${formatDayLong(day)}` : formatDayLong(day)}
            </p>
            <DaySelect
              days={days}
              day={day}
              today={today}
              labels={dayLabels}
              hrefs={Object.fromEntries(days.map((d) => [d, href({ day: d })]))}
            />
            {hours.length > 0 && (
              <HourSelect
                hours={hours}
                hour={hourActive}
                requireHour={denseShells}
                hrefs={{
                  all: href({ hour: null }),
                  byHour: Object.fromEntries(hours.map((h) => [h.value, href({ hour: h.value })])),
                }}
              />
            )}
          </div>

          {denseShells && hourActive !== null && (
            <div className="club-shell-window" data-testid="shell-window">
              <div>
                <p className="club-shell-window-label">Window</p>
                <p className="club-shell-window-value">
                  {day === today ? "Today" : formatDayLong(day)} · {hourLabel(hourActive)}
                </p>
              </div>
              <Link href={href({ hour: null })} className="club-shell-window-change">
                Change hour
              </Link>
            </div>
          )}

          {denseShells && hourActive === null && (
            <p className="club-shell-pick-hour" data-testid="pick-hour-note" role="status">
              Choose an hour to see free shells. Only boats open in that hour are listed.
            </p>
          )}

          {denseShells && hourActive !== null && (
            <ShellDenseList items={items} hour={hourActive} kindLabel={kind?.label ?? null} staff={staff} state={state} />
          )}

          {!denseShells && (
            <>
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
                  const openSlots = item.slots.filter((s) => {
                    if (s.state === "past") return false;
                    if (hourActive === null) return true;
                    return Math.floor(pacificMinutes(new Date(s.startsAt)) / 60) === hourActive;
                  });
                  if (openSlots.length === 0) return null;
                  return (
                    <article key={item.item.id} className="club-book-item" aria-label={item.item.name} data-testid="item-card" data-item={item.item.name}>
                      <header className="club-book-item-head">
                        <h3>
                          {item.item.name}
                          {item.isPrivate && <span className="club-tag">Private</span>}
                          {item.coachesOnly && <span className="club-tag">Coaches only</span>}
                        </h3>
                        <p className="club-meta">
                          {kind ? kind.label : item.className}
                          {classOf(RULE_BOOK, item.item).type === "Shell" || item.item.minWeightLbs != null || item.item.maxWeightLbs != null
                            ? ` · ${weightRangeWords(item.item.minWeightLbs, item.item.maxWeightLbs)}`
                            : ""}
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
                      {item.coachBlocked && (
                        <p className="club-meta" data-testid="coaches-only-note">
                          Coaches only: this boat can only be booked by coaches and club staff. Ask a coach or club staff to book it.
                        </p>
                      )}
                      <ol className="slots club-slots-compact">
                        {openSlots.map((slot) => {
                          const counted = slot.placesLeft !== null && !slot.heldFor && (slot.state === "free" || slot.state === "booked" || slot.state === "yours");
                          // A free slot on a coaches-only boat is not offered to a member who is not a coach: it says so instead.
                          const coachesOnlySlot = slot.state === "free" && item.coachBlocked;
                          const words = slot.heldFor
                            ? `${slot.heldFor} class`
                            : coachesOnlySlot
                              ? "coaches only"
                              : counted && slot.state !== "yours"
                                ? `${slot.placesLeft} of ${item.places} places left`
                                : SLOT_WORDS[slot.state].toLowerCase();
                          const label = `${item.item.name}, ${formatRange(slot.startsAt, slot.endsAt)}, ${words}`;
                          const taken = slot.state === "booked" || slot.state === "class" || slot.state === "practice" || slot.state === "out_of_service" || slot.state === "not_open";
                          const shortTaken =
                            slot.bookedBy ?? slot.heldFor ?? (slot.state === "booked" && slot.placesLeft !== null ? "Full" : SLOT_WORDS[slot.state]);
                          return (
                            <li key={slot.startsAt}>
                              {slot.state === "free" && !item.locked && !item.coachBlocked ? (
                                <Link className="slot slot-free" href={bookingFormHref({ itemId: item.item.id, start: slot.startsAt })} aria-label={label}>
                                  {formatClock(slot.startsAt)}
                                  {slot.placesLeft !== null && <small>{slot.placesLeft} left</small>}
                                </Link>
                              ) : (
                                <span
                                  className={`slot slot-${coachesOnlySlot ? "coaches" : slot.state}${taken ? " slot-taken" : ""}`}
                                  aria-label={label}
                                  data-state={coachesOnlySlot ? "coaches_only" : slot.state}
                                  title={slot.holders.length > 0 ? slot.holders.join(", ") : undefined}
                                >
                                  {formatClock(slot.startsAt)}
                                  <small>{coachesOnlySlot ? "Coaches only" : shortTaken}</small>
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
        </>
      )}
    </section>
  );
}

const first = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

function chooseHint(b: BookBrowse): string {
  if (b.id === "shell") return "1x, 2x, 4x, 8x";
  if (b.id === "paddle") return "Kayaks and paddle boards";
  if (b.id === "dock") return "Warm months";
  if (b.id === "gym") return "Ergs and floor";
  if (b.id === "room") return "Club rooms";
  return "Desks and quiet work";
}
