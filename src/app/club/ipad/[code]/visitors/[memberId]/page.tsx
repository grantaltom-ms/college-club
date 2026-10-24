import { notFound, redirect } from "next/navigation";
import { clubNow } from "@/club/clock";
import { visitorsOnDay } from "@/club/engine/billing";
import { visitorRuleWords, visitorTotalWords } from "@/club/engine/billing-words";
import { ipadPath, ipadVisitorsPath } from "@/club/engine/ipad-address";
import { householdOf, memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { ipadCodeIsGenuine } from "@/club/identity";
import { BILLING_RULES } from "@/club/settings/billing-rules";
import { getClubStore } from "@/club/store/instance";
import { pacificDate } from "@/club/time";
import { idParam, NOTICES } from "@/club/web";
import { AutoReturn } from "../../../AutoReturn";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** How long the iPad waits, untouched, before it goes back to the start. */
const RETURN_AFTER_SECONDS = 30;

/**
 * Signing visitors in on the front-desk iPad, step two: how many people are you bringing today? Only a count is kept. The
 * rule is stated first, so the fee is never a surprise. Looking at the page records nothing; only the button does.
 */
export default async function IpadVisitorsMember({ params, searchParams }: { params: Promise<{ code: string; memberId: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const { code, memberId } = await params;
  if (!ipadCodeIsGenuine(code)) notFound();
  if (!idParam(memberId)) notFound();

  const now = clubNow();
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const member = memberById(state, memberId);
  const household = member ? householdOf(state, member.householdId) : undefined;
  if (!member || member.status !== "active" || household?.status !== "active") redirect(ipadVisitorsPath(code));

  const rules = BILLING_RULES.defaults;
  const today = pacificDate(now);
  const sofar = visitorsOnDay(state, memberId, today);
  const notice = NOTICES[one(query.notice)];
  const doneId = idParam(one(query.done));
  const done = doneId ? state.visitors.find((v) => v.id === doneId && v.memberId === memberId && v.day === today && v.status === "recorded" && v.via === "ipad") : undefined;
  const counts = Array.from({ length: rules.visitorsPerEntryMax }, (_, i) => i + 1);

  return (
    <section>
      <h1>Hi, {member.firstName}</h1>
      {done && (
        <p className="club-success ipad-note" role="status" data-testid="ipad-visitors-done">
          {done.visitors === 1 ? "1 visitor is" : `${done.visitors} visitors are`} signed in. {visitorTotalWords(sofar, rules)}
        </p>
      )}
      {notice && (
        <p className="club-alert ipad-note" role="alert" data-testid="ipad-notice">
          {notice}
        </p>
      )}
      <p data-testid="ipad-visitor-rule">{visitorRuleWords(rules)}</p>
      {sofar > 0 && !done && (
        <p data-testid="ipad-visitors-sofar">
          You have signed in {sofar} visitor{sofar === 1 ? "" : "s"} today.
        </p>
      )}
      <form method="post" action="/api/club/ipad/visitors">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="member" value={memberId} />
        <fieldset className="ipad-counts">
          <legend>How many visitors are you bringing?</legend>
          {counts.map((n) => (
            <label key={n} className="ipad-count">
              <input type="radio" name="visitors" value={n} required />
              <span>{n}</span>
            </label>
          ))}
        </fieldset>
        <button type="submit" className="club-button ipad-go">
          Sign in my visitors
        </button>
      </form>
      <p>
        <a className="ipad-back" href={ipadPath(code)}>
          That is not me
        </a>
      </p>
      <AutoReturn href={ipadPath(code)} seconds={RETURN_AFTER_SECONDS} />
    </section>
  );
}
