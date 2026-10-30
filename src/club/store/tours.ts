import { ClubError } from "../errors";

/**
 * The public "Request a tour" cards. The building comparison: the cards visitors leave at the front desk. They are kept in the
 * order they arrive, nobody tears one up, and staff can mark a card "followed up" once. A request is from a stranger, not a
 * member, so it is a store of its own and never touches households, bookings or billing.
 */

export type TourStatus = "new" | "followed_up";

export interface TourRequest {
  id: string;
  /** ISO moment it arrived. */
  createdAt: string;
  name: string;
  /** Lower case, as the sign-in compares addresses. */
  email: string;
  /** As the person typed it, or empty. */
  phone: string;
  note: string;
  status: TourStatus;
  followedUpAt: string | null;
  followedUpBy: string | null;
}

export interface NewTourRequest {
  name: string;
  email: string;
  phone: string;
  note: string;
}

export interface TourLimits {
  /** The same email address is saved at most this many times in 24 hours. */
  maxPerEmailPerDay: number;
  /** The whole site saves at most this many requests in an hour. */
  maxPerHour: number;
}

export type TourAddResult = { saved: true; request: TourRequest } | { saved: false; reason: "already" | "busy" };

export interface TourStore {
  /**
   * Saves one request unless a limit is reached. The counting and the saving are one step, so two requests arriving together
   * cannot both slip past a limit. "already": this address has used up its requests for the day. "busy": the site as a whole has.
   */
  add(input: NewTourRequest, at: Date, limits: TourLimits): Promise<TourAddResult>;
  /** Newest first, with how many there are in all and how many nobody has followed up yet. */
  list(limit: number): Promise<{ items: TourRequest[]; total: number; newCount: number }>;
  /** Marks one request followed up, once. Refuses an unknown request, or one already marked. */
  markFollowedUp(id: string, by: string, at: Date): Promise<TourRequest>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

export class MemoryTourStore implements TourStore {
  private requests: TourRequest[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private newId: () => string = () => crypto.randomUUID()) {}

  private serial<T>(work: () => T): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  add(input: NewTourRequest, at: Date, limits: TourLimits): Promise<TourAddResult> {
    return this.serial(() => {
      const now = at.getTime();
      const sameAddress = this.requests.filter((r) => r.email === input.email && Date.parse(r.createdAt) > now - DAY_MS).length;
      if (sameAddress >= limits.maxPerEmailPerDay) return { saved: false, reason: "already" } as const;
      const lastHour = this.requests.filter((r) => Date.parse(r.createdAt) > now - HOUR_MS).length;
      if (lastHour >= limits.maxPerHour) return { saved: false, reason: "busy" } as const;
      const request: TourRequest = { id: this.newId(), createdAt: at.toISOString(), ...input, status: "new", followedUpAt: null, followedUpBy: null };
      this.requests.push(request);
      return { saved: true, request: structuredClone(request) } as const;
    });
  }

  list(limit: number) {
    return this.serial(() => ({
      items: structuredClone([...this.requests].reverse().slice(0, limit)),
      total: this.requests.length,
      newCount: this.requests.filter((r) => r.status === "new").length,
    }));
  }

  markFollowedUp(id: string, by: string, at: Date): Promise<TourRequest> {
    return this.serial(() => {
      const found = this.requests.find((r) => r.id === id);
      if (!found) throw new ClubError("not_found", "That tour request could not be found.");
      if (found.status === "followed_up") throw new ClubError("conflict", "That request was already marked as followed up.");
      found.status = "followed_up";
      found.followedUpAt = at.toISOString();
      found.followedUpBy = by;
      return structuredClone(found);
    });
  }
}
