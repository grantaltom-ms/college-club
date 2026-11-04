import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { describeAttendanceRules, needsALook } from "@/club/engine/attendance";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, pacificDate } from "@/club/time";
import { NOTICES } from "@/club/web";
import { SignedOut } from "../../SignedOut";
import { AttendanceRowView } from "../AttendanceRowView";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * Staff only: reservation attendance records, apart from the front desk.
 * Automatic no-shows live here so the Staff office board is not a chase list for missed boat check-ins.
 * Check-in status still matters for the record and for knowing what was used; staff do not need to confirm every one.
 */
export default async function ReservationAttendance({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const rows = needsALook(state, now, ATTENDANCE_RULES);
  const notice = NOTICES[one(query.notice)];

  return (
    <section>
      <header className="club-page-head">
        <div>
          <p className="club-kicker">
            <Link href="/club/admin">Staff office</Link>
          </p>
          <h1>Reservation attendance</h1>
          <p className="club-meta">
            {formatDayLong(pacificDate(now))}. For the boat and booking record — not the front-desk chase list. A missed check-in
            (including rowing) does not need staff action; use this page only when you want to correct a record.
          </p>
        </div>
        <p className="club-page-actions">
          <Link href="/club/my-bookings" className="club-button club-button-quiet club-button-link">
            All bookings
          </Link>
          <Link href="/club/admin/check-in" className="club-button club-button-link">
            Check someone in
          </Link>
        </p>
      </header>

      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {one(query.checked) && (
        <p className="club-success" role="status" data-testid="checked">
          Saved. The change is on the check-in record.
        </p>
      )}

      <h2>
        Automatic no-shows <span className="club-count" data-testid="needs-look-count">({rows.length})</span>
      </h2>
      <p className="club-meta">
        Marked no-show because nobody checked in. Leaving them as they are is fine. Correct one only if the person was there and the
        iPad or phone was missed, or if you want the record to say a staff person confirmed the no-show.
      </p>
      {rows.length === 0 ? (
        <p data-testid="needs-look-empty">No automatic no-shows in the last few days.</p>
      ) : (
        <ul className="club-cards" aria-label="Automatic no-shows" data-testid="needs-look">
          {rows.map((row) => (
            <AttendanceRowView key={`${row.kind}-${row.id}`} state={state} row={row} back="/club/admin/reservations" />
          ))}
        </ul>
      )}

      <h2>How check-in works</h2>
      <p className="club-placeholder" data-testid="placeholder-note">
        <strong>Placeholder rules.</strong> The check-in times here are stand-ins until club staff confirm the real ones.
      </p>
      <ul className="club-list" data-testid="attendance-rules">
        {describeAttendanceRules(ATTENDANCE_RULES).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
