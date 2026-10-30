import { notFound } from "next/navigation";
import { clubNow } from "./clock";
import { clubEnabled } from "./enabled";
import { ClubError } from "./errors";
import type { Ctx } from "./engine/households";
import { getCurrentActor, toEngineActor } from "./identity";
import { getClubStore } from "./store/instance";

/** What a staff screen's button comes back with: nothing yet, it worked, or it was refused (in the engine's own words). */
export type ActionResult = { kind: "idle" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

/**
 * What every staff server action starts with, before it reads anything from the form: the member area must be on and the
 * person must be club staff. Anyone else, and the live site, gets the same "page not found" as every other member-area page.
 */
export async function startStaffAction(): Promise<{ ctx: Ctx; store: Awaited<ReturnType<typeof getClubStore>> }> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "staff") notFound();
  return { ctx: { actor: toEngineActor(actor), now: clubNow() }, store: await getClubStore() };
}

/**
 * What a member's server action starts with, before it reads anything from the form: the member area must be on and the person
 * must be a signed-in member (not staff, not nobody). Anyone else, and the live site, gets "page not found". What the member may
 * do with it is then decided by the engine, not here.
 */
export async function startMemberAction(): Promise<{ ctx: Ctx; store: Awaited<ReturnType<typeof getClubStore>>; memberId: string }> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (actor?.kind !== "member") notFound();
  return { ctx: { actor: toEngineActor(actor), now: clubNow() }, store: await getClubStore(), memberId: actor.member.id };
}

/**
 * What a server action open to everyone signed in starts with, members and staff alike (filing a damage report): the member area
 * must be on and somebody must be signed in. Nobody, and the live site, gets "page not found". The engine decides what each may do.
 */
export async function startSignedInAction(): Promise<{ ctx: Ctx; store: Awaited<ReturnType<typeof getClubStore>> }> {
  if (!clubEnabled()) notFound();
  const actor = await getCurrentActor();
  if (!actor) notFound();
  return { ctx: { actor: toEngineActor(actor), now: clubNow() }, store: await getClubStore() };
}

/** A refusal turned into the screen's message. Anything that is not a refusal (the database is down) is passed on, not hidden. */
export function refusal(e: unknown): ActionResult {
  if (e instanceof ClubError) return { kind: "error", message: e.message };
  throw e;
}

export const ok = (message: string): ActionResult => ({ kind: "ok", message });
export const error = (message: string): ActionResult => ({ kind: "error", message });

/** A text field from a form, trimmed and capped. Anything that is not text reads as empty. */
export function textOf(form: FormData, name: string, max = 300): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
