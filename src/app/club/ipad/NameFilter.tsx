"use client";

import { useState } from "react";
import { nameMatches } from "@/club/name-filter";

export interface IpadPerson {
  id: string;
  name: string;
  /** Only when two people listed share a name: their household, so they can be told apart. */
  household: string | null;
}

/**
 * The iPad's list of names, narrowed as the person types the first letters of theirs. The list is already only the people
 * with something to check in for right now; typing just saves scrolling. `hrefs` are the addresses of each person's screen.
 */
export function NameFilter({ people, hrefs }: { people: IpadPerson[]; hrefs: Record<string, string> }) {
  const [typed, setTyped] = useState("");
  const shown = people.filter((p) => nameMatches(p.name, typed));
  return (
    <div>
      <label className="ipad-search-label" htmlFor="ipad-search">
        Type the first letters of your name
      </label>
      <input
        id="ipad-search"
        className="ipad-search"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      {shown.length === 0 ? (
        <p className="ipad-none" data-testid="ipad-no-match">
          No one with that name has a check-in open right now. If you are on the list for today, ask club staff.
        </p>
      ) : (
        <ul className="ipad-names" aria-label="People who can check in now" data-testid="ipad-names">
          {shown.map((p) => (
            <li key={p.id}>
              <a className="ipad-name" href={hrefs[p.id]}>
                {p.name}
                {p.household && <span className="ipad-household">{p.household}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
