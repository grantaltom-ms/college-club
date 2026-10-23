import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { planSessions, schedulingMessage } from "@/club/engine/classes";
import { requireClub } from "@/club/guard";
import { ClubError } from "@/club/errors";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { RULE_BOOK, classOf } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate, pacificWall } from "@/club/time";
import { CLASS_ROOM_TYPES } from "@/club/types";
import { dateParam, idParam, intParam, NOTICES, timeParam } from "@/club/web";
import { ClassPlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

/** Staff only: add a kind of class, and schedule dated sessions of it, one or a weekly run. A fuller staff screen comes in step 5. */
export default async function ManageClasses({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const now = clubNow();
  const state = await (await getClubStore()).read();
  const query = await searchParams;
  const rooms = state.items.filter((i) => CLASS_ROOM_TYPES.includes(classOf(RULE_BOOK, i).type));

  // The scheduling form, checked in the same words scheduling itself would use.
  const classId = idParam(query.class);
  const date = dateParam(query.date);
  const time = timeParam(query.time);
  const weeks = intParam(one(query.weeks), 1, 52, 1);
  const chairs = intParam(one(query.chairs), 1, 200, 0);
  const room = one(query.room) ?? "";
  let problems: string[] = [];
  let preview: { startsAt: string; endsAt: string }[] = [];
  let message: string | null = null;
  if (classId && date && time !== null && state.classes.some((c) => c.id === classId)) {
    try {
      const plan = planSessions(
        state,
        RULE_BOOK,
        { actor: toEngineActor(actor), now },
        { classId, startsAt: pacificWall(date, time), weeks, capacity: chairs || undefined, roomItemId: room === "none" ? null : (idParam(room) ?? undefined) },
        () => "preview",
      );
      problems = plan.problems;
      preview = plan.sessions;
      if (problems.length > 0) message = schedulingMessage(problems);
    } catch (e) {
      if (!(e instanceof ClubError)) throw e;
      message = e.message;
    }
  }
  const notice = NOTICES[one(query.notice) === "conflict" ? "" : (one(query.notice) ?? "")];
  const scheduled = intParam(one(query.scheduled), 1, 52, 0);

  return (
    <section>
      <h1>Set up classes</h1>
      <ClassPlaceholderNote />
      <p className="club-meta">Add a kind of class, then schedule dates for it. A scheduled class holds its room: members cannot book that gym or room while it runs.</p>
      {idParam(query.created) && (
        <p className="club-success" role="status" data-testid="created-note">
          Class added. Now schedule its dates below.
        </p>
      )}
      {scheduled > 0 && (
        <p className="club-success" role="status" data-testid="scheduled-note">
          Scheduled {scheduled} session{scheduled === 1 ? "" : "s"}. <Link href="/club/classes">See them.</Link>
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}

      <h2>Schedule sessions</h2>
      <form method="post" action="/api/club/classes/schedule" className="club-form" data-testid="schedule-form">
        <p>
          <label htmlFor="class">Class</label>
          <select id="class" name="class" required defaultValue={classId ?? ""}>
            <option value="" disabled>
              Choose a class
            </option>
            {state.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="date">First date</label>
          <input id="date" name="date" type="date" required defaultValue={date ?? ""} />
        </p>
        <p>
          <label htmlFor="time">Start time (Pacific)</label>
          <input id="time" name="time" type="time" required defaultValue={one(query.time) ?? ""} />
        </p>
        <p>
          <label htmlFor="weeks">Repeat weekly for how many weeks (1 for a single class)</label>
          <input id="weeks" name="weeks" type="number" min={1} max={52} defaultValue={weeks} />
        </p>
        <p>
          <label htmlFor="sched-chairs">Chairs (leave empty to use the class&rsquo;s usual number)</label>
          <input id="sched-chairs" name="chairs" type="number" min={1} max={200} defaultValue={chairs || ""} />
        </p>
        <p>
          <label htmlFor="sched-room">Room</label>
          <select id="sched-room" name="room" defaultValue={room}>
            <option value="">The class&rsquo;s usual room</option>
            <option value="none">No room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </p>
        <button type="submit" className="club-button">
          Schedule
        </button>
      </form>
      {message && (
        <div className="club-alert" role="alert" data-testid="schedule-problems">
          <p>{message}</p>
        </div>
      )}
      {!message && preview.length > 0 && (
        <p className="club-meta" data-testid="schedule-preview">
          This would schedule: {preview.map((p) => `${formatDayLong(pacificDate(new Date(p.startsAt)))}, ${formatRange(p.startsAt, p.endsAt)}`).join("; ")}.
        </p>
      )}

      <h2>Add a class</h2>
      <form method="post" action="/api/club/classes/create" className="club-form" data-testid="class-form">
        <p>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" maxLength={80} required />
        </p>
        <p>
          <label htmlFor="description">What it is (optional)</label>
          <input id="description" name="description" type="text" maxLength={500} />
        </p>
        <p>
          <label htmlFor="instructor">Instructor (optional)</label>
          <input id="instructor" name="instructor" type="text" maxLength={120} />
        </p>
        <p>
          <label htmlFor="chairs">Usual number of chairs</label>
          <input id="chairs" name="chairs" type="number" min={1} max={200} defaultValue={10} required />
        </p>
        <p>
          <label htmlFor="minutes">Usual length in minutes</label>
          <input id="minutes" name="minutes" type="number" min={15} max={480} defaultValue={60} required />
        </p>
        <p>
          <label htmlFor="room">Usual room</label>
          <select id="room" name="room" defaultValue="">
            <option value="">No room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </p>
        <button type="submit" className="club-button">
          Add class
        </button>
      </form>

      <h2>Classes</h2>
      <ul className="club-cards" aria-label="Classes">
        {state.classes.map((c) => {
          const upcoming = state.sessions.filter((x) => x.classId === c.id && x.status === "scheduled" && Date.parse(x.startsAt) > now.getTime()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
          return (
            <li key={c.id} className="club-card" data-testid="class-template" data-class={c.name}>
              <h3>{c.name}</h3>
              <p className="club-meta">
                {c.defaultCapacity} chairs · {c.defaultMinutes} minutes
                {c.roomItemId ? ` · ${state.items.find((i) => i.id === c.roomItemId)?.name}` : ""}
                {c.instructor ? ` · ${c.instructor}` : ""}
              </p>
              {upcoming.length === 0 ? (
                <p>No upcoming sessions.</p>
              ) : (
                <ul className="club-list">
                  {upcoming.slice(0, 6).map((x) => (
                    <li key={x.id}>
                      <Link href={`/club/classes/${x.id}`}>
                        {formatDayLong(pacificDate(new Date(x.startsAt)))}, {formatRange(x.startsAt, x.endsAt)}
                      </Link>
                    </li>
                  ))}
                  {upcoming.length > 6 && <li className="club-meta">and {upcoming.length - 6} more</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
