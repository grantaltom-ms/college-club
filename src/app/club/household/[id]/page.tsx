import { notFound } from "next/navigation";
import { householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { canViewHousehold, getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { HouseholdView } from "../../HouseholdView";

export default async function HouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  await requireClub();
  const { id } = await params;
  const actor = await getCurrentActor();
  const state = await (await getClubStore()).read();
  const household = householdOf(state, id);
  // A household you may not see looks exactly like one that does not exist.
  if (!household || !canViewHousehold(actor, household.id)) notFound();
  return <HouseholdView state={state} household={household} viewerIsStaff={actor?.kind === "staff"} />;
}
