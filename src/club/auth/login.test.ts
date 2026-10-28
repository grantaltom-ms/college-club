import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFixture, databaseUrls, NOW, staffCtx, STORE_KINDS, type Fixture, type StoreKind } from "../engine/testkit";
import { createHousehold, endHousehold, removeMember } from "../engine/households";
import { clubLedger } from "../engine/ledger";
import { LOGIN_RULES, type LoginRules } from "../settings/login-rules";
import { createClubPool } from "../store/postgres";
import { identityKey, identityOf, identitiesForEmail } from "./identities";
import { confirmSignIn, previewSignIn, rememberedIdentity, requestSignInLink, resolveSession, signOut, type LoginDeps } from "./login";
import { clearOutbox, outboxMailer, outboxMessages, type Mailer } from "./mail";
import { PgAuthStore } from "./postgres";
import { createResendMailer } from "./resend";
import { MemoryAuthStore } from "./store";
import { hashSecret } from "./tokens";

/**
 * Signing in by email link, end to end on both stores: a link is made only for an address that can sign in and never says
 * otherwise; it works once, briefly; it signs in exactly the person chosen among those the address opens; and whether a browser
 * is still signed in is decided on every visit, so ending a household or removing an adult signs them out at once.
 */

const ORIGIN = "https://club.example.org";
const STAFF = [{ email: "alex.staffer@example.org", name: "Alex Staffer" }];
const RESEND = { apiKey: "re_AbCdEfGh_1234567890abcdef", from: "College Club Seattle <no-reply@example.org>", replyTo: null };
const minutes = (m: number, from: Date = NOW) => new Date(from.getTime() + m * 60000);
const pools: { end(): Promise<void> }[] = [];

afterEach(async () => {
  clearOutbox();
  vi.restoreAllMocks();
  while (pools.length > 0) await pools.pop()!.end();
});

async function open(kind: StoreKind, overrides: Partial<LoginDeps> = {}): Promise<{ deps: LoginDeps; f: Fixture }> {
  const f = await buildFixture(kind);
  let auth;
  if (kind === "memory") auth = new MemoryAuthStore();
  else {
    const pool = createClubPool(databaseUrls.get(f.store)!, 12);
    pools.push(pool);
    auth = new PgAuthStore(pool);
  }
  return { f, deps: { club: f.store, auth, mailer: outboxMailer, staff: STAFF, rules: LOGIN_RULES, ...overrides } };
}

/** The sign-in link's secret, read out of the newest email in the test outbox. */
function latestSecret(to?: string): string {
  const mail = outboxMessages().find((m) => !to || m.to === to);
  const found = mail && /\/club\/sign-in\/([A-Za-z0-9_-]{43})/.exec(mail.text);
  if (!found) throw new Error("No sign-in link in the outbox.");
  return found[1];
}

const rulesWith = (change: Partial<LoginRules["defaults"]>): LoginRules => ({ placeholder: true, defaults: { ...LOGIN_RULES.defaults, ...change } });

describe.each(STORE_KINDS)("signing in by email link on the %s store", (kind) => {
  describe("asking for a link", () => {
    it("emails one link to an address that belongs to a member, saying nothing about who they are", async () => {
      const { deps } = await open(kind);
      expect(await requestSignInLink(deps, { email: "  Ada@Example.COM ", origin: ORIGIN, now: NOW })).toBe("sent");
      const mails = outboxMessages();
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: "ada@example.com", subject: "Your College Club Seattle sign-in link", at: NOW.toISOString() });
      expect(mails[0].text).toMatch(/https:\/\/club\.example\.org\/club\/sign-in\/[A-Za-z0-9_-]{43}\n/);
      expect(mails[0].text).toContain("stops working in 15 minutes");
      expect(mails[0].text).not.toMatch(/Ada|Quill/);
    });

    it("quietly does nothing for an address nobody can sign in with, a stranger's address, and a malformed one", async () => {
      const { deps } = await open(kind);
      expect(await requestSignInLink(deps, { email: "stranger@example.com", origin: ORIGIN, now: NOW })).toBe("ignored");
      expect(await requestSignInLink(deps, { email: "not an address", origin: ORIGIN, now: NOW })).toBe("invalid");
      expect(await requestSignInLink(deps, { email: undefined, origin: ORIGIN, now: NOW })).toBe("invalid");
      expect(outboxMessages()).toHaveLength(0);
      expect(await deps.auth.countTokensSince("stranger@example.com", minutes(-60))).toBe(0);
    });

    it("sends a link for a staff address, and for an address that is both a member's and staff's", async () => {
      const { deps, f } = await open(kind);
      expect(await requestSignInLink(deps, { email: "alex.staffer@example.org", origin: ORIGIN, now: NOW })).toBe("sent");
      await createHousehold(f.store, staffCtx(), { displayName: "The Staffer household", membershipType: "Resident", joinedOn: "2020-01-01", primary: { firstName: "Alex", lastName: "Staffer", email: "alex.staffer@example.org" } });
      expect(await requestSignInLink(deps, { email: "alex.staffer@example.org", origin: ORIGIN, now: minutes(1) })).toBe("sent");
      expect(outboxMessages()).toHaveLength(2);
    });

    it("does nothing for someone whose membership ended or who left the household", async () => {
      const { deps, f } = await open(kind);
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed);
      await removeMember(f.store, clubLedger, staffCtx(), f.m.Cy);
      for (const email of ["dee@example.com", "eli@example.com", "cy@example.com"]) expect(await requestSignInLink(deps, { email, origin: ORIGIN, now: NOW }), email).toBe("ignored");
      expect(await requestSignInLink(deps, { email: "ben@example.com", origin: ORIGIN, now: NOW })).toBe("sent");
      expect(outboxMessages().map((m) => m.to)).toEqual(["ben@example.com"]);
    });

    it("asks only so often: the sixth request in an hour is ignored, per address, and an hour later it works again", async () => {
      const { deps } = await open(kind);
      for (let i = 0; i < 5; i++) expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: minutes(i) }), `request ${i + 1}`).toBe("sent");
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: minutes(5) })).toBe("ignored");
      expect(await requestSignInLink(deps, { email: "ben@example.com", origin: ORIGIN, now: minutes(5) })).toBe("sent");
      expect(outboxMessages().filter((m) => m.to === "ada@example.com")).toHaveLength(5);
      // The oldest request was at minute 0; at minute 61 only four are inside the hour.
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: minutes(61) })).toBe("sent");
    });

    it("follows the number in the login rules", async () => {
      const { deps } = await open(kind, { rules: rulesWith({ linksPerHourPerEmail: 2 }) });
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("sent");
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("sent");
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("ignored");
    });

    it("says email sign-in is off, and makes nothing, when nobody sends email", async () => {
      const { deps } = await open(kind, { mailer: null });
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("off");
      expect(await deps.auth.countTokensSince("ada@example.com", minutes(-60))).toBe(0);
    });

    it("looks the same from outside when the email cannot be sent", async () => {
      const failing: Mailer = { send: async () => Promise.reject(new Error("mail server down")) };
      const { deps } = await open(kind, { mailer: failing });
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("ignored");
      expect(logged).toHaveBeenCalledWith("Could not send a sign-in email:", "mail server down");
    });

    it("emails the link through the real sender, and the link in that email signs the person in", async () => {
      const sent: { to: string[]; subject: string; text: string }[] = [];
      const pretendResend = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sent.push(JSON.parse(init!.body as string));
        return Response.json({ id: "email_1" });
      });
      const mailer = createResendMailer(RESEND, { fetch: pretendResend as unknown as typeof fetch });
      const { deps } = await open(kind, { mailer });
      expect(await requestSignInLink(deps, { email: "  Ada@Example.COM ", origin: ORIGIN, now: NOW })).toBe("sent");
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: ["ada@example.com"], subject: "Your College Club Seattle sign-in link" });
      expect(sent[0].text).toContain(`${ORIGIN}/club/sign-in/`);
      const secret = /\/club\/sign-in\/([A-Za-z0-9_-]{43})/.exec(sent[0].text)![1];
      expect((await previewSignIn(deps, { secret, now: minutes(1) }))?.email).toBe("ada@example.com");
      expect(outboxMessages()).toEqual([]);
    });

    it("looks the same from outside when Resend refuses, and the log holds neither the key nor the address", async () => {
      const refusing = vi.fn(async () => Response.json({ name: "validation_error", message: "The example.org domain is not verified." }, { status: 403 }));
      const { deps } = await open(kind, { mailer: createResendMailer(RESEND, { fetch: refusing as unknown as typeof fetch }) });
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW })).toBe("ignored");
      expect(logged).toHaveBeenCalledWith("Could not send a sign-in email:", "Resend refused the email (status 403: validation_error: The example.org domain is not verified.).");
      expect(JSON.stringify(logged.mock.calls)).not.toContain(RESEND.apiKey);
      expect(JSON.stringify(logged.mock.calls)).not.toContain("ada@example.com");
    });
  });

  describe("opening a link", () => {
    it("shows who it can sign in as, and changes nothing by looking", async () => {
      const { deps } = await open(kind);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const secret = latestSecret();
      for (let i = 0; i < 3; i++) {
        const seen = await previewSignIn(deps, { secret, now: minutes(1 + i) });
        expect(seen).toMatchObject({ email: "ada@example.com", identities: [{ kind: "member", name: "Ada Quill", household: "The Quill household" }] });
      }
      // Still usable after being looked at.
      expect(await confirmSignIn(deps, { secret, identity: seen_key(await previewSignIn(deps, { secret, now: NOW })), now: minutes(5) })).not.toBeNull();
    });

    it("lists every adult who shares the address, and staff, in a fixed order", async () => {
      const { deps, f } = await open(kind);
      await createHousehold(f.store, staffCtx(), {
        displayName: "The Moreau household",
        membershipType: "Resident",
        joinedOn: "2020-01-01",
        primary: { firstName: "Julien", lastName: "Moreau", email: "Moreau.Family@example.com" },
        additional: [{ firstName: "Camille", lastName: "Moreau", email: "moreau.family@example.com" }],
      });
      deps.staff = [...STAFF, { email: "moreau.family@example.com", name: "Pat Desk" }];
      await requestSignInLink(deps, { email: "moreau.family@example.com", origin: ORIGIN, now: NOW });
      const seen = await previewSignIn(deps, { secret: latestSecret(), now: minutes(1) });
      expect(seen!.identities.map((i) => [i.kind, i.name])).toEqual([["member", "Camille Moreau"], ["member", "Julien Moreau"], ["staff", "Pat Desk"]]);
    });

    it("finds nothing for a link that is unknown, mangled, out of date, used, or whose address no longer opens anyone", async () => {
      const { deps, f } = await open(kind);
      await requestSignInLink(deps, { email: "dee@example.com", origin: ORIGIN, now: NOW });
      const secret = latestSecret();
      for (const bad of [undefined, null, "", "short", "A".repeat(43), `${secret}x`, secret.slice(1)]) expect(await previewSignIn(deps, { secret: bad, now: minutes(1) }), String(bad)).toBeNull();
      expect(await previewSignIn(deps, { secret, now: minutes(15) })).toBeNull(); // 15 minutes exactly: gone
      expect(await previewSignIn(deps, { secret, now: minutes(14) })).not.toBeNull();
      await endHousehold(f.store, clubLedger, staffCtx(), f.h.Reed); // Dee's membership ends before she uses it
      expect(await previewSignIn(deps, { secret, now: minutes(14) })).toBeNull();
    });

    it("follows the link minutes in the login rules", async () => {
      const { deps } = await open(kind, { rules: rulesWith({ linkMinutes: 5 }) });
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const secret = latestSecret();
      expect(await previewSignIn(deps, { secret, now: minutes(4) })).not.toBeNull();
      expect(await previewSignIn(deps, { secret, now: minutes(5) })).toBeNull();
    });
  });

  describe("pressing the button", () => {
    it("signs in the chosen person, uses the link up, and stores only fingerprints", async () => {
      const { deps, f } = await open(kind);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const link = latestSecret();
      const signedIn = await confirmSignIn(deps, { secret: link, identity: `member:${f.m.Ada}`, now: minutes(2) });
      expect(signedIn).toMatchObject({ identity: { kind: "member", memberId: f.m.Ada, name: "Ada Quill" }, expiresAt: minutes(2 + 30 * 24 * 60) });
      expect(signedIn!.sessionSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(signedIn!.sessionSecret).not.toBe(link);
      // The link is gone; the browser's secret is known to the database only as a fingerprint.
      expect(await previewSignIn(deps, { secret: link, now: minutes(3) })).toBeNull();
      expect(await confirmSignIn(deps, { secret: link, identity: `member:${f.m.Ada}`, now: minutes(3) })).toBeNull();
      expect(await deps.auth.findSession(hashSecret(signedIn!.sessionSecret), minutes(3))).toEqual({ kind: "member", memberId: f.m.Ada });
      expect(await deps.auth.findSession(signedIn!.sessionSecret, minutes(3))).toBeNull();
    });

    it("signs in only someone this link's address opens: another member, a made-up one and a bad value change nothing and leave the link usable", async () => {
      const { deps, f } = await open(kind);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const link = latestSecret();
      for (const wrong of [`member:${f.m.Ben}`, "member:00000000-0000-4000-8000-0000000000ff", "staff:alex.staffer@example.org", "staff:ada@example.com", "admin", "", undefined, null, `member:${f.m.Ada}x`]) {
        expect(await confirmSignIn(deps, { secret: link, identity: wrong, now: minutes(1) }), String(wrong)).toBeNull();
      }
      expect(await confirmSignIn(deps, { secret: link, identity: `member:${f.m.Ada}`, now: minutes(2) })).not.toBeNull();
    });

    it("lets partners sharing an address each be chosen, one link per sign-in", async () => {
      const { deps, f } = await open(kind);
      const moreau = await createHousehold(f.store, staffCtx(), {
        displayName: "The Moreau household",
        membershipType: "Resident",
        joinedOn: "2020-01-01",
        primary: { firstName: "Camille", lastName: "Moreau", email: "moreau.family@example.com" },
        additional: [{ firstName: "Julien", lastName: "Moreau", email: "moreau.family@example.com" }],
      });
      const [camille, julien] = moreau.members;
      await requestSignInLink(deps, { email: "moreau.family@example.com", origin: ORIGIN, now: NOW });
      const first = await confirmSignIn(deps, { secret: latestSecret(), identity: `member:${julien.id}`, now: minutes(1) });
      expect(first!.identity).toMatchObject({ name: "Julien Moreau" });
      await requestSignInLink(deps, { email: "moreau.family@example.com", origin: ORIGIN, now: minutes(2) });
      const second = await confirmSignIn(deps, { secret: latestSecret(), identity: `member:${camille.id}`, now: minutes(3) });
      expect(second!.identity).toMatchObject({ name: "Camille Moreau" });
      // Each browser is its own person.
      expect(await resolveSession(deps, { secret: first!.sessionSecret, now: minutes(4) })).toMatchObject({ identity: { name: "Julien Moreau" } });
      expect(await resolveSession(deps, { secret: second!.sessionSecret, now: minutes(4) })).toMatchObject({ identity: { name: "Camille Moreau" } });
    });

    it("signs in staff by their address, under the name on the list", async () => {
      const { deps } = await open(kind);
      await requestSignInLink(deps, { email: "alex.staffer@example.org", origin: ORIGIN, now: NOW });
      const signedIn = await confirmSignIn(deps, { secret: latestSecret(), identity: "staff:alex.staffer@example.org", now: minutes(1) });
      expect(signedIn!.identity).toEqual({ kind: "staff", email: "alex.staffer@example.org", name: "Alex Staffer" });
      expect(await resolveSession(deps, { secret: signedIn!.sessionSecret, now: minutes(2) })).toEqual({ kind: "staff", identity: { kind: "staff", email: "alex.staffer@example.org", name: "Alex Staffer" } });
    });

    it("signs in exactly once when ten people press the same link at the same instant", async () => {
      const { deps, f } = await open(kind);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const link = latestSecret();
      const results = await Promise.all(Array.from({ length: 10 }, () => confirmSignIn(deps, { secret: link, identity: `member:${f.m.Ada}`, now: minutes(1) })));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it("fills the member's empty login slot the first time, keeps it afterwards, and leaves staff out of it", async () => {
      const { deps, f } = await open(kind);
      const loginIdOf = async (id: string) => (await f.store.read()).members.find((m) => m.id === id)!.loginId;
      expect(await loginIdOf(f.m.Ada)).toBeNull();
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      await confirmSignIn(deps, { secret: latestSecret(), identity: `member:${f.m.Ada}`, now: minutes(1) });
      const first = await loginIdOf(f.m.Ada);
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: minutes(2) });
      await confirmSignIn(deps, { secret: latestSecret(), identity: `member:${f.m.Ada}`, now: minutes(3) });
      expect(await loginIdOf(f.m.Ada)).toBe(first);
      expect(await loginIdOf(f.m.Ben)).toBeNull();
      await requestSignInLink(deps, { email: "alex.staffer@example.org", origin: ORIGIN, now: minutes(4) });
      await confirmSignIn(deps, { secret: latestSecret(), identity: "staff:alex.staffer@example.org", now: minutes(5) });
      expect((await f.store.read()).members.filter((m) => m.loginId !== null).map((m) => m.id)).toEqual([f.m.Ada]);
    });

    it("signs in even if recording the first sign-in fails", async () => {
      const { deps, f } = await open(kind);
      await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(deps.club, "transaction").mockImplementation(async () => Promise.reject(new Error("database busy")) as never);
      const signedIn = await confirmSignIn(deps, { secret: latestSecret(), identity: `member:${f.m.Ada}`, now: minutes(1) });
      expect(signedIn).not.toBeNull();
      expect(logged).toHaveBeenCalledWith("Could not record a first sign-in:", "database busy");
    });
  });

  describe("coming back signed in", () => {
    async function signedInAs(deps: LoginDeps, email: string, identity: string, at: Date = minutes(1)) {
      await requestSignInLink(deps, { email, origin: ORIGIN, now: at });
      const result = await confirmSignIn(deps, { secret: latestSecret(email), identity, now: at });
      return result!.sessionSecret;
    }

    it("recognises a member with their household, for 30 days", async () => {
      const { deps, f } = await open(kind);
      const cookie = await signedInAs(deps, "ben@example.com", `member:${f.m.Ben}`);
      const who = await resolveSession(deps, { secret: cookie, now: minutes(60) });
      expect(who).toMatchObject({ identity: { kind: "member", name: "Ben Quill" }, member: { id: f.m.Ben }, household: { displayName: "The Quill household" } });
      const lastMoment = new Date(minutes(1).getTime() + 30 * 24 * 3600000);
      expect(await resolveSession(deps, { secret: cookie, now: new Date(lastMoment.getTime() - 1) })).not.toBeNull();
      expect(await resolveSession(deps, { secret: cookie, now: lastMoment })).toBeNull();
    });

    it("follows the session days in the login rules", async () => {
      const { deps, f } = await open(kind, { rules: rulesWith({ sessionDays: 1 }) });
      const cookie = await signedInAs(deps, "ben@example.com", `member:${f.m.Ben}`);
      expect(await resolveSession(deps, { secret: cookie, now: minutes(23 * 60) })).not.toBeNull();
      expect(await resolveSession(deps, { secret: cookie, now: minutes(25 * 60) })).toBeNull();
    });

    it("knows nobody for a cookie that is missing, mangled, made up or signed out", async () => {
      const { deps, f } = await open(kind);
      const cookie = await signedInAs(deps, "ben@example.com", `member:${f.m.Ben}`);
      for (const bad of [undefined, null, "", "short", "A".repeat(43), `${cookie}x`, hashSecret(cookie).slice(0, 43)]) expect(await resolveSession(deps, { secret: bad, now: minutes(2) }), String(bad)).toBeNull();
      await signOut(deps, { secret: cookie, now: minutes(3) });
      expect(await resolveSession(deps, { secret: cookie, now: minutes(4) })).toBeNull();
      await signOut(deps, { secret: cookie, now: minutes(5) }); // twice is fine
      await signOut(deps, { secret: undefined, now: minutes(5) }); // nobody signed in is fine
    });

    it("signs a member out at once when their household ends, on every device, without anyone having to sign them out", async () => {
      const { deps, f } = await open(kind);
      const phone = await signedInAs(deps, "dee@example.com", `member:${f.m.Dee}`);
      const laptop = await signedInAs(deps, "dee@example.com", `member:${f.m.Dee}`, minutes(2));
      const eli = await signedInAs(deps, "eli@example.com", `member:${f.m.Eli}`, minutes(3));
      const ada = await signedInAs(deps, "ada@example.com", `member:${f.m.Ada}`, minutes(4));
      expect(await resolveSession(deps, { secret: phone, now: minutes(10) })).not.toBeNull();
      await endHousehold(f.store, clubLedger, staffCtx(minutes(11)), f.h.Reed);
      for (const cookie of [phone, laptop, eli]) expect(await resolveSession(deps, { secret: cookie, now: minutes(12) })).toBeNull();
      expect(await resolveSession(deps, { secret: ada, now: minutes(12) })).not.toBeNull(); // another household: untouched
    });

    it("signs out an adult who is removed from the household, and not the others", async () => {
      const { deps, f } = await open(kind);
      const cy = await signedInAs(deps, "cy@example.com", `member:${f.m.Cy}`);
      const ben = await signedInAs(deps, "ben@example.com", `member:${f.m.Ben}`, minutes(2));
      await removeMember(f.store, clubLedger, staffCtx(minutes(5)), f.m.Cy);
      expect(await resolveSession(deps, { secret: cy, now: minutes(6) })).toBeNull();
      expect(await resolveSession(deps, { secret: ben, now: minutes(6) })).not.toBeNull();
    });

    it("stays signed out for good: nothing brings back a browser that stopped working", async () => {
      const { deps, f } = await open(kind);
      const cookie = await signedInAs(deps, "cy@example.com", `member:${f.m.Cy}`);
      await removeMember(f.store, clubLedger, staffCtx(minutes(5)), f.m.Cy);
      expect(await resolveSession(deps, { secret: cookie, now: minutes(6) })).toBeNull();
      expect(await deps.auth.findSession(hashSecret(cookie), minutes(7))).toBeNull();
    });

    it("signs staff out when their address comes off the list, and back in when it is on it again", async () => {
      const { deps } = await open(kind);
      const cookie = await signedInAs(deps, "alex.staffer@example.org", "staff:alex.staffer@example.org");
      expect(await resolveSession(deps, { secret: cookie, now: minutes(2) })).not.toBeNull();
      const onList = deps.staff;
      deps.staff = [];
      expect(await resolveSession(deps, { secret: cookie, now: minutes(3) })).toBeNull();
      deps.staff = onList;
      // They were signed out for good when the list changed: a new link is needed.
      expect(await resolveSession(deps, { secret: cookie, now: minutes(4) })).toBeNull();
    });
  });

  describe("who an address opens, judged on the household alone", () => {
    it("opens no one in a household that has ended, even if an adult's own record still reads active", async () => {
      // Ending a household also marks each adult, so this takes a record where only the household says it has ended.
      const { f } = await open(kind);
      const state = structuredClone(await f.store.read());
      state.households.find((h) => h.id === f.h.Reed)!.status = "ended";
      expect(state.members.find((m) => m.id === f.m.Dee)!.status).toBe("active");
      expect(identitiesForEmail(state, STAFF, "dee@example.com")).toEqual([]);
      expect(identityOf(state, STAFF, { kind: "member", memberId: f.m.Dee })).toBeNull();
      expect(identitiesForEmail(state, STAFF, "ada@example.com")).toHaveLength(1);
    });
  });

  describe("remembering who a device is", () => {
    it("picks out the remembered person only if the link still opens them", async () => {
      const { deps, f } = await open(kind);
      const moreau = await createHousehold(f.store, staffCtx(), {
        displayName: "The Moreau household",
        membershipType: "Resident",
        joinedOn: "2020-01-01",
        primary: { firstName: "Camille", lastName: "Moreau", email: "moreau.family@example.com" },
        additional: [{ firstName: "Julien", lastName: "Moreau", email: "moreau.family@example.com" }],
      });
      await requestSignInLink(deps, { email: "moreau.family@example.com", origin: ORIGIN, now: NOW });
      const seen = await previewSignIn(deps, { secret: latestSecret(), now: minutes(1) });
      const julien = moreau.members[1];
      expect(rememberedIdentity(seen!.identities, `member:${julien.id}`)).toMatchObject({ name: "Julien Moreau" });
      expect(identityKey(rememberedIdentity(seen!.identities, `member:${julien.id}`)!)).toBe(`member:${julien.id}`);
      for (const nope of [undefined, "", "member:00000000-0000-4000-8000-0000000000ff", `member:${f.m.Ada}`, "staff:alex.staffer@example.org", "garbage"]) expect(rememberedIdentity(seen!.identities, nope), String(nope)).toBeNull();
    });
  });
});

/** The form value for the one person a link opens. */
function seen_key(seen: Awaited<ReturnType<typeof previewSignIn>>): string {
  return identityKey(seen!.identities[0]);
}
