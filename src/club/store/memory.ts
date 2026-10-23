import { QUALIFICATIONS } from "../qualifications";
import type { ClubState } from "../types";

/** What the engine needs from storage. The in-memory copy and (from step 2) the database both fit this. */
export interface ClubStore {
  /** A snapshot. Changing it changes nothing in the store. */
  read(): Promise<ClubState>;
  /**
   * Runs one change as a single unit: either everything in `fn` is kept, or (if it throws) none of it.
   * Changes run one at a time, so two requests can never see each other half done.
   */
  transaction<T>(fn: (state: ClubState, newId: () => string) => Promise<T>): Promise<T>;
}

/** Permanent IDs that read the same on every start, so sample households keep their addresses. */
export function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

export class MemoryClubStore implements ClubStore {
  private state: ClubState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private newId: () => string = () => crypto.randomUUID()) {
    this.state = { households: [], members: [], qualifications: structuredClone(QUALIFICATIONS), memberQualifications: [], history: [], items: [], outOfService: [], bookings: [], classes: [], sessions: [], signups: [], events: [], rsvps: [] };
  }

  async read(): Promise<ClubState> {
    await this.queue;
    return structuredClone(this.state);
  }

  transaction<T>(fn: (state: ClubState, newId: () => string) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      const result = await fn(draft, this.newId);
      this.state = draft;
      return result;
    });
    // A failed change must not block the ones after it.
    this.queue = run.catch(() => undefined);
    return run;
  }
}
