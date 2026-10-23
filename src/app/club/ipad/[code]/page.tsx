import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { checkInPeople } from "@/club/engine/attendance";
import { ipadMemberPath } from "@/club/engine/ipad-address";
import { requireClub } from "@/club/guard";
import { ipadCodeIsGenuine } from "@/club/identity";
import { ATTENDANCE_RULES } from "@/club/settings/attendance-rules";
import { getClubStore } from "@/club/store/instance";
import { formatMinutes } from "@/club/time";
import { NameFilter } from "../NameFilter";

/**
 * The front-desk iPad's start screen: only the people who have something they can check in for right now, with a box to
 * type the first letters of their name. Every wrong address looks like a page that does not exist.
 */
export default async function IpadStart({ params }: { params: Promise<{ code: string }> }) {
  await requireClub();
  const { code } = await params;
  if (!ipadCodeIsGenuine(code)) notFound();

  const state = await (await getClubStore()).read();
  const people = checkInPeople(state, clubNow(), ATTENDANCE_RULES);
  const opens = ATTENDANCE_RULES.defaults.checkInOpensMinutesBefore;

  return (
    <section>
      <h1>Who is checking in?</h1>
      {people.length === 0 ? (
        <p className="ipad-none" data-testid="ipad-empty">
          Nobody has a check-in open right now. Check-in opens {opens > 0 ? `${formatMinutes(opens)} before` : "at"} the start of your boat, space or class.
        </p>
      ) : (
        <NameFilter
          people={people.map((p) => ({ id: p.memberId, name: p.name, household: p.household }))}
          hrefs={Object.fromEntries(people.map((p) => [p.memberId, ipadMemberPath(code, p.memberId)]))}
        />
      )}
    </section>
  );
}
