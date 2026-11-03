import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";
import { householdOf, membersOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { readClubOnce } from "@/club/store/read-once";
import { formatDay } from "@/club/time";
import { HouseholdView } from "./HouseholdView";

export default async function ClubHome() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) {
    return (
      <section className="club-empty">
        <h1>Welcome</h1>
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

  const households = [...state.households].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <section>
      <header className="club-page-head">
        <div>
          <h1>Households</h1>
          <p className="club-meta">{households.length} test households. Staff see all of them.</p>
        </div>
        <p className="club-page-actions">
          <Link href="/club/admin/households/new" className="club-button club-button-link" data-testid="add-household-link">
            Add a household
          </Link>
        </p>
      </header>
      <ul className="club-cards" aria-label="All households">
        {households.map((h) => {
          const adults = membersOf(state, h.id).filter((m) => m.status === "active").length;
          return (
            <li key={h.id} className="club-card" data-testid="household-row">
              <h3>
                <Link href={`/club/household/${h.id}`}>{h.displayName}</Link>
              </h3>
              <p className="club-meta">
                {h.membershipType} · {h.status === "ended" ? `ended ${formatDay(h.endedOn!)}` : `${adults} active adult${adults === 1 ? "" : "s"}`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
