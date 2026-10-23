import Link from "next/link";
import { clubNow } from "@/club/clock";
import { selfCheckInPhase } from "@/club/engine/attendance";
import { sessionTitle } from "@/club/engine/classes";
import { ordinal, waitlistPlace } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { CLASS_RULES, classRulesFor } from "@/club/settings/class-rules";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import type { ClassSession, ClubState, SignUp } from "@/club/types";
import { idParam, NOTICES } from "@/club/web";
import { ClassPlaceholderNote } from "../PlaceholderNote";
import { SelfCheckIn } from "../SelfCheckIn";
import { SignedOut } from "../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

const STATUS: Record<SignUp["status"], string> = {
  enrolled: "You have a chair",
  waitlisted: "On the waiting list",
  cancelled: "Cancelled",
  late_cancelled: "Cancelled late",
  attended: "Attended",
  no_show: "No-show",
};

function Row({ state, line, session, now }: { state: ClubState; line: SignUp; session: ClassSession; now: Date }) {
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
            : "Did not get a chair";
  const late = line.status === "enrolled" && Date.parse(session.startsAt) - now.getTime() < classRulesFor(CLASS_RULES, template).cancelCutoffMinutes * 60000;
  return (
    <li className="club-card" data-testid="class-row" data-status={line.status} data-class={template.name}>
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
      <SelfCheckIn kind="class" id={line.id} title={template.name} phase={checkIn} now={now} back="/club/my-classes" />
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

export default async function MyClasses({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind === "staff") {
    return (
      <section>
        <h1>My classes</h1>
        <p>
          Club staff do not hold class places. <Link href="/club/classes">Open Classes</Link> to see the sign-up sheets.
        </p>
      </section>
    );
  }

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const params = await searchParams;
  const mine = state.signups
    .filter((g) => g.memberId === actor.member.id)
    .map((line) => ({ line, session: state.sessions.find((x) => x.id === line.sessionId)! }))
    .filter((x) => x.session);
  const upcoming = mine
    .filter(({ line, session }) => (line.status === "enrolled" || line.status === "waitlisted" || line.status === "attended") && session.status === "scheduled" && Date.parse(session.endsAt) > now.getTime())
    .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
  const past = mine.filter((x) => !upcoming.includes(x)).sort((a, b) => b.session.startsAt.localeCompare(a.session.startsAt));
  const leftId = idParam(params.left);
  const checkedInId = idParam(params.checkedin);
  const checkedIn = checkedInId ? mine.find(({ line }) => line.id === checkedInId && line.status === "attended") : undefined;
  const left = leftId ? state.signups.find((g) => g.id === leftId) : undefined;
  const leftSession = left ? state.sessions.find((x) => x.id === left.sessionId) : undefined;
  const notice = NOTICES[one(params.notice) ?? ""];

  return (
    <section>
      <h1>My classes</h1>
      <ClassPlaceholderNote />
      {checkedIn && (
        <p className="club-success" role="status" data-testid="checkedin-note">
          You are checked in for {sessionTitle(state, checkedIn.session)}. Enjoy the class.
        </p>
      )}
      {left && leftSession && (
        <p className="club-success" role="status" data-testid="left-note">
          {left.status === "late_cancelled"
            ? `You left ${sessionTitle(state, leftSession)}. It was after the cutoff, so it is recorded as a late cancellation.`
            : `You left ${sessionTitle(state, leftSession)}. Your place is free for others.`}
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      <h2>Upcoming</h2>
      {upcoming.length === 0 ? (
        <p data-testid="no-upcoming-classes">
          No classes yet. <Link href="/club/classes">See what is on.</Link>
        </p>
      ) : (
        <ul className="club-cards" aria-label="Upcoming classes">
          {upcoming.map(({ line, session }) => (
            <Row key={line.id} state={state} line={line} session={session} now={now} />
          ))}
        </ul>
      )}

      <h2>Past</h2>
      {past.length === 0 ? (
        <p>Nothing yet.</p>
      ) : (
        <ul className="club-cards" aria-label="Past classes">
          {past.map(({ line, session }) => (
            <Row key={line.id} state={state} line={line} session={session} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
