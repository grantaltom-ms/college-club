import { notFound, redirect } from "next/navigation";
import { clubNow } from "@/club/clock";
import { checkInChoices } from "@/club/engine/attendance";
import { ipadPath } from "@/club/engine/ipad-address";
import { memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { ipadCodeIsGenuine } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { formatRange } from "@/club/time";
import { idParam, NOTICES } from "@/club/web";
import { AutoReturn } from "../../AutoReturn";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";
const KIND = { booking: "Boat or space", class: "Class", event: "Event" } as const;

/** How long the iPad waits, untouched, before it goes back to the start. */
const RETURN_AFTER_SECONDS = 20;

/**
 * One person's screen on the front-desk iPad: what they can check in for right now, each with one big button, and what they
 * have just checked in for. Looking at it records nothing; only the button does. A person with nothing to check in for is
 * sent back to the start, so the screen never says anything about someone who is not at the iPad.
 */
export default async function IpadMember({ params, searchParams }: { params: Promise<{ code: string; memberId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const { code, memberId } = await params;
  if (!ipadCodeIsGenuine(code)) notFound();
  if (!idParam(memberId)) notFound();

  const now = clubNow();
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const member = memberById(state, memberId);
  // Only what is open now, or just done: not what opens later.
  const choices = member ? checkInChoices(state, memberId, now, ATTENDANCE_RULES, 0) : [];
  if (!member || choices.length === 0) redirect(ipadPath(code));

  const notice = NOTICES[one(query.notice)];
  const justDone = choices.find((c) => c.id === idParam(one(query.checkedin)) && c.state.phase === "done");

  return (
    <section>
      <h1>Hi, {member.firstName}</h1>
      {justDone && (
        <p className="club-success ipad-note" role="status" data-testid="ipad-checked-in">
          You are checked in for {justDone.title}. Have a good one.
        </p>
      )}
      {notice && (
        <p className="club-alert ipad-note" role="alert">
          {notice}
        </p>
      )}
      <ul className="ipad-cards" aria-label="Your check-ins">
        {choices.map((c) => (
          <li key={c.id} className="ipad-card" data-testid="ipad-choice" data-phase={c.state.phase}>
            <h2>{c.title}</h2>
            <p>
              {KIND[c.kind]}, {formatRange(c.startsAt, c.endsAt)}
              {c.withNames.length > 0 ? `, with ${c.withNames.join(", ")}` : ""}
            </p>
            {c.state.phase === "open" ? (
              <form method="post" action="/api/club/ipad/check-in">
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="member" value={memberId} />
                <input type="hidden" name="kind" value={c.kind} />
                <input type="hidden" name="id" value={c.id} />
                <button type="submit" className="club-button ipad-go" aria-label={`Check in for ${c.title}`}>
                  I&apos;m here
                </button>
              </form>
            ) : (
              <p className="ipad-done" data-testid="ipad-done">
                Checked in
              </p>
            )}
          </li>
        ))}
      </ul>
      <p>
        <a className="ipad-back" href={ipadPath(code)}>
          That is not me
        </a>
      </p>
      <AutoReturn href={ipadPath(code)} seconds={RETURN_AFTER_SECONDS} />
    </section>
  );
}
