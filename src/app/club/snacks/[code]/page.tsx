import { notFound } from "next/navigation";
import { snackPriceWords } from "@/club/engine/snacks";
import { snackMemberPath } from "@/club/engine/ipad-address";
import { findHosts, HOST_SEARCH_MIN_LETTERS } from "@/club/engine/visitor-search";
import { requireClub } from "@/club/guard";
import { snackCodeIsGenuine } from "@/club/identity";
import { SNACK_RULES } from "@/club/settings/snack-rules";
import { getClubStore } from "@/club/store/instance";
import { AutoReturn } from "../../ipad/AutoReturn";

type Search = Record<string, string | string[] | undefined>;
const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/**
 * The honor snack bar iPad, step one: find your own name. This is also the screen the iPad rests on, so it is the one every
 * other screen comes back to. Nothing is listed until a few letters are typed, and never more than a handful of names, so the
 * shared screen cannot be used to browse the membership. Every wrong address looks like a page that does not exist.
 */
export default async function SnackStart({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Search> }) {
  await requireClub();
  const { code } = await params;
  if (!snackCodeIsGenuine(code)) notFound();

  const typed = one((await searchParams).q).slice(0, 60);
  const found = typed.trim() ? findHosts(await (await getClubStore()).read(), typed) : null;

  return (
    <section>
      <h1>Honor snack bar</h1>
      <p className="ipad-done" data-testid="snack-price">
        {snackPriceWords(SNACK_RULES)}
      </p>
      <form method="get" role="search">
        <label className="ipad-search-label" htmlFor="snack-name">
          Type your name, then press Find me
        </label>
        <input id="snack-name" className="ipad-search" type="search" name="q" defaultValue={typed} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        <p>
          <button type="submit" className="club-button ipad-go">
            Find me
          </button>
        </p>
      </form>
      {found?.tooShort && (
        <p className="ipad-none" data-testid="snack-name-short">
          Type at least {HOST_SEARCH_MIN_LETTERS} letters of your name.
        </p>
      )}
      {found && !found.tooShort && found.hosts.length === 0 && (
        <p className="ipad-none" data-testid="snack-name-none">
          No member found with that name. Check the spelling, or ask club staff.
        </p>
      )}
      {found && found.hosts.length > 0 && (
        <ul className="ipad-names" aria-label="Members found" data-testid="snack-names">
          {found.hosts.map((h) => (
            <li key={h.memberId}>
              <a className="ipad-name" href={snackMemberPath(code, h.memberId)}>
                {h.name}
                {h.household && <span className="ipad-household">{h.household}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {found?.more && (
        <p className="ipad-none" data-testid="snack-name-more">
          More people match. Type more of your name.
        </p>
      )}
      <AutoReturn href={`/club/snacks/${code}`} seconds={SNACK_RULES.defaults.idleSeconds} />
    </section>
  );
}
