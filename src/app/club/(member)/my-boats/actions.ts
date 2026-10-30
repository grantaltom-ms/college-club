"use server";

import { inviteToBoat, removeFromBoat } from "@/club/engine/boat-access";
import { fullName } from "@/club/engine/queries";
import { error, ok, refusal, startMemberAction, textOf, type ActionResult } from "@/club/web-actions";

/** An owner invites another member to their boat. It works at once. The engine decides whether this person is an owner. */
export async function inviteToMyBoat(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startMemberAction();
  const boat = textOf(formData, "boat", 60);
  const member = textOf(formData, "member", 60);
  if (!boat || !member) return error("Choose a boat and a person.");
  try {
    const line = await inviteToBoat(store, ctx, { itemId: boat, memberId: member });
    const state = await store.read();
    const who = state.members.find((m) => m.id === line.memberId);
    const item = state.items.find((i) => i.id === line.itemId);
    return ok(`${who ? fullName(who) : "That member"} can now book and crew ${item?.name ?? "the boat"}.`);
  } catch (e) {
    return refusal(e);
  }
}

/** An owner takes someone they invited off their boat. Their upcoming bookings on it are cancelled. */
export async function removeFromMyBoat(formData: FormData): Promise<ActionResult> {
  const { ctx, store } = await startMemberAction();
  const access = textOf(formData, "access", 60);
  if (!access) return error("Choose who to take off.");
  try {
    const result = await removeFromBoat(store, ctx, { accessId: access });
    const state = await store.read();
    const who = state.members.find((m) => m.id === result.access.memberId);
    const item = state.items.find((i) => i.id === result.access.itemId);
    const bits = [result.cancelled > 0 ? `${result.cancelled} booking${result.cancelled === 1 ? "" : "s"} cancelled` : "", result.crewRemoved > 0 ? `${result.crewRemoved} crew seat${result.crewRemoved === 1 ? "" : "s"} removed` : ""].filter(Boolean);
    return ok(`${who ? fullName(who) : "That member"} is off ${item?.name ?? "the boat"}${bits.length > 0 ? ` (${bits.join(", ")})` : ""}.`);
  } catch (e) {
    return refusal(e);
  }
}
