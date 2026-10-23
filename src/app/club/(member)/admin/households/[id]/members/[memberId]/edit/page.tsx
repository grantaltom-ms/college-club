import Link from "next/link";
import { notFound } from "next/navigation";
import { memberFieldsProblem } from "@/club/engine/households";
import { fullName, householdOf, memberById } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { NOTICES } from "@/club/web";
import { SignedOut } from "@/app/club/(member)/SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: correct an adult's name, email or phone. */
export default async function EditAdult({ params, searchParams }: { params: Promise<{ id: string; memberId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { id, memberId } = await params;
  const query = await searchParams;
  const state = await (await getClubStore()).read();
  const household = householdOf(state, id);
  const member = memberById(state, memberId);
  if (!household || !member || member.householdId !== household.id) notFound();
  const back = (
    <p>
      <Link href={`/club/household/${household.id}`}>Back to the household</Link>
    </p>
  );

  if (household.status === "ended" || member.status !== "active") {
    return (
      <section>
        <h1>{fullName(member)}</h1>
        <p>{household.status === "ended" ? "This membership has ended, so nothing in it can be changed." : `${fullName(member)} is no longer on this household's membership, so their details cannot be changed.`}</p>
        {back}
      </section>
    );
  }

  // After a mistake the form comes back with what was typed; the problem is worded by the engine, not taken from the address.
  const comingBack = one(query.notice) === "invalid";
  const typed = { firstName: one(query.firstName), lastName: one(query.lastName), email: one(query.email), phone: one(query.phone) };
  const shown = comingBack ? typed : { firstName: member.firstName, lastName: member.lastName, email: member.email, phone: member.phone };
  const problem = comingBack ? memberFieldsProblem(typed) : null;
  const notice = comingBack ? undefined : NOTICES[one(query.notice)];
  return (
    <section>
      <h1>Change details for {fullName(member)}</h1>
      <p className="club-meta">{household.displayName}. Each change is written to the household&apos;s file, with what it said before.</p>
      {problem && (
        <p className="club-alert" role="alert" data-testid="edit-problem">
          {problem}
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert" data-testid="edit-notice">
          {notice}
        </p>
      )}
      <form method="post" action="/api/club/households/update-member" className="club-form" data-testid="edit-adult-form">
        <input type="hidden" name="household" value={household.id} />
        <input type="hidden" name="member" value={member.id} />
        <p>
          <label htmlFor="e-first">First name</label>
          <input id="e-first" name="firstName" type="text" maxLength={80} defaultValue={shown.firstName} required />
        </p>
        <p>
          <label htmlFor="e-last">Last name</label>
          <input id="e-last" name="lastName" type="text" maxLength={80} defaultValue={shown.lastName} required />
        </p>
        <p>
          <label htmlFor="e-email">Email</label>
          <input id="e-email" name="email" type="email" maxLength={200} defaultValue={shown.email} required />
        </p>
        <p className="club-meta">
          This is the address {member.firstName} signs in with. If you change it, {member.firstName} is signed out of every device and signs in again with the new address.
        </p>
        <p>
          <label htmlFor="e-phone">Phone (optional)</label>
          <input id="e-phone" name="phone" type="tel" maxLength={40} defaultValue={shown.phone} />
        </p>
        <p>
          <button type="submit" className="club-button">
            Save details
          </button>{" "}
          <Link href={`/club/household/${household.id}`} className="club-button club-button-quiet" style={{ display: "inline-block", lineHeight: "28px" }}>
            Cancel
          </Link>
        </p>
      </form>
    </section>
  );
}
