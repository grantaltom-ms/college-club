import { planMemberDetails, updateMemberDetails, type Ctx, type DetailField, type NewMember } from "../engine/households";
import type { ClubStore } from "../store/memory";
import type { Member } from "../types";
import type { AuthStore } from "./store";

/**
 * Staff correct an adult's details, and when the email changes the person is signed out everywhere (Grant, Oct 23).
 * The building comparison: changing the lock on a unit. Old keys stop working, and the tenant uses the new address to get
 * a new one. A sign-in link already sent to the old address dies by itself, because a link only ever opens whoever has that
 * address on file at the moment it is used.
 *
 * The club's records and the keys are kept in separate stores, so this cannot be one all-or-nothing change. The order is
 * chosen so the failure that can happen is the safe one: the sign-out comes first, after the change has been checked and
 * before it is made, so a failure there changes nothing and staff can simply try again; and it is repeated afterwards, in
 * case someone signed in with the old address in between.
 */
export async function editMemberDetails(
  store: ClubStore,
  auth: AuthStore,
  ctx: Ctx,
  memberId: string,
  input: NewMember,
): Promise<{ member: Member; changed: DetailField[]; signInChanged: boolean; signedOut: number }> {
  const plan = planMemberDetails(await store.read(), ctx, memberId, input);
  let signedOut = 0;
  if (plan.signInChanged) signedOut += await auth.revokeSessionsFor({ kind: "member", memberId }, ctx.now);
  const result = await updateMemberDetails(store, ctx, memberId, input);
  if (result.signInChanged) signedOut += await auth.revokeSessionsFor({ kind: "member", memberId }, ctx.now);
  return { ...result, signedOut };
}
