import { describe, expect, it } from "vitest";
import { afterJoiningWaitlist, describeChange, describeParty, holdSentence, onlySpotsText, partyOutcome } from "./party-words";

const base = { people: 1, left: 10, waitlistOpen: true, waitlistRoom: 5, holdMinutes: 60 };

describe("choosing how many people are coming", () => {
  it("says there is room when the party fits, or when the event has no limit", () => {
    expect(describeParty({ ...base, people: 2, left: 2 })).toEqual({ outcome: "room", notice: "There are 2 spots available. There is room for your party.", submitLabel: "RSVP", canSubmit: true, insteadPeople: null });
    expect(describeParty({ ...base, left: 1 }).notice).toBe("There is 1 spot available. There is room for your party.");
    expect(describeParty({ ...base, left: null, people: 5 })).toMatchObject({ outcome: "room", notice: "", canSubmit: true });
  });

  it("says how many spots there are, that there is a waitlist, and offers the smaller party, when the party is too big", () => {
    const screen = describeParty({ ...base, people: 4, left: 2 });
    expect(screen.outcome).toBe("waitlist");
    expect(screen.notice).toBe("There are only 2 spots available. There is a waitlist. To RSVP now, lower the number to 2. Or join the waitlist for 4. Your place on the waitlist will be removed in 1 hour, unless you press Keep my place.");
    expect(screen).toMatchObject({ submitLabel: "Join the waitlist for 4", canSubmit: true, insteadPeople: 2 });
  });

  it("handles one spot, no spots, and a hold that never runs out", () => {
    expect(describeParty({ ...base, people: 2, left: 1 }).notice).toContain("There is only 1 spot available.");
    const none = describeParty({ ...base, people: 1, left: 0 });
    expect(none.notice).toBe("There are no spots available. There is a waitlist. Or join the waitlist for 1. Your place on the waitlist will be removed in 1 hour, unless you press Keep my place.");
    expect(none.insteadPeople).toBeNull();
    expect(describeParty({ ...base, people: 3, left: 1, holdMinutes: 0 }).notice).toBe("There is only 1 spot available. There is a waitlist. To RSVP now, lower the number to 1. Or join the waitlist for 3.");
    expect(describeParty({ ...base, people: 3, left: 1, holdMinutes: 90 }).notice).toContain("removed in 1 hour 30 minutes");
  });

  it("does not let the party go ahead when there is no waitlist, or the waitlist is full", () => {
    const noList = describeParty({ ...base, people: 3, left: 2, waitlistOpen: false });
    expect(noList).toMatchObject({ outcome: "full", canSubmit: false, insteadPeople: 2 });
    expect(noList.notice).toBe("There are only 2 spots available. There is no waitlist. To RSVP now, lower the number to 2.");
    const fullList = describeParty({ ...base, people: 1, left: 0, waitlistRoom: 0 });
    expect(fullList).toMatchObject({ outcome: "full", canSubmit: false, insteadPeople: null });
    expect(fullList.notice).toBe("There are no spots available. The waitlist is full too. This event is full.");
  });

  it("works out the outcome the same way the event rules do", () => {
    expect(partyOutcome({ ...base, people: 3, left: 3 })).toBe("room");
    expect(partyOutcome({ ...base, people: 4, left: 3 })).toBe("waitlist");
    expect(partyOutcome({ ...base, people: 4, left: 3, waitlistRoom: 0 })).toBe("full");
    expect(partyOutcome({ ...base, people: 4, left: 3, waitlistOpen: false })).toBe("full");
  });

  it("tells a member who just joined the waitlist what happened, in the words of the plan", () => {
    expect(afterJoiningWaitlist({ people: 4, left: 2, holdMinutes: 60, until: "2:00 pm", place: 1 })).toBe(
      "We don't have that many spots available. There is a waitlist, and you are on it, 1st in line, for a party of 4. If only 2 spots would work for your party, change your party to 2 below. Your place on the waitlist will be removed in 1 hour, at 2:00 pm, unless you press Keep my place.",
    );
    expect(afterJoiningWaitlist({ people: 3, left: 0, holdMinutes: 0, place: 2 })).toBe("We don't have that many spots available. There is a waitlist, and you are on it, 2nd in line, for a party of 3.");
  });

  it("words the hold and the spot counts", () => {
    expect(holdSentence(60, "2:00 pm")).toBe("Your place on the waitlist will be removed in 1 hour, at 2:00 pm, unless you press Keep my place.");
    expect(holdSentence(0)).toBe("");
    expect(onlySpotsText(0)).toBe("There are no spots available.");
  });
});

describe("changing the party on an RSVP", () => {
  it("lets someone with spots go up to what fits, and no further", () => {
    expect(describeChange({ people: 3, fits: 3, hasSpots: true })).toEqual({ notice: "", canSubmit: true });
    expect(describeChange({ people: 4, fits: 3, hasSpots: true })).toEqual({ notice: "3 spots are available for your party, so it cannot get bigger than that.", canSubmit: false });
    expect(describeChange({ people: 2, fits: 1, hasSpots: true }).notice).toBe("1 spot is available for your party, so it cannot get bigger than that.");
  });

  it("lets someone waiting try any size, saying whether it fits", () => {
    expect(describeChange({ people: 1, fits: 2, hasSpots: false })).toEqual({ notice: "This number fits now, so you would move up to a spot straight away.", canSubmit: true });
    expect(describeChange({ people: 4, fits: 2, hasSpots: false })).toEqual({ notice: "Only 2 spots are available, so a party of 4 stays on the waitlist.", canSubmit: true });
    expect(describeChange({ people: 3, fits: 0, hasSpots: false }).notice).toBe("There are no spots available, so a party of 3 stays on the waitlist.");
    expect(describeChange({ people: 9, fits: null, hasSpots: true })).toEqual({ notice: "", canSubmit: true });
  });
});
