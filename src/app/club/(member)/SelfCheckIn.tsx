import type { SelfCheckInPhase } from "@/club/engine/attendance";
import { formatClock, formatDayLong, pacificDate } from "@/club/time";
import type { AttendanceKind } from "@/club/types";

/**
 * "I'm here" for a member's own phone, on a reservation of theirs: a button once check-in is open, and a line saying when
 * it opens before then. Nothing at all once they are checked in (the status already says so) or when it cannot be checked
 * in. `back` is where the browser returns afterwards (a path inside the member area).
 */
export function SelfCheckIn({ kind, id, title, phase, now, back }: { kind: AttendanceKind; id: string; title: string; phase: SelfCheckInPhase | null; now: Date; back: string }) {
  if (!phase || phase.phase === "done") return null;
  if (phase.phase === "not_yet") {
    const opens = new Date(phase.opensAt);
    const sameDay = pacificDate(opens) === pacificDate(now);
    return (
      <p className="club-meta" data-testid="check-in-opens">
        Check-in opens {sameDay ? "" : `${formatDayLong(pacificDate(opens))} `}at {formatClock(opens)}.
      </p>
    );
  }
  return (
    <form method="post" action="/api/club/check-in" className="club-checkin" data-testid="check-in-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="club-button" aria-label={`Check in for ${title}`}>
        I&apos;m here: check in
      </button>
    </form>
  );
}
