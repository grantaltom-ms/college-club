import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { departurePreview } from "@/club/engine/departure";
import { fullName, householdOf, memberById, membersOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { NOTICES } from "@/club/web";
import { DeparturePreviewView } from "../../../../DeparturePreviewView";
import { SignedOut } from "../../../../../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: the last look before an adult is taken off a household that carries on. */
export default async function RemoveAdult({ params, searchParams }: { params: Promise<{ id: string; memberId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { id, memberId } = await params;
  const state = await (await getClubStore()).read();
  const household = householdOf(state, id);
  const member = memberById(state, memberId);
  if (!household || !member || member.householdId !== household.id) notFound();
  const notice = NOTICES[one((await searchParams).notice)];
  const back = (
    <p>
      <Link href={`/club/household/${household.id}`}>Back to the household</Link>
    </p>
  );

  if (household.status === "ended" || member.status !== "active") {
    return (
      <section>
        <h1>{fullName(member)}</h1>
        <p>{household.status === "ended" ? "This membership has ended, so nothing in it can be changed." : `${fullName(member)} is already off this household's membership.`}</p>
        {back}
      </section>
    );
  }
  const others = membersOf(state, household.id).filter((m) => m.status === "active" && m.id !== member.id);
  if (others.length === 0) {
    return (
      <section>
        <h1>{fullName(member)} is the last adult</h1>
        <p>
          A household needs at least one adult. To remove {fullName(member)}, <Link href={`/club/admin/households/${household.id}/end`}>end the whole membership</Link> instead.
        </p>
        {back}
      </section>
    );
  }
  const preview = departurePreview(state, [member.id], clubNow());
  return (
    <section>
      <h1>Remove {fullName(member)} from {household.displayName}?</h1>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      <p>
        {fullName(member)} is blocked from new bookings at once. The household and everyone else in it carry on.
      </p>
      <DeparturePreviewView preview={preview} />
      <form method="post" action="/api/club/households/remove-member" className="club-form" data-testid="remove-form">
        <input type="hidden" name="household" value={household.id} />
        <input type="hidden" name="member" value={member.id} />
        {member.role === "primary" && (
          <p>
            <label htmlFor="newPrimary">{fullName(member)} is the primary adult. Who becomes the primary adult?</label>
            <select id="newPrimary" name="newPrimary" required>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {fullName(o)}
                </option>
              ))}
            </select>
          </p>
        )}
        <button type="submit" className="club-button club-button-danger">
          Yes, remove {fullName(member)}
        </button>{" "}
        <Link href={`/club/household/${household.id}`} className="club-button club-button-quiet" style={{ display: "inline-block", lineHeight: "28px" }}>
          No, go back
        </Link>
      </form>
    </section>
  );
}
