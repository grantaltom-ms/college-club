import { notFound } from "next/navigation";
import { pickerEnabled } from "@/club/enabled";
import { fullName, membersOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay } from "@/club/time";

/**
 * The test shortcut for trying the club as different invented people. It only exists where invented data is allowed
 * (see club/enabled.ts), never for real members; real people sign in by email link.
 */
export default async function ActAs() {
  await requireClub();
  if (!pickerEnabled()) notFound();
  const actor = await getCurrentActor();
  const state = await (await getClubStore()).read();
  const households = [...state.households].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <section>
      <h1>Act as a test member</h1>
      <p>Pick who you want to be. This test shortcut lets us try the club as different invented people; real people sign in by email link.</p>
      <form method="post" action="/api/club/act-as">
        <p>
          <button type="submit" name="actor" value="staff" className="club-button">
            Act as Test staff
          </button>
          {actor && (
            <button type="submit" name="actor" value="none" className="club-button club-button-quiet">
              Stop acting as anyone
            </button>
          )}
        </p>
        {households.map((h) => (
          <div key={h.id} className="club-card" data-testid="act-as-household">
            <h2>{h.displayName}</h2>
            <p className="club-meta">
              {h.membershipType} · {h.status === "ended" ? `membership ended ${formatDay(h.endedOn!)}` : `joined ${formatDay(h.joinedOn)}`}
            </p>
            <p className="club-actions">
              {membersOf(state, h.id).map((m) => (
                <button key={m.id} type="submit" name="actor" value={`member:${m.id}`} className="club-button">
                  Act as {fullName(m)}
                </button>
              ))}
            </p>
          </div>
        ))}
      </form>
    </section>
  );
}
