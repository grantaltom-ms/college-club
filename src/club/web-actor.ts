import { bookingBlockReason } from "./engine/eligibility";
import type { Viewer } from "./engine/availability";
import type { CurrentActor } from "./identity";

/** Who is looking, in the form the day view wants. */
export function viewerOf(actor: CurrentActor): Viewer {
  return actor.kind === "staff" ? { kind: "staff" } : { kind: "member", memberId: actor.member.id };
}

/** Why this person cannot make a new booking at all (their household ended, say), or null. */
export function blockedReason(actor: CurrentActor): string | null {
  return actor.kind === "member" ? bookingBlockReason(actor.member, actor.household) : null;
}
