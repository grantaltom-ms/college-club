import { describe, expect, it, vi } from "vitest";
import type { Mailer } from "../auth/mail";
import { DEFAULT_REPLY_TO } from "../auth/mail-settings";
import { ClubError } from "../errors";
import { TOUR_RULES, type TourRules } from "../settings/tour-rules";
import { DAY_MS, HOUR_MS } from "../store/tours";
import type { Actor } from "../types";
import { NOW, STORE_KINDS, makeTourStore, openAnotherTours, tourUrls } from "./testkit";
import { NAME_MAX, NOTE_MAX, TOUR_WORDS, cleanTourRequest, listTourRequests, markTourFollowedUp, notifyAboutTourRequest, submitTourRequest, tourNoticeMail, tourNotifyAddress, type TourInput } from "./tours";

/**
 * The public Request a tour form, on both stores. Today is Wed Oct 28, 2026, 1 pm Pacific.
 */

const STAFF: Actor = { kind: "staff", label: "Alex Staffer" };
const MEMBER: Actor = { kind: "member", memberId: "m-1", label: "Ada Quill" };
const ID = /^[0-9a-f-]{36}$/;

const input = (over: Partial<TourInput> = {}): TourInput => ({ name: "Ada Quill", email: "ada@example.com", phone: "", note: "", website: "", ...over });
const rulesWith = (change: Partial<TourRules["defaults"]>): TourRules => ({ placeholder: true, defaults: { ...TOUR_RULES.defaults, ...change } });
const at = (ms: number) => new Date(NOW.getTime() + ms);

async function refusal(attempt: Promise<unknown>): Promise<ClubError> {
  try {
    await attempt;
  } catch (e) {
    if (e instanceof ClubError) return e;
    throw e;
  }
  throw new Error("expected a refusal, but it went through");
}

describe("cleaning what a visitor typed", () => {
  it("trims the name and email, closes up extra spaces, and writes the email the way the sign-in compares it", () => {
    const result = cleanTourRequest(input({ name: "   Ada    Quill  ", email: "  Ada.Quill@Example.COM " }));
    expect(result).toEqual({ ok: true, request: { name: "Ada Quill", email: "ada.quill@example.com", phone: "", note: "" } });
  });

  it("keeps a phone number as typed, and a note's own line breaks", () => {
    const result = cleanTourRequest(input({ phone: " (206) 555-0100 ", note: "Hello.\r\n\r\n\r\n\r\nSecond line.  Spaced." }));
    expect(result).toEqual({ ok: true, request: { name: "Ada Quill", email: "ada@example.com", phone: "(206) 555-0100", note: "Hello.\n\nSecond line. Spaced." } });
  });

  it("takes control characters out of every field (a line break in a name, a bell in a note)", () => {
    const result = cleanTourRequest(input({ name: "Ada\nQuill\u0007", note: "a\u0000b\u001fc" }));
    expect(result).toEqual({ ok: true, request: { name: "Ada Quill", email: "ada@example.com", phone: "", note: "a b c" } });
  });

  it("names every problem at once, in the words a visitor can act on", () => {
    expect(cleanTourRequest(input({ name: "  ", email: "not an email", phone: "call me", note: "x".repeat(NOTE_MAX + 1) }))).toEqual({
      ok: false,
      errors: { name: TOUR_WORDS.name, email: TOUR_WORDS.email, phone: TOUR_WORDS.phone, note: TOUR_WORDS.note },
    });
    expect(TOUR_WORDS.name).toBe("Please tell us your name.");
    expect(TOUR_WORDS.email).toBe("That email address does not look right. Please check it and try again.");
    expect(TOUR_WORDS.phone).toBe("That phone number does not look right. Leave it blank, or use digits like (206) 555-0100.");
    expect(TOUR_WORDS.note).toBe("Please keep your note to 500 characters or fewer.");
  });

  it("allows a name of exactly 120 characters and refuses 121", () => {
    expect(cleanTourRequest(input({ name: "x".repeat(NAME_MAX) })).ok).toBe(true);
    expect(cleanTourRequest(input({ name: "x".repeat(NAME_MAX + 1) }))).toEqual({ ok: false, errors: { name: TOUR_WORDS.nameLong } });
    expect(TOUR_WORDS.nameLong).toBe("Please use 120 characters or fewer for your name.");
  });

  it("allows a note of exactly 500 characters and refuses 501", () => {
    expect(cleanTourRequest(input({ note: "n".repeat(NOTE_MAX) })).ok).toBe(true);
    expect(cleanTourRequest(input({ note: "n".repeat(NOTE_MAX + 1) })).ok).toBe(false);
  });

  it.each([["(206) 555-0100"], ["206-555-0100"], ["206.555.0100"], ["+1 206 555 0100"], ["555-0100"], ["+44 20 7946 0958"], ["123456789012345"], ["1234567"]])("accepts the phone number %s", (phone) => {
    expect(cleanTourRequest(input({ phone })).ok).toBe(true);
  });

  it.each([["12345 6"], ["1234567890123456"], ["call me maybe"], ["206-555-0100 ext 5"], ["<script>"], ["x".repeat(41)], ["1".repeat(41)]])("refuses the phone number %s", (phone) => {
    expect(cleanTourRequest(input({ phone }))).toEqual({ ok: false, errors: { phone: TOUR_WORDS.phone } });
  });

  it.each([[undefined], [null], [42], [{}], [["a@b.co"]]])("treats %j as nothing typed instead of failing", (value) => {
    expect(cleanTourRequest({ name: value, email: value, phone: value, note: value, website: value })).toEqual({ ok: false, errors: { name: TOUR_WORDS.name, email: TOUR_WORDS.email } });
  });

  it("refuses addresses the sign-in could never use, so a typo cannot be saved as a lead", () => {
    for (const email of ["ada@@example.com", "ada quill@example.com", "ada..quill@example.com", "ada@example", "@example.com", ""]) {
      expect(cleanTourRequest(input({ email })), email).toEqual({ ok: false, errors: { email: TOUR_WORDS.email } });
    }
  });
});

describe.each(STORE_KINDS)("saving requests on the %s store", (kind) => {
  const open = () => makeTourStore(kind);
  const rules = rulesWith({});

  it("saves a request exactly as cleaned, new and unfollowed, and thanks the person by first name", async () => {
    const store = await open();
    const result = await submitTourRequest(store, rules, input({ name: "Ada Quill", phone: "(206) 555-0100", note: "Two of us." }), NOW);
    expect(result).toMatchObject({ ok: true, stored: true, firstName: "Ada" });
    if (!result.ok || !result.request) throw new Error("expected a saved request");
    expect(result.request).toEqual({ id: expect.stringMatching(ID), createdAt: NOW.toISOString(), name: "Ada Quill", email: "ada@example.com", phone: "(206) 555-0100", note: "Two of us.", status: "new", followedUpAt: null, followedUpBy: null });
    expect(await store.list(10)).toEqual({ items: [result.request], total: 1, newCount: 1 });
  });

  it.each([
    ["Ada Quill", "Ada"],
    ["O'Brien Pat", "O'Brien"],
    ["Jean-Luc Picard", "Jean-Luc"],
    ["Zoë Ng", "Zoë"],
    ["3dogs Inc", ""],
    ["(Ada) Quill", ""],
  ])("greets %j with %j", async (name, first) => {
    const store = await open();
    expect(await submitTourRequest(store, rules, input({ name }), NOW)).toMatchObject({ ok: true, firstName: first });
  });

  it("saves nothing, and says why, when something typed is wrong", async () => {
    const store = await open();
    expect(await submitTourRequest(store, rules, input({ email: "nope" }), NOW)).toEqual({ ok: false, errors: { email: TOUR_WORDS.email } });
    expect((await store.list(10)).total).toBe(0);
  });

  it("thanks a robot (the hidden box filled in) and saves nothing, so it learns nothing", async () => {
    const store = await open();
    expect(await submitTourRequest(store, rules, input({ website: "http://spam.example" }), NOW)).toMatchObject({ ok: true, stored: false, request: null });
    expect((await store.list(10)).total).toBe(0);
    // A box with only spaces in it is not a robot.
    expect(await submitTourRequest(store, rules, input({ website: "   " }), NOW)).toMatchObject({ ok: true, stored: true });
  });

  it("still checks a robot's other boxes, so a half-filled form is told what is wrong", async () => {
    const store = await open();
    expect(await submitTourRequest(store, rules, input({ name: "", website: "x" }), NOW)).toEqual({ ok: false, errors: { name: TOUR_WORDS.name } });
  });

  describe("the same email address", () => {
    it("is saved three times in 24 hours, then quietly thanked and not saved again", async () => {
      const store = await open();
      for (let i = 0; i < 3; i += 1) expect(await submitTourRequest(store, rules, input(), at(i * 1000)), `request ${i + 1}`).toMatchObject({ ok: true, stored: true });
      expect(await submitTourRequest(store, rules, input(), at(5000))).toMatchObject({ ok: true, stored: false, request: null });
      expect((await store.list(10)).total).toBe(3);
    });

    it("counts the same address however it is written", async () => {
      const store = await open();
      const tight = rulesWith({ maxPerEmailPerDay: 1 });
      await submitTourRequest(store, tight, input({ email: "ada@example.com" }), NOW);
      expect(await submitTourRequest(store, tight, input({ email: "  ADA@Example.COM " }), at(1000))).toMatchObject({ ok: true, stored: false });
      expect((await store.list(10)).total).toBe(1);
    });

    it("can ask again exactly 24 hours after the request that used the allowance, and not a moment before", async () => {
      const store = await open();
      const one = rulesWith({ maxPerEmailPerDay: 1 });
      await submitTourRequest(store, one, input(), NOW);
      expect(await submitTourRequest(store, one, input(), at(DAY_MS - 1))).toMatchObject({ stored: false });
      expect(await submitTourRequest(store, one, input(), at(DAY_MS))).toMatchObject({ stored: true });
    });

    it("does not use up anyone else's allowance", async () => {
      const store = await open();
      const one = rulesWith({ maxPerEmailPerDay: 1 });
      expect(await submitTourRequest(store, one, input({ email: "a@example.com" }), NOW)).toMatchObject({ stored: true });
      expect(await submitTourRequest(store, one, input({ email: "b@example.com" }), NOW)).toMatchObject({ stored: true });
    });
  });

  describe("the whole site", () => {
    it("takes 30 requests in an hour and asks the 31st person to phone", async () => {
      const store = await open();
      for (let i = 0; i < 30; i += 1) expect(await submitTourRequest(store, rules, input({ email: `p${i}@example.com` }), at(i * 1000)), `request ${i + 1}`).toMatchObject({ stored: true });
      expect(await submitTourRequest(store, rules, input({ email: "late@example.com" }), at(31000))).toEqual({ ok: false, busy: true });
      expect((await store.list(100)).total).toBe(30);
    });

    it("takes new requests again exactly an hour after the one that filled it, and not a moment before", async () => {
      const store = await open();
      const two = rulesWith({ maxPerHour: 2 });
      await submitTourRequest(store, two, input({ email: "a@example.com" }), NOW);
      await submitTourRequest(store, two, input({ email: "b@example.com" }), at(60_000));
      expect(await submitTourRequest(store, two, input({ email: "c@example.com" }), at(HOUR_MS - 1))).toEqual({ ok: false, busy: true });
      // The first request leaves the hour at NOW + 1h; the second is still inside it.
      expect(await submitTourRequest(store, two, input({ email: "c@example.com" }), at(HOUR_MS))).toMatchObject({ stored: true });
    });

    it("tells a person who already used their daily allowance the same thanks, even when the site is busy", async () => {
      const store = await open();
      const tight = rulesWith({ maxPerHour: 1, maxPerEmailPerDay: 1 });
      await submitTourRequest(store, tight, input({ email: "a@example.com" }), NOW);
      expect(await submitTourRequest(store, tight, input({ email: "a@example.com" }), at(1000))).toMatchObject({ ok: true, stored: false });
      expect(await submitTourRequest(store, tight, input({ email: "b@example.com" }), at(2000))).toEqual({ ok: false, busy: true });
    });
  });

  it("keeps counting right through a long, realistic run: 200 requests over 20 hours from 60 people", async () => {
    const store = await open();
    let saved = 0;
    for (let i = 0; i < 200; i += 1) {
      const result = await submitTourRequest(store, rules, input({ email: `person${i % 60}@example.com` }), at(i * 6 * 60_000));
      if (result.ok && result.stored) saved += 1;
    }
    // Each person may be saved 3 times in any 24 hours, and the 20 hours fit inside one day: 60 people x 3 = 180 of the 200 asks.
    expect(saved).toBe(180);
    expect((await store.list(500)).total).toBe(saved);
  });

  it("saves exactly three of ten requests that arrive together from one address", async () => {
    const store = await open();
    const results = await Promise.all(Array.from({ length: 10 }, () => submitTourRequest(store, rules, input(), NOW)));
    expect(results.filter((r) => r.ok && r.stored)).toHaveLength(3);
    expect((await store.list(10)).total).toBe(3);
  });

  it("saves exactly five of twenty requests that arrive together when the site takes five an hour", async () => {
    const store = await open();
    const five = rulesWith({ maxPerHour: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => submitTourRequest(store, five, input({ email: `p${i}@example.com` }), NOW)));
    expect(results.filter((r) => r.ok && r.stored)).toHaveLength(5);
    expect(results.filter((r) => !r.ok && "busy" in r)).toHaveLength(15);
    expect((await store.list(100)).total).toBe(5);
  });

  it.runIf(kind === "postgres")("holds the limits across two app servers sharing one database", async () => {
    const store = await open();
    const other = openAnotherTours(tourUrls.get(store)!);
    const five = rulesWith({ maxPerHour: 5 });
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => submitTourRequest(i % 2 === 0 ? store : other, five, input({ email: `p${i}@example.com` }), NOW)));
    expect(results.filter((r) => r.ok && r.stored)).toHaveLength(5);
    expect((await store.list(100)).total).toBe(5);
    const same = await Promise.all(Array.from({ length: 12 }, (_, i) => submitTourRequest(i % 2 === 0 ? store : other, rulesWith({ maxPerEmailPerDay: 2, maxPerHour: 1000 }), input({ email: "one@example.com" }), at(2 * HOUR_MS))));
    expect(same.filter((r) => r.ok && r.stored)).toHaveLength(2);
  });

  describe("what staff see", () => {
    async function threeRequests() {
      const store = await open();
      const ids: string[] = [];
      for (const [i, name] of ["Ada", "Ben", "Cy"].entries()) {
        const result = await submitTourRequest(store, rules, input({ name, email: `${name.toLowerCase()}@example.com` }), at(i * 60_000));
        if (!result.ok || !result.request) throw new Error("expected a saved request");
        ids.push(result.request.id);
      }
      return { store, ids };
    }

    it("lists the newest first, with how many are in all and how many nobody has followed up", async () => {
      const { store } = await threeRequests();
      const list = await listTourRequests(store, rules, STAFF);
      expect(list.items.map((r) => r.name)).toEqual(["Cy", "Ben", "Ada"]);
      expect(list).toMatchObject({ total: 3, newCount: 3 });
    });

    it("shows only as many as the screen's limit, and still counts them all", async () => {
      const { store } = await threeRequests();
      const list = await listTourRequests(store, rulesWith({ listLimit: 10 }), STAFF);
      expect(list.items).toHaveLength(3);
      const two = await store.list(2);
      expect(two.items.map((r) => r.name)).toEqual(["Cy", "Ben"]);
      expect(two).toMatchObject({ total: 3, newCount: 3 });
    });

    it("is for staff only", async () => {
      const { store, ids } = await threeRequests();
      expect((await refusal(listTourRequests(store, rules, MEMBER))).code).toBe("forbidden");
      expect((await refusal(listTourRequests(store, rules, { kind: "system", label: "System" }))).code).toBe("forbidden");
      expect((await refusal(markTourFollowedUp(store, MEMBER, ids[0], NOW))).code).toBe("forbidden");
      expect((await store.list(10)).newCount).toBe(3);
    });

    it("marks a request followed up, once, and records who and when", async () => {
      const { store, ids } = await threeRequests();
      const done = await markTourFollowedUp(store, STAFF, ids[1], at(HOUR_MS));
      expect(done).toMatchObject({ id: ids[1], status: "followed_up", followedUpBy: "Alex Staffer", followedUpAt: at(HOUR_MS).toISOString(), name: "Ben" });
      const list = await store.list(10);
      expect(list.newCount).toBe(2);
      expect(list.items.find((r) => r.id === ids[1])).toEqual(done);
      const again = await refusal(markTourFollowedUp(store, { kind: "staff", label: "Someone Else" }, ids[1], at(2 * HOUR_MS)));
      expect(again).toMatchObject({ code: "conflict", message: "That request was already marked as followed up." });
      expect((await store.list(10)).items.find((r) => r.id === ids[1])?.followedUpBy).toBe("Alex Staffer");
    });

    it("refuses a request that does not exist, or an id that cannot be one", async () => {
      const { store } = await threeRequests();
      expect(await refusal(markTourFollowedUp(store, STAFF, "00000000-0000-4000-8000-000000000000", NOW))).toMatchObject({ code: "not_found", message: "That tour request could not be found." });
      for (const bad of ["", "abc", "'; drop table club.tour_requests; --", undefined, 5, null]) {
        expect(await refusal(markTourFollowedUp(store, STAFF, bad, NOW)), String(bad)).toMatchObject({ code: "invalid" });
      }
    });

    it("marks it once when two staff press the button together", async () => {
      const { store, ids } = await threeRequests();
      const attempts = await Promise.allSettled([markTourFollowedUp(store, STAFF, ids[0], NOW), markTourFollowedUp(store, { kind: "staff", label: "Sam Deskwell" }, ids[0], NOW), markTourFollowedUp(store, STAFF, ids[0], NOW)]);
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      expect(attempts.filter((a) => a.status === "rejected")).toHaveLength(2);
      expect((await store.list(10)).newCount).toBe(2);
    });
  });
});

describe("telling the membership office", () => {
  const request = { id: "11111111-1111-4111-8111-111111111111", createdAt: NOW.toISOString(), name: "Ada Quill", email: "ada@example.com", phone: "(206) 555-0100", note: "Two of us.", status: "new" as const, followedUpAt: null, followedUpBy: null };

  it("writes a plain email with everything the visitor gave, and says what to do next", () => {
    const mail = tourNoticeMail(request, "membership@example.org");
    expect(mail.to).toBe("membership@example.org");
    expect(mail.subject).toBe("New tour request: Ada Quill");
    expect(mail.text.split("\n")).toEqual([
      "A new tour request came in on the club's website.",
      "",
      "Name: Ada Quill",
      "Email: ada@example.com",
      "Phone: (206) 555-0100",
      "Note: Two of us.",
      "",
      "It is also saved on the Tour requests screen in the staff office. Reply to this person at the email address above, then mark it followed up there.",
    ]);
  });

  it("says plainly when there is no phone number or note", () => {
    const mail = tourNoticeMail({ ...request, phone: "", note: "" }, "x@example.org");
    expect(mail.text).toContain("Phone: (not given)");
    expect(mail.text).toContain("Note: (none)");
  });

  it("sends it through the club's sender, and says it did", async () => {
    const sent: unknown[] = [];
    const mailer: Mailer = { send: async (mail, now) => void sent.push({ mail, now }) };
    expect(await notifyAboutTourRequest(mailer, request, "membership@example.org", NOW)).toBe(true);
    expect(sent).toEqual([{ mail: tourNoticeMail(request, "membership@example.org"), now: NOW }]);
  });

  it("does nothing, and says so, when no sender is switched on", async () => {
    expect(await notifyAboutTourRequest(null, request, "membership@example.org", NOW)).toBe(false);
  });

  it("never lets a failed email lose or break anything: it is logged in the sender's own scrubbed words and the answer is false", async () => {
    const failing: Mailer = { send: async () => Promise.reject(new Error("Resend refused the email (status 403).")) };
    const log = vi.fn();
    expect(await notifyAboutTourRequest(failing, request, "membership@example.org", NOW, log)).toBe(false);
    expect(log).toHaveBeenCalledWith("Could not email a tour request notice: Resend refused the email (status 403).");
    expect(JSON.stringify(log.mock.calls)).not.toContain("ada@example.com");
  });

  it("goes to the public membership address unless a usable one is set", () => {
    expect(tourNotifyAddress({})).toBe(DEFAULT_REPLY_TO);
    expect(tourNotifyAddress({ CLUB_TOUR_NOTIFY_TO: "  Front.Desk@Example.org " })).toBe("front.desk@example.org");
    expect(tourNotifyAddress({ CLUB_TOUR_NOTIFY_TO: "not an address" })).toBe(DEFAULT_REPLY_TO);
    expect(tourNotifyAddress({ CLUB_TOUR_NOTIFY_TO: "" })).toBe(DEFAULT_REPLY_TO);
  });
});
