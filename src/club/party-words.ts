import { formatMinutes } from "./time";

/**
 * The words around choosing how many people are coming to an event: what the screen says as the number goes up and down,
 * and what the button says. Plain functions with no server code in them, so the same words are used by the page when it is
 * built on the server and by the little number picker in the browser. A "spot" is one person, the member or a guest.
 */

export interface PartyFacts {
  /** People in the party, counting the member. */
  people: number;
  /** Spots left, or null when the event has no limit. */
  left: number | null;
  /** True when the event has a waitlist at all. */
  waitlistOpen: boolean;
  /** How many more parties the waitlist can take. 0 means it is full. */
  waitlistRoom: number;
  /** Minutes a place on the waitlist is held after the last button press. 0 means it never runs out. */
  holdMinutes: number;
}

export type PartyOutcome = "room" | "waitlist" | "full";

/** Whether this party gets spots now, can only join the waitlist, or can do neither. */
export function partyOutcome(f: PartyFacts): PartyOutcome {
  if (f.left === null || f.people <= f.left) return "room";
  return f.waitlistOpen && f.waitlistRoom > 0 ? "waitlist" : "full";
}

const spots = (n: number) => `${n} ${n === 1 ? "spot" : "spots"}`;

/** "There are only 2 spots available." / "There is only 1 spot available." / "There are no spots available." */
export function onlySpotsText(left: number): string {
  if (left === 0) return "There are no spots available.";
  return left === 1 ? "There is only 1 spot available." : `There are only ${left} spots available.`;
}

const spotsAvailableText = (left: number) => (left === 1 ? "There is 1 spot available." : `There are ${left} spots available.`);

/** "Your place on the waitlist will be removed in 1 hour unless you press Keep my place." (empty if places never run out) */
export function holdSentence(holdMinutes: number, at?: string): string {
  if (holdMinutes <= 0) return "";
  return `Your place on the waitlist will be removed in ${formatMinutes(holdMinutes)}${at ? `, at ${at}` : ""}, unless you press Keep my place.`;
}

export interface PartyScreen {
  outcome: PartyOutcome;
  /** What to say under the number picker, before anyone presses a button. */
  notice: string;
  /** The main button. */
  submitLabel: string;
  /** False when the main button should not be offered (the event is full and there is no waitlist room). */
  canSubmit: boolean;
  /** When the whole party will not fit but a smaller one would: that number, for an "RSVP for N instead" button. */
  insteadPeople: number | null;
}

/** What the RSVP form says and offers for this party size. */
export function describeParty(f: PartyFacts): PartyScreen {
  const outcome = partyOutcome(f);
  if (outcome === "room") {
    return { outcome, notice: f.left === null ? "" : `${spotsAvailableText(f.left)} There is room for your party.`, submitLabel: "RSVP", canSubmit: true, insteadPeople: null };
  }
  const left = f.left ?? 0;
  const lower = left > 0 ? ` To RSVP now, lower the number to ${left}.` : "";
  const insteadPeople = left > 0 ? left : null;
  if (outcome === "waitlist") {
    const hold = holdSentence(f.holdMinutes);
    return {
      outcome,
      notice: `${onlySpotsText(left)} There is a waitlist.${lower} Or join the waitlist for ${f.people}.${hold ? ` ${hold}` : ""}`,
      submitLabel: `Join the waitlist for ${f.people}`,
      canSubmit: true,
      insteadPeople,
    };
  }
  return {
    outcome,
    notice: `${onlySpotsText(left)} ${f.waitlistOpen ? "The waitlist is full too." : "There is no waitlist."}${left > 0 ? lower : " This event is full."}`,
    submitLabel: "RSVP",
    canSubmit: false,
    insteadPeople,
  };
}

/** What a member is told right after joining the waitlist with a party that did not fit. */
export function afterJoiningWaitlist(input: { people: number; left: number | null; holdMinutes: number; until?: string; place: number }): string {
  const left = input.left ?? 0;
  const ifOnly = left > 0 ? ` If only ${spots(left)} would work for your party, change your party to ${left} below.` : "";
  const hold = holdSentence(input.holdMinutes, input.until);
  return `We don't have that many spots available. There is a waitlist, and you are on it, ${ordinalWords(input.place)} in line, for a party of ${input.people}.${ifOnly}${hold ? ` ${hold}` : ""}`;
}

function ordinalWords(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export interface ChangeFacts {
  /** The party size being tried. */
  people: number;
  /** The biggest party that gets spots right now (their own spots count), or null for no limit. */
  fits: number | null;
  /** True if they already have spots (going), false if they are waiting. */
  hasSpots: boolean;
}

export interface ChangeScreen {
  notice: string;
  canSubmit: boolean;
}

/** What the "change my party" form says for this party size. */
export function describeChange(f: ChangeFacts): ChangeScreen {
  if (f.fits === null || f.people <= f.fits) {
    return { notice: f.hasSpots ? "" : "This number fits now, so you would move up to a spot straight away.", canSubmit: true };
  }
  if (f.hasSpots) {
    return { notice: `${spots(f.fits)} ${f.fits === 1 ? "is" : "are"} available for your party, so it cannot get bigger than that.`, canSubmit: false };
  }
  return { notice: `${f.fits === 0 ? "There are no spots available" : `Only ${spots(f.fits)} ${f.fits === 1 ? "is" : "are"} available`}, so a party of ${f.people} stays on the waitlist.`, canSubmit: true };
}
