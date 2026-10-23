import { afterEach, describe, expect, it } from "vitest";
import { buildFixture, databaseUrls, STORE_KINDS, type Fixture, type StoreKind } from "../engine/testkit";
import { createClubPool } from "../store/postgres";
import { hashSecret, newSecret } from "./tokens";
import { PgAuthStore } from "./postgres";
import { MemoryAuthStore, type AuthStore } from "./store";

/**
 * Sign-in links and signed-in browsers must behave identically in memory and in Postgres: a link works once and only while
 * alive (even when many people press it at the same instant), a browser stays signed in until it runs out or is signed out,
 * and signing a person out signs out every browser of theirs and nobody else's.
 */

const NOW = new Date("2026-10-28T20:00:00Z");
const minutes = (m: number) => new Date(NOW.getTime() + m * 60000);
const pools: { end(): Promise<void> }[] = [];
afterEach(async () => {
  while (pools.length > 0) await pools.pop()!.end();
});

async function open(kind: StoreKind): Promise<{ auth: AuthStore; f: Fixture }> {
  const f = await buildFixture(kind);
  if (kind === "memory") return { auth: new MemoryAuthStore(), f };
  const pool = createClubPool(databaseUrls.get(f.store)!, 12);
  pools.push(pool);
  return { auth: new PgAuthStore(pool), f };
}

describe.each(STORE_KINDS)("sign-in links and sessions on the %s store", (kind) => {
  describe("sign-in links", () => {
    it("are found while alive, with the address they were made for, and found again until used", async () => {
      const { auth } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) });
      expect(await auth.findToken(hash, NOW)).toEqual({ email: "ada@example.com" });
      expect(await auth.findToken(hash, minutes(14))).toEqual({ email: "ada@example.com" });
      expect(await auth.findToken(hashSecret(newSecret()), NOW)).toBeNull();
    });

    it("run out at their expiry moment, exactly", async () => {
      const { auth } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) });
      expect(await auth.findToken(hash, new Date(minutes(15).getTime() - 1))).not.toBeNull();
      expect(await auth.findToken(hash, minutes(15))).toBeNull();
      expect(await auth.consumeToken(hash, minutes(15))).toBeNull();
      expect(await auth.consumeToken(hash, minutes(16))).toBeNull();
    });

    it("are used up by the first person to press them, and no one else", async () => {
      const { auth } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) });
      expect(await auth.consumeToken(hash, minutes(1))).toEqual({ email: "ada@example.com" });
      expect(await auth.consumeToken(hash, minutes(2))).toBeNull();
      expect(await auth.findToken(hash, minutes(2))).toBeNull();
    });

    it("are used up by exactly one of ten people pressing at the same instant", async () => {
      const { auth } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) });
      const results = await Promise.all(Array.from({ length: 10 }, () => auth.consumeToken(hash, minutes(1))));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it("are counted per address, used or not, from a moment on", async () => {
      const { auth } = await open(kind);
      const make = async (email: string, at: Date) => {
        const hash = hashSecret(newSecret());
        await auth.addToken({ hash, email, now: at, expiresAt: new Date(at.getTime() + 15 * 60000) });
        return hash;
      };
      const used = await make("ada@example.com", minutes(-70));
      await auth.consumeToken(used, minutes(-69));
      await make("ada@example.com", minutes(-30));
      await make("ada@example.com", minutes(-10));
      await make("ben@example.com", minutes(-10));
      expect(await auth.countTokensSince("ada@example.com", minutes(-60))).toBe(2);
      expect(await auth.countTokensSince("ada@example.com", minutes(-120))).toBe(3);
      expect(await auth.countTokensSince("ada@example.com", minutes(-30))).toBe(2); // a link made exactly then counts
      expect(await auth.countTokensSince("ben@example.com", minutes(-60))).toBe(1);
      expect(await auth.countTokensSince("cy@example.com", minutes(-60))).toBe(0);
    });

    it("cannot be made twice with the same code", async () => {
      const { auth } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) });
      await expect(auth.addToken({ hash, email: "ada@example.com", now: NOW, expiresAt: minutes(15) })).rejects.toThrow();
    });
  });

  describe("signed-in browsers", () => {
    it("are found as a member or as staff, while they last", async () => {
      const { auth, f } = await open(kind);
      const member = hashSecret(newSecret());
      const staff = hashSecret(newSecret());
      await auth.addSession({ hash: member, subject: { kind: "member", memberId: f.m.Ada }, now: NOW, expiresAt: minutes(60 * 24 * 30) });
      await auth.addSession({ hash: staff, subject: { kind: "staff", email: "alex@example.org" }, now: NOW, expiresAt: minutes(60 * 24 * 30) });
      expect(await auth.findSession(member, minutes(60))).toEqual({ kind: "member", memberId: f.m.Ada });
      expect(await auth.findSession(staff, minutes(60))).toEqual({ kind: "staff", email: "alex@example.org" });
      expect(await auth.findSession(hashSecret(newSecret()), NOW)).toBeNull();
    });

    it("run out at their expiry moment, exactly", async () => {
      const { auth, f } = await open(kind);
      const hash = hashSecret(newSecret());
      await auth.addSession({ hash, subject: { kind: "member", memberId: f.m.Ada }, now: NOW, expiresAt: minutes(60) });
      expect(await auth.findSession(hash, new Date(minutes(60).getTime() - 1))).not.toBeNull();
      expect(await auth.findSession(hash, minutes(60))).toBeNull();
    });

    it("are signed out one at a time, and signing out twice is fine", async () => {
      const { auth, f } = await open(kind);
      const a = hashSecret(newSecret());
      const b = hashSecret(newSecret());
      for (const hash of [a, b]) await auth.addSession({ hash, subject: { kind: "member", memberId: f.m.Ada }, now: NOW, expiresAt: minutes(600) });
      await auth.revokeSession(a, minutes(1));
      await auth.revokeSession(a, minutes(2));
      await auth.revokeSession(hashSecret(newSecret()), minutes(2)); // nothing to sign out: fine
      expect(await auth.findSession(a, minutes(3))).toBeNull();
      expect(await auth.findSession(b, minutes(3))).not.toBeNull();
    });

    it("are all signed out for one person, and only that person", async () => {
      const { auth, f } = await open(kind);
      const adaPhone = hashSecret(newSecret());
      const adaLaptop = hashSecret(newSecret());
      const ben = hashSecret(newSecret());
      const staff = hashSecret(newSecret());
      await auth.addSession({ hash: adaPhone, subject: { kind: "member", memberId: f.m.Ada }, now: NOW, expiresAt: minutes(600) });
      await auth.addSession({ hash: adaLaptop, subject: { kind: "member", memberId: f.m.Ada }, now: NOW, expiresAt: minutes(600) });
      await auth.addSession({ hash: ben, subject: { kind: "member", memberId: f.m.Ben }, now: NOW, expiresAt: minutes(600) });
      await auth.addSession({ hash: staff, subject: { kind: "staff", email: "alex@example.org" }, now: NOW, expiresAt: minutes(600) });
      expect(await auth.revokeSessionsFor({ kind: "member", memberId: f.m.Ada }, minutes(1))).toBe(2);
      expect(await auth.revokeSessionsFor({ kind: "member", memberId: f.m.Ada }, minutes(2))).toBe(0);
      expect(await auth.findSession(adaPhone, minutes(3))).toBeNull();
      expect(await auth.findSession(adaLaptop, minutes(3))).toBeNull();
      expect(await auth.findSession(ben, minutes(3))).not.toBeNull();
      expect(await auth.findSession(staff, minutes(3))).not.toBeNull();
      expect(await auth.revokeSessionsFor({ kind: "staff", email: "alex@example.org" }, minutes(4))).toBe(1);
      expect(await auth.findSession(staff, minutes(5))).toBeNull();
      expect(await auth.findSession(ben, minutes(5))).not.toBeNull();
    });
  });
});
