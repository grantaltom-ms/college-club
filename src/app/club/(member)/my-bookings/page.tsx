import Link from "next/link";
import { clubNow } from "@/club/clock";
import { checkInNeeded, rowFor, selfCheckInPhase } from "@/club/engine/attendance";
import { sessionTitle } from "@/club/engine/classes";
import { bookingDamageNotices, noticeWords, type DamageNotice } from "@/club/engine/damage";
import { myPractices, practiceNoticeFor, sideWords } from "@/club/engine/practices";
import { fullName, memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { RULE_BOOK, classOf, rulesFor } from "@/club/settings/rulebook";
import { readClubOnce } from "@/club/store/read-once";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import type { Booking, ClassSession, ClubState, SignUp } from "@/club/types";
import { idParam, NOTICES } from "@/club/web";
import { AttendanceButtons } from "../AttendanceButtons";
import { ClassRow } from "./ClassRow";
import { PlaceholderNote } from "../PlaceholderNote";
import { SelfCheckIn } from "../SelfCheckIn";
import { SignedOut } from "../SignedOut";
import { PageBand } from "../PageBand";

const STATUS: Record<Booking["status"], string> = {
  upcoming: "Upcoming",
  completed: "Completed",
  cancelled: "Cancelled",
  late_cancelled: "Cancelled late",
  no_show: "No-show",
};

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

function Row({ state, booking, viewerId, now, staff, damage }: { state: ClubState; booking: Booking; viewerId: string | null; now: Date; staff: boolean; damage: DamageNotice[] }) {
  const item = state.items.find((i) => i.id === booking.itemId)!;
  // What kind of thing it is, as the club names it: Shell, Kayak, Paddle Board, Dock Space, Gym Space, Room Space, Work Space.
  const kind = classOf(RULE_BOOK, item).type;
  const practiceNotice = practiceNoticeFor(state, booking);
  const booker = memberById(state, booking.bookerId)!;
  const crew = booking.crew.map((id) => fullName(memberById(state, id)!));
  const mine = booking.bookerId === viewerId;
  const finished = Date.parse(booking.endsAt) <= now.getTime();
  const status =
    booking.status === "upcoming" && finished
      ? checkInNeeded(state, booking, ATTENDANCE_RULES)
        ? "Awaiting check-in"
        : "Finished"
      : booking.status === "completed" && !finished
        ? "Checked in"
        : STATUS[booking.status];
  const cancellable = booking.status === "upcoming" && Date.parse(booking.startsAt) > now.getTime() && (mine || staff);
  const attendance = staff ? rowFor(state, "booking", booking.id, now, ATTENDANCE_RULES) : null;
  const checkIn = viewerId ? selfCheckInPhase(state, "booking", booking.id, viewerId, now, ATTENDANCE_RULES) : null;
  const cutoff = rulesFor(RULE_BOOK, item).rules.cancelCutoffMinutes;
  const late = mine && Date.parse(booking.startsAt) - now.getTime() < cutoff * 60000;
  return (
    <li className="club-card" data-testid="booking-row" data-status={booking.status} data-item={item.name} data-kind={kind}>
      <p className="club-row-kind" data-testid="row-kind">
        {kind}
      </p>
      <h3>{item.name}</h3>
      <p>
        {formatDayLong(pacificDate(new Date(booking.startsAt)))}, {formatRange(booking.startsAt, booking.endsAt)}
      </p>
      <p className="club-meta">
        <span data-testid="booking-status">{status}</span>
        {staff || !mine ? ` · booked by ${fullName(booker)}` : ""}
        {crew.length > 0 ? ` · crew: ${crew.join(", ")}` : ""}
        {!mine && !staff ? " · you are crew" : ""}
        {booking.override ? ` · staff override: ${booking.override.reason}` : ""}
        {booking.cancelReason ? ` · ${booking.cancelReason}` : ""}
      </p>
      {damage.length > 0 && (
        <div className={`club-damage${damage.some((n) => n.major) ? " club-damage-major" : ""}`} data-testid="booking-damage-notice">
          {damage.map((n) => (
            <p key={n.reportId}>{noticeWords(n)}</p>
          ))}
        </div>
      )}
      {practiceNotice && (
        <p className="club-alert" role="note" data-testid="booking-practice-notice">
          {practiceNotice}
        </p>
      )}
      {staff && attendance && <AttendanceButtons row={attendance} who={fullName(booker)} back="/club/my-bookings" />}
      <SelfCheckIn kind="booking" id={booking.id} title={item.name} phase={checkIn} now={now} back="/club/my-bookings" />
      {cancellable && (
        <form method="post" action="/api/club/bookings/cancel">
          <input type="hidden" name="id" value={booking.id} />
          {late && <p className="club-meta">Cancelling now counts as a late cancellation.</p>}
          <button type="submit" className="club-button club-button-quiet" aria-label={`Cancel ${item.name}, ${formatRange(booking.startsAt, booking.endsAt)}`}>
            Cancel booking
          </button>
        </form>
      )}
    </li>
  );
}

/** One line of the list: a boat or space booking, or a class sign-up. They share one list, soonest first, each tagged with what it is. */
type Entry = { key: string; startsAt: string; booking: Booking; line?: undefined; session?: undefined } | { key: string; startsAt: string; line: SignUp; session: ClassSession; booking?: undefined };

export default async function MyBookings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await readClubOnce();
  const params = await searchParams;
  const staff = actor.kind === "staff";
  const viewerId = actor.kind === "member" ? actor.member.id : null;
  const all = state.bookings.filter((b) => staff || b.bookerId === viewerId || b.crew.includes(viewerId!));
  // An outing that is under way and already checked in stays in "Upcoming" until it ends, so it is easy to find on the water.
  const upcoming = all.filter((b) => (b.status === "upcoming" || b.status === "completed") && Date.parse(b.endsAt) > now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all.filter((b) => !upcoming.includes(b)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  // A member's class sign-ups sit in the same list (this page used to be two: My bookings and My classes). Staff hold no class places.
  const classes = viewerId
    ? state.signups
        .filter((g) => g.memberId === viewerId)
        .map((line) => ({ line, session: state.sessions.find((x) => x.id === line.sessionId)! }))
        .filter((x) => x.session)
    : [];
  const classUpcoming = (x: { line: SignUp; session: ClassSession }) =>
    (x.line.status === "enrolled" || x.line.status === "waitlisted" || x.line.status === "attended") && x.session.status === "scheduled" && Date.parse(x.session.endsAt) > now.getTime();
  const bookingEntry = (booking: Booking): Entry => ({ key: `b:${booking.id}`, startsAt: booking.startsAt, booking });
  const classEntry = ({ line, session }: { line: SignUp; session: ClassSession }): Entry => ({ key: `c:${line.id}`, startsAt: session.startsAt, line, session });
  const upcomingEntries: Entry[] = [...upcoming.map(bookingEntry), ...classes.filter(classUpcoming).map(classEntry)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pastEntries: Entry[] = [...past.map(bookingEntry), ...classes.filter((x) => !classUpcoming(x)).map(classEntry)].sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const bookedId = idParam(params.booked);
  const cancelledId = idParam(params.cancelled);
  const checkedInId = idParam(params.checkedin);
  const booked = bookedId ? state.bookings.find((b) => b.id === bookedId) : undefined;
  const cancelled = cancelledId ? state.bookings.find((b) => b.id === cancelledId) : undefined;
  const checkedIn = checkedInId ? state.bookings.find((b) => b.id === checkedInId && b.status === "completed" && viewerId && (b.bookerId === viewerId || b.crew.includes(viewerId))) : undefined;
  const checkedInClass = checkedInId ? classes.find(({ line }) => line.id === checkedInId && line.status === "attended") : undefined;
  const left = idParam(params.left) ? classes.find(({ line }) => line.id === idParam(params.left)) : undefined;
  const damage = viewerId ? bookingDamageNotices(state, viewerId, now) : {};
  const nameOf = (b: Booking) => state.items.find((i) => i.id === b.itemId)!.name;
  const notice = NOTICES[one(params.notice) ?? ""];
  const practices = viewerId && !staff ? myPractices(state, viewerId, now) : [];

  const drawEntry = (e: Entry) =>
    e.booking ? (
      <Row key={e.key} state={state} booking={e.booking} viewerId={viewerId} now={now} staff={staff} damage={damage[e.booking.id] ?? []} />
    ) : (
      <ClassRow key={e.key} state={state} line={e.line} session={e.session} now={now} />
    );

  return (
    <section className="club-bookings">
      <PageBand eyebrow={staff ? "Desk" : "Yours"} title={staff ? "All bookings" : "My bookings"} />
      {staff && (
        <p className="club-meta club-band-facts">
          Correct an automatic no-show on <Link href="/club/admin/reservations">Reservation attendance</Link> — the front desk does not
          chase missed boat check-ins.
        </p>
      )}
      <PlaceholderNote />
      {booked && (
        <div className="club-done" role="status">
          <p className="club-done-title">You are booked</p>
          <p data-testid="booked-note">
            Booked: {nameOf(booked)}, {formatDayLong(pacificDate(new Date(booked.startsAt)))}, {formatRange(booked.startsAt, booked.endsAt)}.
          </p>
          <p className="club-quiet-links">
            <Link href="/club/book">Book another</Link>
          </p>
        </div>
      )}
      {checkedIn && (
        <p className="club-success" role="status" data-testid="checkedin-note">
          You are checked in for {nameOf(checkedIn)}. Have a good one.
        </p>
      )}
      {checkedInClass && (
        <p className="club-success" role="status" data-testid="checkedin-note">
          You are checked in for {sessionTitle(state, checkedInClass.session)}. Enjoy the class.
        </p>
      )}
      {left && (
        <p className="club-success" role="status" data-testid="left-note">
          {left.line.status === "late_cancelled"
            ? `You left ${sessionTitle(state, left.session)}. It was after the cutoff, so it is recorded as a late cancellation.`
            : `You left ${sessionTitle(state, left.session)}. Your place is free for others.`}
        </p>
      )}
      {cancelled && (
        <div className="club-done club-done-quiet" role="status">
          <p data-testid="cancelled-note">
            {cancelled.status === "late_cancelled"
              ? `Cancelled ${nameOf(cancelled)}. It was after the cutoff, so it is recorded as a late cancellation.`
              : `Cancelled ${nameOf(cancelled)}. The time is free for others again.`}
          </p>
          {!staff && (
            <p className="club-quiet-links">
              <Link href="/club/book">Book again</Link>
            </p>
          )}
        </div>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      {practices.length > 0 && (
        <>
          <h2>Practices you are in</h2>
          <ul className="club-cards" aria-label="Practices you are in" data-testid="booking-practices">
            {practices.map((p) => (
              <li key={p.practiceId} className="club-card" data-testid="booking-practice">
                <h3>
                  <Link href={`/club/practices/${p.practiceId}`}>{p.name}</Link>
                </h3>
                <p>
                  {formatDayLong(pacificDate(new Date(p.startsAt)))}, {formatRange(p.startsAt, p.endsAt)} &middot; {p.boat}, seat {p.seat} ({sideWords(p.side).toLowerCase()})
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Upcoming</h2>
      {upcomingEntries.length === 0 ? (
        <p className="club-empty-inline" data-testid="no-upcoming">
          Nothing booked.{" "}
          {!staff && (
            <>
              <Link href="/club/book" className="club-inline-cta">
                Make a reservation
              </Link>{" "}
              or{" "}
              <Link href="/club/classes" className="club-inline-cta">
                join a class
              </Link>
            </>
          )}
        </p>
      ) : (
        <ul className="club-cards" aria-label="Upcoming bookings">
          {upcomingEntries.map((e) => drawEntry(e))}
        </ul>
      )}

      <h2>Past</h2>
      {pastEntries.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Past bookings">
          {pastEntries.map((e) => drawEntry(e))}
        </ul>
      )}
      {!staff && (
        <p className="club-meta">
          <Link href="/club/my-practices" data-testid="my-practices-link">
            My practices
          </Link>{" "}
          &middot;{" "}
          <Link href="/club/my-history" data-testid="old-bookings-link">
            Older outings from the club&apos;s previous reservation system
          </Link>
        </p>
      )}
    </section>
  );
}
