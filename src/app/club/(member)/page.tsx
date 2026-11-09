import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";
import { SEARCH_MAX_CHARS, SEARCH_SHOW_MAX, searchHouseholds } from "@/club/engine/household-search";
import { householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { readClubOnce } from "@/club/store/read-once";
import { formatDay } from "@/club/time";
import { HouseholdView } from "./HouseholdView";
import { PageBand } from "./PageBand";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

export default async function ClubHome({ searchParams }: { searchParams: Promise<Search> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) {
    return (
      <section className="club-empty">
        <PageBand title="Welcome" />
        <p className="club-lead">
          Sign in to see your household, book boats and spaces, and join classes and events. There is no password: the club emails you a one-time link.
        </p>
        <p className="club-actions">
          <Link href="/club/sign-in" className="club-button club-button-link">
            Sign in
          </Link>
          {pickerEnabled() && (
            <Link href="/club/act-as" className="club-button club-button-quiet club-button-link">
              Choose a test member
            </Link>
          )}
        </p>
      </section>
    );
  }

  const state = await readClubOnce();
  if (actor.kind === "member") {
    const household = householdOf(state, actor.household.id)!;
    return <HouseholdView state={state} household={household} viewerIsStaff={false} />;
  }

  // Staff: the search box first. No list of every household, and no results until a search is run (typed and sent).
  const found = searchHouseholds(state, one((await searchParams).q));
  return (
    <section>
      <PageBand eyebrow="Staff" title="Households">
        <Link href="/club/admin/households/new" className="club-button club-button-link" data-testid="add-household-link">
          Add a household
        </Link>
      </PageBand>
      <form method="get" action="/club" className="club-form" role="search">
        <p>
          <label htmlFor="household-search">Search households</label>
          <input id="household-search" name="q" type="search" maxLength={SEARCH_MAX_CHARS} defaultValue={found.query} autoComplete="off" aria-describedby="household-search-hint" />
          <span className="club-meta" id="household-search-hint">
            A household name, a member&apos;s name, an email address or a phone number.
          </span>
        </p>
        <p>
          <button type="submit" className="club-button">
            Search
          </button>
        </p>
      </form>
      {found.query !== "" &&
        (found.total === 0 ? (
          <p data-testid="no-household-match">No household matches that search.</p>
        ) : (
          <>
            <p className="club-meta" data-testid="household-count">
              {found.total === 1 ? "1 household matches." : `${found.total} households match.`}
              {found.total > found.shown.length ? ` Showing the first ${SEARCH_SHOW_MAX}. Type more of the name to narrow it down.` : ""}
            </p>
            <ul className="club-cards" aria-label="Households found">
              {found.shown.map(({ household: h, activeAdults }) => (
                <li key={h.id} className="club-card" data-testid="household-row">
                  <h3>
                    <Link href={`/club/household/${h.id}`}>{h.displayName}</Link>
                  </h3>
                  <p className="club-meta">
                    {h.membershipType} · {h.status === "ended" ? `ended ${formatDay(h.endedOn!)}` : `${activeAdults} active adult${activeAdults === 1 ? "" : "s"}`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
