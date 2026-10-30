"use server";

import { addBoatOwner, inviteToBoat, removeFromBoat } from "@/club/engine/boat-access";
import { fullName } from "@/club/engine/queries";
import { error, ok, refusal, startStaffAction, textOf, type ActionResult } from "@/club/web-actions";

async function names(store: Awaited<ReturnType<typeof startStaffAction>>["store"], memberId: string, itemId: string) {
  const state = await store.read();
  const who = state.members.find((m) => m.id === memberId);
  return { who: who ? fullName(who) : "That member", boat: state.items.find((i) => i.id === itemId)?.name ?? "the boat" };
}

/** Staff name an owner of a private boat. Staff only; anyone else, and the live site, gets "page not found". */
export async function makeOwner(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const boat = textOf(formData, "boat", 60);
  const member = textOf(formData, "member", 60);
  if (!boat || !member) return error("Choose a boat and a person.");
  try {
    await addBoatOwner(store, ctx, { itemId: boat, memberId: member });
    const n = await names(store, member, boat);
    return ok(`${n.who} is now an owner of ${n.boat}.`);
  } catch (e) {
    return refusal(e);
  }
}

/** Staff invite someone on an owner's behalf. */
export async function inviteAsStaff(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const boat = textOf(formData, "boat", 60);
  const member = textOf(formData, "member", 60);
  if (!boat || !member) return error("Choose a boat and a person.");
  try {
    await inviteToBoat(store, ctx, { itemId: boat, memberId: member });
    const n = await names(store, member, boat);
    return ok(`${n.who} can now book and crew ${n.boat}.`);
  } catch (e) {
    return refusal(e);
  }
}

/** Staff take anyone, owner or invited, off a private boat. Their upcoming bookings on it are cancelled. */
export async function takeOffBoat(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startStaffAction();
  const access = textOf(formData, "access", 60);
  if (!access) return error("Choose who to take off.");
  try {
    const result = await removeFromBoat(store, ctx, { accessId: access });
    const n = await names(store, result.access.memberId, result.access.itemId);
    const bits = [result.cancelled > 0 ? `${result.cancelled} booking${result.cancelled === 1 ? "" : "s"} cancelled` : "", result.crewRemoved > 0 ? `${result.crewRemoved} crew seat${result.crewRemoved === 1 ? "" : "s"} removed` : ""].filter(Boolean);
    return ok(`${n.who} is off ${n.boat}${bits.length > 0 ? ` (${bits.join(", ")})` : ""}.`);
  } catch (e) {
    return refusal(e);
  }
}
