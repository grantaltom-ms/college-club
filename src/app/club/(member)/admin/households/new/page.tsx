import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { householdFieldsProblem } from "@/club/engine/households";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { pacificDate } from "@/club/time";
import { MEMBERSHIP_TYPES } from "@/club/types";
import { NOTICES } from "@/club/web";
import { householdFromQuery } from "@/club/web-households";
import { SignedOut } from "../../../SignedOut";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: a new household joins. The primary adult is required; a second adult can be added here or later. */
export default async function NewHousehold({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();

  const query = await searchParams;
  const get = (name: string) => one(query[name]);
  const returned = one(query.notice) === "invalid";
  // When the form comes back with what was typed, explain in the engine's own words what is wrong.
  const problem = returned ? householdFieldsProblem(householdFromQuery(get)) : null;
  const notice = NOTICES[returned && problem ? "" : one(query.notice)];

  return (
    <section>
      <h1>Add a household</h1>
      <p className="club-meta">One household is one membership and one bill. Each adult gets their own record and, later, their own login.</p>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      {problem && (
        <p className="club-alert" role="alert" data-testid="household-problem">
          {problem}
        </p>
      )}
      <form method="post" action="/api/club/households/create" className="club-form" data-testid="household-form">
        <p>
          <label htmlFor="name">Household name</label>
          <input id="name" name="name" type="text" maxLength={120} placeholder="The Lindqvist household" defaultValue={get("name")} required />
        </p>
        <p>
          <label htmlFor="type">Membership type</label>
          <select id="type" name="type" defaultValue={get("type") || "Resident"}>
            {MEMBERSHIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="joined">Joined on</label>
          <input id="joined" name="joined" type="date" defaultValue={get("joined") || pacificDate(clubNow())} required />
        </p>
        <fieldset>
          <legend>Primary adult</legend>
          <p>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" name="firstName" type="text" maxLength={80} defaultValue={get("firstName")} required />
          </p>
          <p>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" name="lastName" type="text" maxLength={80} defaultValue={get("lastName")} required />
          </p>
          <p>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" maxLength={200} defaultValue={get("email")} required />
          </p>
          <p>
            <label htmlFor="phone">Phone (optional)</label>
            <input id="phone" name="phone" type="tel" maxLength={40} defaultValue={get("phone")} />
          </p>
        </fieldset>
        <fieldset>
          <legend>Second adult (optional)</legend>
          <p className="club-meta">Leave this empty for a one-adult household. More adults can be added from the household&rsquo;s page.</p>
          <p>
            <label htmlFor="firstName2">First name</label>
            <input id="firstName2" name="firstName2" type="text" maxLength={80} defaultValue={get("firstName2")} />
          </p>
          <p>
            <label htmlFor="lastName2">Last name</label>
            <input id="lastName2" name="lastName2" type="text" maxLength={80} defaultValue={get("lastName2")} />
          </p>
          <p>
            <label htmlFor="email2">Email</label>
            <input id="email2" name="email2" type="email" maxLength={200} defaultValue={get("email2")} />
          </p>
          <p>
            <label htmlFor="phone2">Phone (optional)</label>
            <input id="phone2" name="phone2" type="tel" maxLength={40} defaultValue={get("phone2")} />
          </p>
        </fieldset>
        <p>
          <button type="submit" className="club-button">
            Add household
          </button>
        </p>
      </form>
    </section>
  );
}
