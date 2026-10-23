import { formatClock } from "@/club/time";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import type { AttendanceRow } from "@/club/engine/attendance";

/**
 * The staff buttons for one reservation: Check in, No-show, They were there (puts right a no-show), Confirm no-show.
 * Which ones show follows what is recorded and what time it is, so staff are never offered something that will be refused.
 * `back` is where the browser returns afterwards (a path inside the member area).
 */
export function AttendanceButtons({ row, who, back }: { row: AttendanceRow; who: string; back: string }) {
  const form = (outcome: "attended" | "no_show", label: string, aria: string) => (
    <button type="submit" name="outcome" value={outcome} className="club-button club-button-quiet" aria-label={aria}>
      {label}
    </button>
  );
  let buttons: React.ReactNode;
  if (row.outcome === null) {
    const opens = new Date(Date.parse(row.startsAt) - ATTENDANCE_RULES.defaults.checkInOpensMinutesBefore * 60000);
    buttons = (
      <>
        {row.checkInOpen ? form("attended", "Check in", `Check in ${who}`) : <span className="club-meta">Check-in opens at {formatClock(opens)}</span>}
        {row.started && form("no_show", "No-show", `Mark ${who} a no-show`)}
      </>
    );
  } else if (row.outcome === "no_show") {
    buttons = (
      <>
        {form("attended", "They were there", `Change ${who} to checked in`)}
        {row.automatic && form("no_show", "Confirm no-show", `Confirm ${who} was a no-show`)}
      </>
    );
  } else {
    buttons = form("no_show", "Mark no-show instead", `Change ${who} to a no-show`);
  }
  return (
    <form method="post" action="/api/club/attendance" className="club-attendance" data-testid="attendance-buttons" data-outcome={row.outcome ?? "none"}>
      <input type="hidden" name="kind" value={row.kind} />
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="member" value={row.memberId} />
      <input type="hidden" name="back" value={back} />
      {buttons}
    </form>
  );
}
