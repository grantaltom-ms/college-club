import Link from "next/link";
import { notFound } from "next/navigation";
import { clubNow } from "@/club/clock";
import { departurePreview } from "@/club/engine/departure";
import { fullName, householdOf, membersOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { formatDay } from "@/club/time";
import { NOTICES } from "@/club/web";
import { DeparturePreviewView } from "../../../DeparturePreviewView";
import { SignedOut } from "../../../../SignedOut";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

/** Staff only: the last look before a membership ends. Nothing happens until the red button is pressed. */
export default async function EndMembership({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const actor = await getCurrentActor();
  if (!actor) return <SignedOut />;
  if (actor.kind !== "staff") notFound();
  const { id } = await params;
  const state = await (await getClubStore()).read();
  const household = householdOf(state, id);
  if (!household) notFound();
  const notice = NOTICES[one((await searchParams).notice)];

  if (household.status === "ended") {
    return (
      <section>
        <h1>{household.displayName}</h1>
        <p>This membership already ended on {formatDay(household.endedOn!)}. Nothing in it can be changed.</p>
        <p>
          <Link href={`/club/household/${household.id}`}>Back to the household</Link>
        </p>
      </section>
    );
  }
  const adults = membersOf(state, household.id).filter((m) => m.status === "active");
  const preview = departurePreview(state, adults.map((m) => m.id), clubNow());
  return (
    <section>
      <h1>End the membership of {household.displayName}?</h1>
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      <p>
        Ending a membership is final. Today is its last day. {adults.length === 1 ? "The adult in it" : `All ${adults.length} adults in it`} can no longer book:{" "}
        {adults.map((a) => fullName(a)).join(", ")}. A household that comes back later is added as a new household.
      </p>
      <DeparturePreviewView preview={preview} />
      <form method="post" action="/api/club/households/end" data-testid="end-form">
        <input type="hidden" name="household" value={household.id} />
        <button type="submit" className="club-button club-button-danger">
          Yes, end this membership
        </button>{" "}
        <Link href={`/club/household/${household.id}`} className="club-button club-button-quiet" style={{ display: "inline-block", lineHeight: "28px" }}>
          No, go back
        </Link>
      </form>
    </section>
  );
}
