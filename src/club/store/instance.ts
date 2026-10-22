import { clubEnabled } from "../enabled";
import { buildSampleStore } from "../sample/club";
import type { MemoryClubStore } from "./memory";

const g = globalThis as unknown as { __ccsClubStore?: Promise<MemoryClubStore> };

/**
 * The one shared store for the running server. In Phase 1 it is always the in-memory sample club,
 * so nothing here can reach the live database. Step 2 adds the database store behind the same interface.
 */
export function getClubStore(): Promise<MemoryClubStore> {
  // Defense in depth: even a page that forgot its own check cannot read the club while it is switched off.
  if (!clubEnabled()) throw new Error("The member area is switched off.");
  return (g.__ccsClubStore ??= buildSampleStore());
}
