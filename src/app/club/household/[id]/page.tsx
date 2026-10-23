import { notFound } from "next/navigation";
import { householdOf } from "@/club/engine/queries";
import { requireClub } from "@/club/guard";
import { canViewHousehold, getCurrentActor } from "@/club/identity";
import { getClubStore } from "@/club/store/instance";
import { HOUSEHOLD_CHANGES, NOTICES } from "@/club/web";
import { HouseholdDesk } from "../../admin/HouseholdDesk";
import { HouseholdView } from "../../HouseholdView";

const one = (p: string | string[] | undefined) => (Array.isArray(p) ? p[0] : p) ?? "";

export default async function HouseholdPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireClub();
  const { id } = await params;
  const query = await searchParams;
  const actor = await getCurrentActor();
  const state = await (await getClubStore()).read();
  const household = householdOf(state, id);
  // A household you may not see looks exactly like one that does not exist.
  if (!household || !canViewHousehold(actor, household.id)) notFound();
  const staff = actor?.kind === "staff";
  // What the page may say about a change comes from a short list, never from the address itself.
  const changed = staff ? HOUSEHOLD_CHANGES[one(query.changed)] : undefined;
  const notice = staff && one(query.notice) !== "invalid" ? NOTICES[one(query.notice)] : undefined;
  const typed = { firstName: one(query.firstName), lastName: one(query.lastName), email: one(query.email), phone: one(query.phone) };
  const hasTyped = Boolean(typed.firstName || typed.lastName || typed.email || typed.phone);
  return (
    <>
      {changed && (
        <p className="club-success" role="status" data-testid="changed">
          {changed}
        </p>
      )}
      {notice && (
        <p className="club-alert" role="alert">
          {notice}
        </p>
      )}
      <HouseholdView state={state} household={household} viewerIsStaff={staff} />
      {staff && <HouseholdDesk state={state} household={household} typed={hasTyped ? typed : null} problem={one(query.notice) === "invalid"} />}
    </>
  );
}
