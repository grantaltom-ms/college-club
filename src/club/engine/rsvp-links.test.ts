import { describe, expect, it } from "vitest";
import { resolveRsvpLink } from "../identity";
import { csvCell, rsvpLinkPath, rsvpLinkToken, rsvpLinksCsv, verifyRsvpLinkToken } from "./rsvp-links";
import { createEvent } from "./events";
import { endHousehold, createHousehold } from "./households";
import { clubLedger } from "./ledger";
import { STORE_KINDS, at, fixtureFor, staffCtx } from "./testkit";

const SECRET = "test-only-secret-0123456789abcdef";
const OTHER = "another-test-secret-0123456789ab";
const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const ADA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("personal RSVP link codes", () => {
  it("are the same every time for the same event and member, and long enough to be unguessable", () => {
    const token = rsvpLinkToken(SECRET, EVENT, ADA);
    expect(rsvpLinkToken(SECRET, EVENT, ADA)).toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("differ for every event, every member and every secret", () => {
    const token = rsvpLinkToken(SECRET, EVENT, ADA);
    expect(rsvpLinkToken(SECRET, OTHER_EVENT, ADA)).not.toBe(token);
    expect(rsvpLinkToken(SECRET, EVENT, BEN)).not.toBe(token);
    expect(rsvpLinkToken(OTHER, EVENT, ADA)).not.toBe(token);
  });

  it("open only the exact event and member they were made for", () => {
    const token = rsvpLinkToken(SECRET, EVENT, ADA);
    expect(verifyRsvpLinkToken(SECRET, EVENT, ADA, token)).toBe(true);
    expect(verifyRsvpLinkToken(SECRET, OTHER_EVENT, ADA, token)).toBe(false);
    expect(verifyRsvpLinkToken(SECRET, EVENT, BEN, token)).toBe(false);
    expect(verifyRsvpLinkToken(OTHER, EVENT, ADA, token)).toBe(false);
  });

  it("refuse anything altered, cut short, stretched, empty or odd", () => {
    const token = rsvpLinkToken(SECRET, EVENT, ADA);
    const flipped = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    for (const bad of [flipped, token.slice(1), `${token}A`, "", " ", token.toUpperCase(), "💥".repeat(20), "x".repeat(10_000)]) {
      expect(verifyRsvpLinkToken(SECRET, EVENT, ADA, bad), bad.slice(0, 12)).toBe(false);
    }
  });

  it("refuse to be made with a weak secret", () => {
    expect(() => rsvpLinkToken("short", EVENT, ADA)).toThrow("at least 16 characters");
    expect(() => rsvpLinkToken("", EVENT, ADA)).toThrow("at least 16 characters");
  });

  it("make an address that holds the event, the member and the code", () => {
    expect(rsvpLinkPath(EVENT, ADA, "abc")).toBe(`/club/rsvp/${EVENT}/${ADA}/abc`);
  });
});

describe("spreadsheet cells", () => {
  it("are quoted when they hold a comma, a quote or a line break", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("cannot be read as a formula by a spreadsheet", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd"]) {
      expect(csvCell(evil).replace(/^"/, "").startsWith("'"), evil).toBe(true);
    }
  });
});

describe.each(STORE_KINDS)("RSVP links on the %s store", (kind) => {
  const fixture = fixtureFor(kind);

  it("belong to the right adult: a genuine link finds them, a forged or mismatched one finds no one", async () => {
    const f = await fixture();
    const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21) });
    const good = { eventId: event.id, memberId: f.m.Ada, token: rsvpLinkToken(SECRET, event.id, f.m.Ada) };
    expect((await resolveRsvpLink(f.store, SECRET, good))?.member.firstName).toBe("Ada");
    expect(await resolveRsvpLink(f.store, SECRET, { ...good, memberId: f.m.Ben })).toBeNull(); // Ada's code on Ben's address
    expect(await resolveRsvpLink(f.store, SECRET, { ...good, eventId: OTHER_EVENT })).toBeNull(); // another event
    expect(await resolveRsvpLink(f.store, SECRET, { ...good, token: "nope" })).toBeNull();
    expect(await resolveRsvpLink(f.store, OTHER, good)).toBeNull(); // the wrong server secret
    // A code made for someone who does not exist finds no one.
    expect(await resolveRsvpLink(f.store, SECRET, { eventId: event.id, memberId: BEN, token: rsvpLinkToken(SECRET, event.id, BEN) })).toBeNull();
  });

  it("make a staff CSV with one working link per active adult, and none for households that left", async () => {
    const f = await fixture();
    const event = await createEvent(f.store, staffCtx(), { title: "Dinner", startsAt: at(3, 18), endsAt: at(3, 21) });
    await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
    // A member whose name would be read as a formula, and one with a comma in the household name.
    await createHousehold(f.store, staffCtx(), {
      displayName: "The Odd, Names household",
      membershipType: "Resident",
      joinedOn: "2020-01-01",
      primary: { firstName: "=HYPERLINK(\"http://example.com\")", lastName: "Quote\"d", email: "odd@example.com" },
    });
    const csv = rsvpLinksCsv(await f.store.read(), event, SECRET, "https://club.example");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("email,first_name,last_name,household,rsvp_link");
    expect(lines).toHaveLength(1 + 3 + 1); // Ada, Ben, Cy and the odd one; the Reeds left
    expect(csv).not.toContain("dee@example.com");
    expect(csv).not.toContain("eli@example.com");
    const ada = lines.find((l) => l.startsWith("ada@example.com"))!;
    const link = ada.split(",").pop()!;
    expect(link).toBe(`https://club.example${rsvpLinkPath(event.id, f.m.Ada, rsvpLinkToken(SECRET, event.id, f.m.Ada))}`);
    expect(link.startsWith(`https://club.example/club/rsvp/${event.id}/${f.m.Ada}/`)).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain('"The Odd, Names household"');
  });
});
