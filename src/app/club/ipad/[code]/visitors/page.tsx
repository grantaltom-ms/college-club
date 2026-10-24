import { notFound } from "next/navigation";
import { findHosts, HOST_SEARCH_MIN_LETTERS } from "@/club/engine/visitor-search";
import { ipadPath, ipadVisitorsMemberPath } from "@/club/engine/ipad-address";
import { requireClub } from "@/club/guard";
import { ipadCodeIsGenuine } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { AutoReturn } from "../../AutoReturn";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** How long the iPad waits, untouched, before it goes back to the start. */
const RETURN_AFTER_SECONDS = 30;

/**
 * Signing visitors in on the front-desk iPad, step one: find your own name. Nothing is listed until a few letters are typed,
 * and never more than a handful of names, so the shared screen cannot be used to browse the membership.
 */
export default async function IpadVisitors({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const { code } = await params;
  if (!ipadCodeIsGenuine(code)) notFound();

  const typed = one((await searchParams).q).slice(0, 60);
  const found = typed.trim() ? findHosts(await (await getClubStore()).read(), typed) : null;

  return (
    <section>
      <h1>Bringing visitors?</h1>
      <form method="get" role="search">
        <label className="ipad-search-label" htmlFor="ipad-host">
          Type your name, then press Find me
        </label>
        <input id="ipad-host" className="ipad-search" type="search" name="q" defaultValue={typed} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        <p>
          <button type="submit" className="club-button ipad-go">
            Find me
          </button>
        </p>
      </form>
      {found?.tooShort && (
        <p className="ipad-none" data-testid="ipad-host-short">
          Type at least {HOST_SEARCH_MIN_LETTERS} letters of your name.
        </p>
      )}
      {found && !found.tooShort && found.hosts.length === 0 && (
        <p className="ipad-none" data-testid="ipad-host-none">
          No member found with that name. Check the spelling, or ask club staff.
        </p>
      )}
      {found && found.hosts.length > 0 && (
        <ul className="ipad-names" aria-label="Members found" data-testid="ipad-hosts">
          {found.hosts.map((h) => (
            <li key={h.memberId}>
              <a className="ipad-name" href={ipadVisitorsMemberPath(code, h.memberId)}>
                {h.name}
                {h.household && <span className="ipad-household">{h.household}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {found?.more && (
        <p className="ipad-none" data-testid="ipad-host-more">
          More people match. Type more of your name.
        </p>
      )}
      <p>
        <a className="ipad-back" href={ipadPath(code)}>
          Back to check-in
        </a>
      </p>
      <AutoReturn href={ipadPath(code)} seconds={RETURN_AFTER_SECONDS} />
    </section>
  );
}
