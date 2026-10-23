import { afterEach, describe, expect, it } from "vitest";
import { buildFixture, databaseUrls, memberCtx, NOW, staffCtx, STORE_KINDS, type Fixture, type StoreKind } from "../engine/testkit";
import { createHousehold, removeMember, type Ctx } from "../engine/households";
import { clubLedger } from "../engine/ledger";
import { historyOf } from "../engine/queries";
import { LOGIN_RULES } from "../settings/login-rules";
import { createClubPool } from "../store/postgres";
import { editMemberDetails } from "./edit-details";
import { identityKey, type SessionSubject } from "./identities";
import { confirmSignIn, previewSignIn, requestSignInLink, resolveSession, type LoginDeps } from "./login";
import { clearOutbox, outboxMailer, outboxMessages } from "./mail";
import { PgAuthStore } from "./postgres";
import { MemoryAuthStore, type AuthStore } from "./store";

/**
 * Staff correct a person's details, and a changed email signs the person out of every device: the old address stops working
 * as a key, the new one starts, other people's browsers are left alone, and a refused change signs nobody out. Run end to end
 * on both stores with the real sign-in.
 */

const ORIGIN = "https://club.example.org";
const minutes = (m: number, from: Date = NOW) => new Date(from.getTime() + m * 60000);
const pools: { end(): Promise<void> }[] = [];

afterEach(async () => {
  clearOutbox();
  while (pools.length > 0) await pools.pop()!.end();
});

async function open(kind: StoreKind, wrap?: (auth: AuthStore) => AuthStore): Promise<{ deps: LoginDeps; f: Fixture }> {
  const f = await buildFixture(kind);
  let auth: AuthStore;
  if (kind === "memory") auth = new MemoryAuthStore();
  else {
    const pool = createClubPool(databaseUrls.get(f.store)!, 12);
    pools.push(pool);
    auth = new PgAuthStore(pool);
  }
  return { f, deps: { club: f.store, auth: wrap ? wrap(auth) : auth, mailer: outboxMailer, staff: [], rules: LOGIN_RULES } };
}

/** Signs in through the real flow (ask for a link, open it, press the button) and returns the browser's secret. */
async function signIn(deps: LoginDeps, email: string, memberId: string, now: Date = NOW): Promise<string> {
  await requestSignInLink(deps, { email, origin: ORIGIN, now });
  const mail = outboxMessages().find((m) => m.to === email.toLowerCase());
  const secret = mail && /\/club\/sign-in\/([A-Za-z0-9_-]{43})/.exec(mail.text)?.[1];
  if (!secret) throw new Error(`No sign-in link was sent to ${email}.`);
  const signedIn = await confirmSignIn(deps, { secret, identity: identityKey({ kind: "member", memberId }), now });
  if (!signedIn) throw new Error("Could not sign in.");
  return signedIn.sessionSecret;
}

const stillIn = async (deps: LoginDeps, secret: string, now: Date = minutes(10)) => (await resolveSession(deps, { secret, now }))?.kind ?? null;

describe.each(STORE_KINDS)("correcting a person's details, with sign-in, on the %s store", (kind) => {
  it("signs the person out of every device when their email changes, and only that person", async () => {
    const { deps, f } = await open(kind);
    const adaPhone = await signIn(deps, "ada@example.com", f.m.Ada);
    const adaLaptop = await signIn(deps, "ada@example.com", f.m.Ada, minutes(1));
    const ben = await signIn(deps, "ben@example.com", f.m.Ben);
    const dee = await signIn(deps, "dee@example.com", f.m.Dee);
    expect([await stillIn(deps, adaPhone), await stillIn(deps, adaLaptop), await stillIn(deps, ben), await stillIn(deps, dee)]).toEqual(["member", "member", "member", "member"]);

    const result = await editMemberDetails(f.store, deps.auth, staffCtx(minutes(5)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "ada.new@example.com", phone: "" });
    expect(result).toMatchObject({ changed: ["email"], signInChanged: true, signedOut: 2 });

    expect([await stillIn(deps, adaPhone), await stillIn(deps, adaLaptop)]).toEqual([null, null]);
    expect([await stillIn(deps, ben), await stillIn(deps, dee)]).toEqual(["member", "member"]);
  });

  it("makes the old address useless and the new one work, including for a link sent to the old address before the change", async () => {
    const { deps, f } = await open(kind);
    await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: NOW });
    const oldLink = /\/club\/sign-in\/([A-Za-z0-9_-]{43})/.exec(outboxMessages()[0].text)![1];
    expect(await previewSignIn(deps, { secret: oldLink, now: minutes(1) })).not.toBeNull();

    await editMemberDetails(f.store, deps.auth, staffCtx(minutes(2)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "Ada.New@Example.com", phone: "" });

    // The unused link no longer opens anyone: an address opens whoever has it on file when the link is used.
    expect(await previewSignIn(deps, { secret: oldLink, now: minutes(3) })).toBeNull();
    expect(await confirmSignIn(deps, { secret: oldLink, identity: identityKey({ kind: "member", memberId: f.m.Ada }), now: minutes(3) })).toBeNull();
    clearOutbox();
    expect(await requestSignInLink(deps, { email: "ada@example.com", origin: ORIGIN, now: minutes(4) })).toBe("ignored");
    expect(outboxMessages()).toHaveLength(0);

    expect(await requestSignInLink(deps, { email: "ada.new@example.com", origin: ORIGIN, now: minutes(4) })).toBe("sent");
    const secret = await signIn(deps, "ada.new@example.com", f.m.Ada, minutes(5));
    expect(await resolveSession(deps, { secret, now: minutes(6) })).toMatchObject({ kind: "member", member: { id: f.m.Ada, email: "Ada.New@Example.com" } });
  });

  it("leaves people signed in when the change is only a phone number, a name, or the capital letters of the same email", async () => {
    const { deps, f } = await open(kind);
    const ada = await signIn(deps, "ada@example.com", f.m.Ada);
    for (const change of [{ phone: "206-555-0100" }, { firstName: "Adaline" }, { email: "ADA@example.com" }]) {
      const result = await editMemberDetails(f.store, deps.auth, staffCtx(minutes(5)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "ada@example.com", phone: "", ...change });
      expect(result).toMatchObject({ signInChanged: false, signedOut: 0 });
      expect(await stillIn(deps, ada)).toBe("member");
      await editMemberDetails(f.store, deps.auth, staffCtx(minutes(6)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "ada@example.com", phone: "" });
    }
  });

  it("keeps a partner signed in when the other partner's email changes, and the shared address then opens only the partner who kept it", async () => {
    const { deps, f } = await open(kind);
    const { members } = await createHousehold(f.store, staffCtx(), {
      displayName: "The Moreau household",
      membershipType: "Resident",
      joinedOn: "2020-01-01",
      primary: { firstName: "Julien", lastName: "Moreau", email: "moreau@example.com" },
      additional: [{ firstName: "Camille", lastName: "Moreau", email: "moreau@example.com" }],
    });
    const [julien, camille] = members;
    const julienIn = await signIn(deps, "moreau@example.com", julien.id);
    const camilleIn = await signIn(deps, "moreau@example.com", camille.id, minutes(1));

    await editMemberDetails(f.store, deps.auth, staffCtx(minutes(5)), julien.id, { firstName: "Julien", lastName: "Moreau", email: "julien@example.com", phone: "" });

    expect(await stillIn(deps, julienIn)).toBeNull();
    expect(await stillIn(deps, camilleIn)).toBe("member");
    await requestSignInLink(deps, { email: "moreau@example.com", origin: ORIGIN, now: minutes(6) });
    const link = /\/club\/sign-in\/([A-Za-z0-9_-]{43})/.exec(outboxMessages()[0].text)![1];
    expect((await previewSignIn(deps, { secret: link, now: minutes(7) }))!.identities.map((i) => i.kind === "member" && i.name)).toEqual(["Camille Moreau"]);
  });

  it("signs nobody out for a change that is refused: nothing changed, a mistake, not staff, someone who has left", async () => {
    const { deps, f } = await open(kind);
    const ada = await signIn(deps, "ada@example.com", f.m.Ada);
    const ben = await signIn(deps, "ben@example.com", f.m.Ben);
    const same = { firstName: "Ada", lastName: "Quill", email: "ada@example.com", phone: "" };
    const refused: [Ctx, string, typeof same][] = [
      [staffCtx(minutes(5)), f.m.Ada, same],
      [staffCtx(minutes(5)), f.m.Ada, { ...same, email: "not an address" }],
      [staffCtx(minutes(5)), f.m.Ada, { ...same, email: "" }],
      [memberCtx(f.m.Ada, "Ada Quill", minutes(5)), f.m.Ada, { ...same, email: "me@example.com" }],
      [memberCtx(f.m.Ben, "Ben Quill", minutes(5)), f.m.Ada, { ...same, email: "ben.was.here@example.com" }],
    ];
    for (const [ctx, who, input] of refused) await expect(editMemberDetails(f.store, deps.auth, ctx, who, input)).rejects.toBeInstanceOf(Error);
    await removeMember(f.store, clubLedger, staffCtx(minutes(5)), f.m.Cy);
    await expect(editMemberDetails(f.store, deps.auth, staffCtx(minutes(6)), f.m.Cy, { firstName: "Cy", lastName: "Quill", email: "cy.new@example.com", phone: "" })).rejects.toMatchObject({ code: "conflict" });
    expect([await stillIn(deps, ada), await stillIn(deps, ben)]).toEqual(["member", "member"]);
    expect((await f.store.read()).members.find((m) => m.id === f.m.Ada)!.email).toBe("ada@example.com");
  });

  it("changes nothing if the sign-out cannot be done, so staff can simply try again", async () => {
    let broken = true;
    const flaky = (auth: AuthStore): AuthStore =>
      new Proxy(auth, {
        get(target, prop, receiver) {
          if (prop === "revokeSessionsFor") return (...args: Parameters<AuthStore["revokeSessionsFor"]>) => (broken ? Promise.reject(new Error("keys are unreachable")) : target.revokeSessionsFor(...args));
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const { deps, f } = await open(kind, flaky);
    const ada = await signIn(deps, "ada@example.com", f.m.Ada);
    const before = await f.store.read();
    const change = { firstName: "Ada", lastName: "Quill", email: "ada.new@example.com", phone: "" };

    await expect(editMemberDetails(f.store, deps.auth, staffCtx(minutes(5)), f.m.Ada, change)).rejects.toThrow("keys are unreachable");
    const after = await f.store.read();
    expect(after.members.find((m) => m.id === f.m.Ada)!.email).toBe("ada@example.com");
    expect(historyOf(after, f.h.Quill)).toEqual(historyOf(before, f.h.Quill));

    broken = false;
    expect(await editMemberDetails(f.store, deps.auth, staffCtx(minutes(6)), f.m.Ada, change)).toMatchObject({ signInChanged: true });
    expect(await stillIn(deps, ada)).toBeNull();
  });

  it("signs the person out again after the change, in case they signed in with the old address in between", async () => {
    // A sign-in that lands between the first sign-out and the change itself.
    let slipIn: (() => Promise<void>) | null = null;
    const slipper = (auth: AuthStore): AuthStore =>
      new Proxy(auth, {
        get(target, prop, receiver) {
          if (prop === "revokeSessionsFor")
            return async (...args: Parameters<AuthStore["revokeSessionsFor"]>) => {
              const count = await target.revokeSessionsFor(...args);
              const run = slipIn;
              slipIn = null;
              if (run) await run();
              return count;
            };
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const { deps, f } = await open(kind, slipper);
    let late = "";
    slipIn = async () => {
      late = await signIn(deps, "ada@example.com", f.m.Ada, minutes(5));
    };
    const result = await editMemberDetails(f.store, deps.auth, staffCtx(minutes(6)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "ada.new@example.com", phone: "" });
    expect(late).not.toBe("");
    expect(result.signedOut).toBe(1);
    expect(await stillIn(deps, late)).toBeNull();
  });

  it("writes the change to the household's file with old and new values and who made it, and survives a refused second attempt", async () => {
    const { deps, f } = await open(kind);
    const staffCtxNamed: Ctx = { actor: { kind: "staff", label: "Alex Staffer" }, now: minutes(30) };
    await editMemberDetails(f.store, deps.auth, staffCtxNamed, f.m.Dee, { firstName: "Dee", lastName: "Reed", email: "dee.reed@example.com", phone: "206-555-0188" });
    const line = historyOf(await f.store.read(), f.h.Reed)[0];
    expect(line).toMatchObject({ kind: "member_updated", actor: { kind: "staff", label: "Alex Staffer" }, at: minutes(30).toISOString() });
    expect(line.summary).toBe("Details changed for Dee Reed: email from dee@example.com to dee.reed@example.com; phone from no number to 206-555-0188.");
    await expect(editMemberDetails(f.store, deps.auth, staffCtxNamed, f.m.Dee, { firstName: "Dee", lastName: "Reed", email: "dee.reed@example.com", phone: "206-555-0188" })).rejects.toMatchObject({ code: "unchanged" });
    expect(historyOf(await f.store.read(), f.h.Reed).filter((e) => e.kind === "member_updated")).toHaveLength(1);
  });
});

// A staff session is keyed by address, not by member, so it is never touched by a member's change.
describe("a member's email change and staff sessions", () => {
  it("does not touch a staff session that happens to use the same address", async () => {
    const f = await buildFixture("memory");
    const auth = new MemoryAuthStore();
    const staff: SessionSubject = { kind: "staff", email: "ada@example.com" };
    await auth.addSession({ hash: "a".repeat(64), subject: staff, now: NOW, expiresAt: minutes(60) });
    await editMemberDetails(f.store, auth, staffCtx(minutes(1)), f.m.Ada, { firstName: "Ada", lastName: "Quill", email: "ada.new@example.com", phone: "" });
    expect(await auth.findSession("a".repeat(64), minutes(2))).toEqual(staff);
  });
});
