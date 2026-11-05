import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createScratchDb, type ScratchDb } from "../db/testdb";
import { clearOutbox, outboxMailer, outboxMessages, outboxMessagesShared } from "./mail";
import { sharedTestMail } from "./test-mail-instance";

/**
 * With a shared test database the test outbox is kept there as well, so every server shows the same list. Without one it is
 * the server's own memory, as before. Needs CLUB_TEST_DATABASE_URL for the database half; skipped without it.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;
const g = globalThis as unknown as { __ccsTestMail?: unknown };

afterEach(() => {
  delete process.env.CLUB_DATABASE_URL;
  delete g.__ccsTestMail;
  clearOutbox();
});

describe("the test outbox without a shared database", () => {
  it("has no shared copy and reads this server's memory", async () => {
    delete process.env.CLUB_DATABASE_URL;
    expect(sharedTestMail()).toBeNull();
    await outboxMailer.send({ to: "a@example.com", subject: "One", text: "first" }, new Date("2026-10-28T20:00:00Z"));
    expect((await outboxMessagesShared()).map((m) => m.subject)).toEqual(["One"]);
  });
});

describe.skipIf(!ADMIN_URL)("the test outbox with a shared database", () => {
  let db: ScratchDb;
  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("keeps each email in the database too, and the page reads the database, so another server's emails show", async () => {
    process.env.CLUB_DATABASE_URL = db.url;
    await outboxMailer.send({ to: "a@example.com", subject: "From this server", text: "Hello" }, new Date("2026-10-28T20:00:00Z"));
    // Another server wrote one this server never saw.
    await db.client.query(`insert into club.test_mail (sent_at, to_email, subject, body) values ('2026-10-28T20:05:00Z', 'b@example.com', 'From another server', 'Hi')`);
    expect((await outboxMessagesShared()).map((m) => m.subject)).toEqual(["From another server", "From this server"]);
    expect(outboxMessages().map((m) => m.subject)).toEqual(["From this server"]);
  });

  it("shows nothing it was not given, and survives this server's memory being cleared", async () => {
    process.env.CLUB_DATABASE_URL = db.url;
    const before = (await outboxMessagesShared()).length;
    await outboxMailer.send({ to: "c@example.com", subject: "Kept", text: "x" }, new Date("2026-10-28T20:10:00Z"));
    clearOutbox();
    const after = await outboxMessagesShared();
    expect(after).toHaveLength(before + 1);
    expect(after[0]).toEqual({ to: "c@example.com", subject: "Kept", text: "x", at: "2026-10-28T20:10:00.000Z" });
  });

  it("refuses to send when the database refuses, rather than showing an email that was never kept", async () => {
    process.env.CLUB_DATABASE_URL = db.url;
    await expect(outboxMailer.send({ to: "d@example.com", subject: "", text: "x" }, new Date())).rejects.toThrow();
  });
});
