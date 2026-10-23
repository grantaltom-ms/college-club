import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { eventFieldsProblem } from "@/club/engine/events";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { pacificWall } from "@/club/time";
import { centsFromForm, dateParam, NOTICES, timeParam } from "@/club/web";
import { EventPlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: add an event. Editing and cancelling are on each event's own page. */
export default async function ManageEvents({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const query = await searchParams;
  const now = clubNow();

  // When the form comes back with the person's choices, explain in the engine's own words what is wrong.
  const date = dateParam(one(query.date));
  const start = timeParam(one(query.start));
  const end = timeParam(one(query.end));
  const limit = one(query.limit);
  const price = centsFromForm(one(query.price));
  let problem: string | null = null;
  if (date && start !== null && end !== null && price !== undefined && (limit === "" || /^\d{1,4}$/.test(limit))) {
    problem = eventFieldsProblem(
      { title: one(query.title), startsAt: pacificWall(date, start), endsAt: pacificWall(date, end), capacity: limit === "" ? null : Number(limit), priceCents: price },
      now,
    );
  }
  const notice = NOTICES[one(query.notice) === "invalid" && problem ? "" : one(query.notice)];

  return (
    <section>
      <h1>Add an event</h1>
      <EventPlaceholderNote />
      <p className="club-meta">After adding it you can edit it, see who is coming, cancel it, and download everyone&rsquo;s personal RSVP links from its page.</p>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {problem && (
        <p className="club-alert" role="alert" data-testid="event-problem">
          {problem}
        </p>
      )}
      <form method="post" action="/api/club/events/create" className="club-form" data-testid="event-form">
        <p>
          <label htmlFor="title">Title</label>
          <input id="title" name="title" type="text" maxLength={120} defaultValue={one(query.title)} required />
        </p>
        <p>
          <label htmlFor="description">What it is (optional)</label>
          <input id="description" name="description" type="text" maxLength={1000} defaultValue={one(query.description)} />
        </p>
        <p>
          <label htmlFor="location">Where (optional)</label>
          <input id="location" name="location" type="text" maxLength={200} defaultValue={one(query.location)} />
        </p>
        <p>
          <label htmlFor="date">Date</label>
          <input id="date" name="date" type="date" defaultValue={one(query.date)} required />
        </p>
        <p>
          <label htmlFor="start">Starts (Pacific)</label>
          <input id="start" name="start" type="time" defaultValue={one(query.start)} required />
        </p>
        <p>
          <label htmlFor="end">Ends (Pacific, the same day)</label>
          <input id="end" name="end" type="time" defaultValue={one(query.end)} required />
        </p>
        <p>
          <label htmlFor="limit">Limit on places, members and guests together (empty for no limit)</label>
          <input id="limit" name="limit" type="number" min={1} max={2000} defaultValue={one(query.limit)} />
        </p>
        <p>
          <label htmlFor="price">Price of one place in dollars (empty for not stated, 0 for free)</label>
          <input id="price" name="price" type="text" inputMode="decimal" defaultValue={one(query.price)} />
        </p>
        <p>
          <label htmlFor="replyByDate">Reply by, date (empty to use the usual deadline)</label>
          <input id="replyByDate" name="replyByDate" type="date" defaultValue={one(query.replyByDate)} />{" "}
          <label htmlFor="replyByTime" className="club-meta">
            time
          </label>{" "}
          <input id="replyByTime" name="replyByTime" type="time" defaultValue={one(query.replyByTime)} />
        </p>
        <button type="submit" className="club-button">
          Add event
        </button>
      </form>
      <p>
        <Link href="/club/events">Back to events</Link>
      </p>
    </section>
  );
}
