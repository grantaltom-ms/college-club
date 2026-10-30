import Link from "next/link";
import { clubNow } from "@/club/clock";
import { checkInNeeded, rowFor, selfCheckInPhase } from "@/club/engine/attendance";
import { bookingDamageNotices, noticeWords, type DamageNotice } from "@/club/engine/damage";
import { fullName, memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { RULE_BOOK, rulesFor } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import type { Booking, ClubState } from "@/club/types";
import { idParam, NOTICES } from "@/club/web";
import { AttendanceButtons } from "../AttendanceButtons";
import { PlaceholderNote } from "../PlaceholderNote";
import { SelfCheckIn } from "../SelfCheckIn";
import { SignedOut } from "../SignedOut";

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
    <li className="club-card" data-testid="booking-row" data-status={booking.status} data-item={item.name}>
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

export default async function MyBookings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const staff = actor.kind === "staff";
  const viewerId = actor.kind === "member" ? actor.member.id : null;
  const all = state.bookings.filter((b) => staff || b.bookerId === viewerId || b.crew.includes(viewerId!));
  // An outing that is under way and already checked in stays in "Upcoming" until it ends, so it is easy to find on the water.
  const upcoming = all.filter((b) => (b.status === "upcoming" || b.status === "completed") && Date.parse(b.endsAt) > now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all.filter((b) => !upcoming.includes(b)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  const bookedId = idParam(params.booked);
  const cancelledId = idParam(params.cancelled);
  const checkedInId = idParam(params.checkedin);
  const booked = bookedId ? state.bookings.find((b) => b.id === bookedId) : undefined;
  const cancelled = cancelledId ? state.bookings.find((b) => b.id === cancelledId) : undefined;
  const checkedIn = checkedInId ? state.bookings.find((b) => b.id === checkedInId && b.status === "completed" && viewerId && (b.bookerId === viewerId || b.crew.includes(viewerId))) : undefined;
  const damage = viewerId ? bookingDamageNotices(state, viewerId, now) : {};
  const nameOf = (b: Booking) => state.items.find((i) => i.id === b.itemId)!.name;
  const notice = NOTICES[one(params.notice) ?? ""];

  return (
    <section>
      <h1>{staff ? "All bookings" : "My bookings"}</h1>
      <PlaceholderNote />
      {booked && (
        <p className="club-success" role="status" data-testid="booked-note">
          Booked: {nameOf(booked)}, {formatDayLong(pacificDate(new Date(booked.startsAt)))}, {formatRange(booked.startsAt, booked.endsAt)}.
        </p>
      )}
      {checkedIn && (
        <p className="club-success" role="status" data-testid="checkedin-note">
          You are checked in for {nameOf(checkedIn)}. Have a good one.
        </p>
      )}
      {cancelled && (
        <p className="club-success" role="status" data-testid="cancelled-note">
          {cancelled.status === "late_cancelled"
            ? `Cancelled ${nameOf(cancelled)}. It was after the cutoff, so it is recorded as a late cancellation.`
            : `Cancelled ${nameOf(cancelled)}. The time is free for others again.`}
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      <h2>Upcoming</h2>
      {upcoming.length === 0 ? (
        <p data-testid="no-upcoming">Nothing booked.</p>
      ) : (
        <ul className="club-cards" aria-label="Upcoming bookings">
          {upcoming.map((b) => (
            <Row key={b.id} state={state} booking={b} viewerId={viewerId} now={now} staff={staff} damage={damage[b.id] ?? []} />
          ))}
        </ul>
      )}

      <h2>Past</h2>
      {past.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Past bookings">
          {past.map((b) => (
            <Row key={b.id} state={state} booking={b} viewerId={viewerId} now={now} staff={staff} damage={damage[b.id] ?? []} />
          ))}
        </ul>
      )}
      {!staff && (
        <p className="club-meta">
          <Link href="/club/my-history" data-testid="old-bookings-link">
            Older outings from the club&apos;s previous reservation system
          </Link>
        </p>
      )}
    </section>
  );
}
