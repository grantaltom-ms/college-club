import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { accessKind, itemVisibleTo } from "@/club/engine/boat-access";
import { checkBooking, type Reason } from "@/club/engine/bookings";
import { describeRules } from "@/club/engine/describe";
import { meetsQualification } from "@/club/engine/eligibility";
import { fullName, householdOf } from "@/club/engine/queries";
import { ClubError } from "@/club/errors";
import { requireClub } from "@/club/guard";
import { getCurrentActor, toEngineActor } from "@/club/identity";
import { RULE_BOOK, rulesFor } from "@/club/settings/rulebook";
import { getClubStore } from "@/club/store/instance";
import { formatDayLong, formatRange, pacificDate } from "@/club/time";
import { idParam, idsParam, intParam, lengthChoices, momentParam, NOTICES } from "@/club/web";
import { blockedReason, viewerOf } from "@/club/web-actor";
import { PlaceholderNote } from "../../PlaceholderNote";
import { SignedOut } from "../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p);

export default async function NewBooking({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;

  const params = await searchParams;
  const state = await (await getClubStore()).read();
  const item = state.items.find((i) => i.id === idParam(params.item));
  const start = momentParam(params.start);
  if (!item || !start) notFound();
  // A private boat is not shown to anyone who is not on its list, so it is not found for them either.
  if (!itemVisibleTo(state, item, viewerOf(actor))) notFound();

  const { cls, rules, requiredQualification } = rulesFor(RULE_BOOK, item);
  const lengths = lengthChoices(rules);
  const asked = intParam(params.minutes, rules.minMinutes, rules.maxMinutes, 0);
  const minutes = lengths.includes(asked) ? asked : lengths.includes(60) ? 60 : lengths[0];
  const end = new Date(start.getTime() + minutes * 60000);

  const staff = actor.kind === "staff";
  const activeMembers = state.members
    .filter((m) => m.status === "active" && householdOf(state, m.householdId)?.status === "active")
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const forId = staff ? (activeMembers.find((m) => m.id === idParam(params.for))?.id ?? null) : actor.member.id;
  const crewIds = idsParam(params.crew).filter((id) => id !== forId);
  const wantsOverride = staff && one(params.override) === "1";
  const reason = (one(params.reason) ?? "").trim().slice(0, 300);
  const overriding = wantsOverride && reason !== "";

  // The rule check, in the same words the booking itself would use.
  let reasons: Reason[] | null = null;
  let problem: string | null = null;
  if (forId) {
    try {
      reasons = checkBooking(state, RULE_BOOK, { actor: toEngineActor(actor), now: clubNow() }, { itemId: item.id, bookerId: forId, startsAt: start, endsAt: end, crewIds });
    } catch (e) {
      if (!(e instanceof ClubError)) throw e;
      problem = e.message;
    }
  }
  const blocking = reasons?.filter((r) => !(overriding && r.overridable)) ?? [];
  const waived = reasons?.filter((r) => overriding && r.overridable) ?? [];
  const canBook = reasons !== null && blocking.length === 0 && !problem && !(wantsOverride && !reason);

  // Who can sit in the other seats: active members who hold the qualification.
  // On a private boat the other seats go to its owners and the people they invited instead.
  const crewChoices =
    cls.seats > 1
      ? activeMembers.filter((m) => m.id !== forId && (item.isPrivate ? accessKind(state, item.id, m.id) !== null : meetsQualification(state, m.id, requiredQualification)))
      : [];
  const explained = describeRules(state, RULE_BOOK, item);
  const memberBlocked = blockedReason(actor);
  const notice = NOTICES[one(params.notice) ?? ""];

  return (
    <section>
      <h1>Book {item.name}</h1>
      <PlaceholderNote />
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {memberBlocked && (
        <p className="club-alert" role="alert">
          You cannot make new bookings. {memberBlocked}
        </p>
      )}
      <p data-testid="booking-when">
        <strong>{formatDayLong(pacificDate(start))}</strong>, {formatRange(start, end)}
      </p>
      <p className="club-meta">
        <Link href={`/club/book?day=${pacificDate(start)}`}>Pick a different time</Link>
      </p>

      <form method="get" action="/club/book/new" className="club-form">
        <input type="hidden" name="item" value={item.id} />
        <input type="hidden" name="start" value={start.toISOString()} />
        {staff && (
          <p>
            <label htmlFor="for">Booking for</label>
            <select id="for" name="for" defaultValue={forId ?? ""}>
              <option value="">Choose a member</option>
              {activeMembers.filter((m) => !item.isPrivate || accessKind(state, item.id, m.id) !== null).map((m) => (
                <option key={m.id} value={m.id}>
                  {fullName(m)} ({householdOf(state, m.householdId)?.displayName})
                </option>
              ))}
            </select>
          </p>
        )}
        <p>
          <label htmlFor="minutes">Length</label>
          <select id="minutes" name="minutes" defaultValue={String(minutes)}>
            {lengths.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${Math.floor(m / 60)} hour ${m % 60} minutes`}
              </option>
            ))}
          </select>
        </p>
        {cls.seats > 1 && (
          <fieldset>
            <legend>
              Crew (up to {cls.seats - 1} other{cls.seats === 2 ? "" : "s"})
            </legend>
            {crewChoices.length === 0 && <p className="club-meta">{item.isPrivate ? "No other owner or invited member can crew this boat." : "No other member holds the qualification this boat needs."}</p>}
            {crewChoices.map((m) => (
              <label key={m.id} className="club-check">
                <input type="checkbox" name="crew" value={m.id} defaultChecked={crewIds.includes(m.id)} /> {fullName(m)}
              </label>
            ))}
          </fieldset>
        )}
        {staff && (
          <fieldset>
            <legend>Staff only</legend>
            <label className="club-check">
              <input type="checkbox" name="override" value="1" defaultChecked={wantsOverride} /> Book past the club rules (a lesson, for example)
            </label>
            <p>
              <label htmlFor="reason">Why (kept in the record)</label>
              <input id="reason" name="reason" type="text" maxLength={300} defaultValue={reason} />
            </p>
          </fieldset>
        )}
        <button type="submit" className="club-button club-button-quiet">
          Check my choices
        </button>
      </form>

      <section aria-label="Booking check" className="club-card" data-testid="check">
        {!forId && <p>Choose who this booking is for, then check.</p>}
        {problem && (
          <p role="alert" data-testid="check-problem">
            {problem}
          </p>
        )}
        {reasons && blocking.length > 0 && (
          <>
            <h2>This cannot be booked yet</h2>
            <ul data-testid="refusal-reasons">
              {blocking.map((r) => (
                <li key={r.code + r.message} data-code={r.code}>
                  {r.message}
                </li>
              ))}
            </ul>
          </>
        )}
        {wantsOverride && !reason && <p role="alert">Say why the rules are being set aside; the reason is kept in the record.</p>}
        {waived.length > 0 && (
          <>
            <h2>Rules that will be set aside</h2>
            <ul data-testid="waived-rules">
              {waived.map((r) => (
                <li key={r.code} data-code={r.code}>
                  {r.message}
                </li>
              ))}
            </ul>
          </>
        )}
        {canBook && (
          <>
            <p data-testid="check-ok">{waived.length > 0 ? "This can be booked as a staff override." : "This booking meets the rules."}</p>
            <form method="post" action="/api/club/bookings">
              <input type="hidden" name="item" value={item.id} />
              <input type="hidden" name="start" value={start.toISOString()} />
              <input type="hidden" name="minutes" value={minutes} />
              {forId && <input type="hidden" name="for" value={forId} />}
              {crewIds.map((id) => (
                <input key={id} type="hidden" name="crew" value={id} />
              ))}
              {overriding && <input type="hidden" name="override" value="1" />}
              {overriding && <input type="hidden" name="reason" value={reason} />}
              <button type="submit" className="club-button">
                Book {item.name}
              </button>
            </form>
          </>
        )}
      </section>

      <section aria-label="Rules" className="club-card">
        <h2>{explained.heading}</h2>
        {explained.placeholder && <p className="club-meta">These numbers are placeholders until club staff confirm them.</p>}
        <ul>
          {explained.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
