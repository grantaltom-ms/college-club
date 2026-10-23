import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { checkSignUp, sessionTitle, sessionView, type SignUpReason } from "@/club/engine/classes";
import { chairsText, yoursText } from "@/club/engine/class-words";
import { describeClassRules } from "@/club/engine/describe";
import { fullName, householdOf, ordinal } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { CLASS_RULES, classRulesFor } from "@/club/settings/class-rules";
import { RULE_BOOK } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import { idParam, NOTICES } from "@/club/web";
import { ClassPlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";
import { rowFor } from "@/club/engine/attendance";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { AttendanceButtons } from "../../AttendanceButtons";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

const CLASS_NOTICES: Record<string, string> = {
  ...NOTICES,
  capacity: "Chairs cannot go below the number of people who already have one. Cancel some sign-ups first, or choose a bigger number.",
  started: "That class has already started, so this can no longer be done here.",
};

export default async function ClassPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  const { sessionId } = await params;
  const query = await searchParams;
  const now = clubNow();
  const state = await (await getClubStore()).read();
  const session = state.sessions.find((x) => x.id === sessionId);
  if (!session) notFound();

  const staff = actor.kind === "staff";
  const view = sessionView(state, session, staff ? { kind: "staff" } : { kind: "member", memberId: actor.member.id });
  const template = view.template;
  const rules = classRulesFor(CLASS_RULES, template);
  const started = Date.parse(session.startsAt) <= now.getTime();
  const open = session.status === "scheduled" && !started;
  const ctx = { actor: toEngineActor(actor), now };

  // Who the sign-up is for: a member signs up themself; staff pick someone.
  const people = state.members
    .filter((m) => m.status === "active" && householdOf(state, m.householdId)?.status === "active")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const forId = staff ? (people.find((m) => m.id === idParam(query.for))?.id ?? null) : actor.member.id;
  const reasons: SignUpReason[] | null = forId && open ? checkSignUp(state, RULE_BOOK, CLASS_RULES, ctx, { sessionId: session.id, memberId: forId }) : null;
  const forLine = forId ? view.sheet.find((l) => l.memberId === forId && (l.status === "enrolled" || l.status === "waitlisted")) ?? (staff ? null : view.yours) : null;
  const claim = !!forLine && forLine.status === "waitlisted" && reasons !== null && reasons.length === 0;
  const lateIfLeft = forLine?.status === "enrolled" && Date.parse(session.startsAt) - now.getTime() < rules.cancelCutoffMinutes * 60000;

  const joinedId = idParam(query.joined);
  const joined = joinedId ? state.signups.find((g) => g.id === joinedId && g.sessionId === session.id) : undefined;
  const joinedPlace = joined ? state.signups.filter((g) => g.sessionId === session.id && g.status === "waitlisted").findIndex((g) => g.id === joined.id) + 1 : 0;
  const notice = CLASS_NOTICES[one(query.notice) ?? ""];
  const cancelledNames = session.status === "cancelled" && staff ? state.signups.filter((g) => g.sessionId === session.id && g.cancelReason?.startsWith("The class was cancelled")) : [];
  const explained = describeClassRules(CLASS_RULES, template);
  const yours = yoursText(view.yours);

  return (
    <section>
      <p>
        <Link href={`/club/classes?day=${pacificDate(new Date(session.startsAt))}`}>All classes this day</Link>
      </p>
      <h1>{template.name}</h1>
      <ClassPlaceholderNote />
      <p data-testid="class-when">
        {formatDayLong(pacificDate(new Date(session.startsAt)))}, {formatRange(session.startsAt, session.endsAt)}
        {view.roomName ? ` · ${view.roomName}` : ""}
        {template.instructor ? ` · with ${template.instructor}` : ""}
      </p>
      {template.description && <p>{template.description}</p>}
      <p className="club-meta" data-testid="class-chairs">
        {chairsText(view)} ({session.capacity} chairs{view.waiting > 0 ? `, ${view.waiting} waiting` : ""})
      </p>

      {session.status === "cancelled" && (
        <p className="club-alert" role="status" data-testid="class-cancelled">
          This class was cancelled{session.cancelReason ? `: ${session.cancelReason}` : "."}
        </p>
      )}
      {joined && (
        <p className="club-success" role="status" data-testid="joined-note">
          {joined.status === "enrolled" ? (staff ? "Signed up with a chair." : "You are in. You have a chair.") : `On the waiting list, ${ordinal(joinedPlace)} in line. If a chair frees up, the first in line gets it at once.`}
        </p>
      )}
      {one(query.changed) && (
        <p className="club-success" role="status">
          Saved.
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      {open && (
        <div className="club-card" data-testid="signup-panel">
          {staff && (
            <form method="get" className="club-form" action={`/club/classes/${session.id}`}>
              <p>
                <label htmlFor="for">Sign up which member?</label>
                <select id="for" name="for" defaultValue={forId ?? ""}>
                  <option value="">Choose a member</option>
                  {people.map((m) => (
                    <option key={m.id} value={m.id}>
                      {fullName(m)}
                    </option>
                  ))}
                </select>{" "}
                <button type="submit" className="club-button club-button-quiet">
                  Check
                </button>
              </p>
            </form>
          )}

          {forLine && (
            <>
              <p data-testid="your-place">
                {staff ? `${fullName(people.find((m) => m.id === forId)!)}: ` : ""}
                {forLine.status === "enrolled" ? (staff ? "has a chair." : "You have a chair.") : `${staff ? "is" : "You are"} on the waiting list, ${ordinal(forLine.place ?? 1)} in line.`}
              </p>
              {claim && (
                <form method="post" action="/api/club/classes/sign-up">
                  <input type="hidden" name="session" value={session.id} />
                  {staff && <input type="hidden" name="for" value={forId!} />}
                  <p className="club-meta">A chair is free, and the automatic move-up has ended, so it goes to whoever asks first.</p>
                  <button type="submit" className="club-button">
                    Take the free chair
                  </button>
                </form>
              )}
              <form method="post" action="/api/club/classes/leave">
                <input type="hidden" name="id" value={view.sheet.find((l) => l.memberId === forId && (l.status === "enrolled" || l.status === "waitlisted"))?.signUpId ?? view.yours?.signUpId ?? ""} />
                {lateIfLeft && !staff && <p className="club-meta">Leaving now counts as a late cancellation.</p>}
                <button type="submit" className="club-button club-button-quiet">
                  {forLine.status === "waitlisted" ? "Leave the waiting list" : "Leave this class"}
                </button>
              </form>
            </>
          )}

          {!forLine && forId && reasons && reasons.length > 0 && (
            <div className="club-alert" role="alert" data-testid="refusal">
              <p>{staff ? "This sign-up cannot be made:" : "You cannot sign up for this class:"}</p>
              <ul>
                {reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            </div>
          )}
          {!forLine && forId && reasons && reasons.length === 0 && (
            <form method="post" action="/api/club/classes/sign-up">
              <input type="hidden" name="session" value={session.id} />
              {staff && <input type="hidden" name="for" value={forId} />}
              <p className="club-meta">{view.full ? `This class is full. You can join the waiting list; the first in line gets a chair the moment one frees up.` : "There is a chair for you."}</p>
              <button type="submit" className="club-button">
                {view.full ? "Join the waiting list" : "Sign up"}
              </button>
            </form>
          )}
        </div>
      )}
      {!open && session.status === "scheduled" && <p className="club-meta">This class has started, so sign-up is closed.</p>}
      {yours && !open && <p className="club-meta">{yours}</p>}

      {staff && (
        <>
          <h2>Sign-up sheet</h2>
          {view.sheet.length === 0 ? (
            <p>Nobody has signed up yet.</p>
          ) : (
            <ul className="club-list" aria-label="Sign-up sheet" data-testid="sheet">
              {view.sheet.map((line) => (
                <li key={line.signUpId} data-testid="sheet-line" data-status={line.status}>
                  {line.name} · {line.status === "waitlisted" ? `waiting, ${ordinal(line.place ?? 1)} in line` : line.status.replace("_", " ")}
                  {(() => {
                    const row = rowFor(state, "class", line.signUpId, now, ATTENDANCE_RULES);
                    return row ? <AttendanceButtons row={row} who={line.name ?? "this person"} back={`/club/classes/${session.id}`} /> : null;
                  })()}
                </li>
              ))}
            </ul>
          )}
          {cancelledNames.length > 0 && (
            <div className="club-card" data-testid="affected">
              <h3>Please contact these people</h3>
              <ul>
                {cancelledNames.map((g) => {
                  const m = state.members.find((x) => x.id === g.memberId)!;
                  return (
                    <li key={g.id}>
                      {fullName(m)}: {m.email}, {m.phone}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {open && (
            <>
              <h2>Staff tools</h2>
              <form method="post" action="/api/club/classes/capacity" className="club-form">
                <input type="hidden" name="session" value={session.id} />
                <p>
                  <label htmlFor="capacity">Chairs</label>
                  <input id="capacity" name="capacity" type="number" min={Math.max(1, view.enrolled)} max={200} defaultValue={session.capacity} required />{" "}
                  <button type="submit" className="club-button">
                    Change chairs
                  </button>
                </p>
                <p className="club-meta">Adding chairs moves people up from the waiting list at once. Chairs cannot go below the people who already have one.</p>
              </form>
              <form method="post" action="/api/club/classes/cancel-session" className="club-form">
                <input type="hidden" name="session" value={session.id} />
                <p>
                  <label htmlFor="why">Cancel this class (members will see the reason)</label>
                  <input id="why" name="reason" type="text" maxLength={300} required />{" "}
                  <button type="submit" className="club-button" aria-label={`Cancel ${sessionTitle(state, session)}`}>
                    Cancel class
                  </button>
                </p>
              </form>
            </>
          )}
        </>
      )}

      <div className="club-card">
        <h2>{explained.heading}</h2>
        <ul>
          {explained.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
