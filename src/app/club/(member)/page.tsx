import Link from "next/link";
import { pickerEnabled } from "@/club/enabled";
import { householdOf, membersOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay } from "@/club/time";
import { HouseholdView } from "./HouseholdView";

export default async function ClubHome() {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) {
    return (
      <section>
        <h1>Welcome</h1>
        <p>
          <Link href="/club/sign-in">Sign in</Link> with your email address to see your household, book boats and spaces, and join classes and events.
        </p>
        {pickerEnabled() && (
          <p>
            Just trying it out? <Link href="/club/act-as">Choose a test member</Link> to see the club the way they would.
          </p>
        )}
      </section>
    );
  }

  const state = await (await getClubStore()).read();
  if (actor.kind === "member") {
    const household = householdOf(state, actor.household.id)!;
    return <HouseholdView state={state} household={household} viewerIsStaff={false} />;
  }

  const households = [...state.households].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <section>
      <h1>Households</h1>
      <p className="club-meta">{households.length} test households. Staff see all of them.</p>
      <p>
        <Link href="/club/admin/households/new" className="club-button" data-testid="add-household-link">
          Add a household
        </Link>
      </p>
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
