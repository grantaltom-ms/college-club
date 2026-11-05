import Link from "next/link";
import { selfCheckInPhase } from "@/club/engine/attendance";
import { sessionTitle } from "@/club/engine/classes";
import { ordinal, waitlistPlace } from "@/club/engine/queries";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { CLASS_RULES, classRulesFor } from "@/club/settings/class-rules";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import type { ClassSession, ClubState, SignUp } from "@/club/types";
import { SelfCheckIn } from "../SelfCheckIn";

const STATUS: Record<SignUp["status"], string> = {
  enrolled: "You have a place",
  waitlisted: "On the waiting list",
  cancelled: "Cancelled",
  late_cancelled: "Cancelled late",
  attended: "Attended",
  no_show: "No-show",
};

/**
 * One of a member's class sign-ups, as a row of My bookings (it used to be a page of its own, My classes). It sits in the same list as
 * their boat and space bookings, tagged "Class". Leave and "I'm here" work as they always did and bring the member back to My bookings.
 */
export function ClassRow({ state, line, session, now }: { state: ClubState; line: SignUp; session: ClassSession; now: Date }) {
  const template = state.classes.find((c) => c.id === session.classId)!;
  const live = line.status === "enrolled" || line.status === "waitlisted";
  const upcoming = live && session.status === "scheduled" && Date.parse(session.startsAt) > now.getTime();
  const place = waitlistPlace(state, line.id);
  const checkIn = selfCheckInPhase(state, "class", line.id, line.memberId, now, ATTENDANCE_RULES);
  const status =
    session.status === "cancelled"
      ? "Class cancelled"
      : line.status === "attended" && Date.parse(session.endsAt) > now.getTime()
        ? "Checked in"
        : upcoming || !live
          ? STATUS[line.status]
          : line.status === "enrolled"
            ? "Awaiting check-in"
            : "Did not get a place";
  const late = line.status === "enrolled" && Date.parse(session.startsAt) - now.getTime() < classRulesFor(CLASS_RULES, template).cancelCutoffMinutes * 60000;
  return (
    <li className="club-card" data-testid="class-row" data-status={line.status} data-class={template.name} data-kind="Class">
      <p className="club-row-kind" data-testid="row-kind">
        Class
      </p>
      <h3>
        <Link href={`/club/classes/${session.id}`}>{template.name}</Link>
      </h3>
      <p>
        {formatDayLong(pacificDate(new Date(session.startsAt)))}, {formatRange(session.startsAt, session.endsAt)}
      </p>
      <p className="club-meta">
        <span data-testid="class-status">{status}</span>
        {line.status === "waitlisted" && place ? `, ${ordinal(place)} in line` : ""}
        {session.status === "cancelled" && session.cancelReason ? ` · ${session.cancelReason}` : ""}
        {line.status === "enrolled" && line.promotedAt ? " · moved up from the waiting list" : ""}
      </p>
      <SelfCheckIn kind="class" id={line.id} title={template.name} phase={checkIn} now={now} back="/club/my-bookings" />
      {upcoming && (
        <form method="post" action="/api/club/classes/leave">
          <input type="hidden" name="id" value={line.id} />
          {late && <p className="club-meta">Leaving now counts as a late cancellation.</p>}
          <button type="submit" className="club-button club-button-quiet" aria-label={`Leave ${sessionTitle(state, session)}`}>
            {line.status === "waitlisted" ? "Leave the waiting list" : "Leave class"}
          </button>
        </form>
      )}
    </li>
  );
}
