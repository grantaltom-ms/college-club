import { afterEach, describe, expect, it } from "vitest";
import { clearOutbox, getMailer, outboxMailer, outboxMessages } from "./mail";

afterEach(clearOutbox);

describe("the test outbox", () => {
  it("keeps what was 'sent', newest first, and nothing is sent anywhere", async () => {
    await outboxMailer.send({ to: "a@example.com", subject: "One", text: "first" }, new Date("2026-10-28T20:00:00Z"));
    await outboxMailer.send({ to: "b@example.com", subject: "Two", text: "second" }, new Date("2026-10-28T20:01:00Z"));
    expect(outboxMessages().map((m) => [m.to, m.subject, m.at])).toEqual([
      ["b@example.com", "Two", "2026-10-28T20:01:00.000Z"],
      ["a@example.com", "One", "2026-10-28T20:00:00.000Z"],
    ]);
  });

  it("keeps only the newest 50", async () => {
    for (let i = 0; i < 60; i++) await outboxMailer.send({ to: `p${i}@example.com`, subject: String(i), text: "x" }, new Date());
    const all = outboxMessages();
    expect(all).toHaveLength(50);
    expect(all[0].subject).toBe("59");
    expect(all.at(-1)!.subject).toBe("10");
  });

  it("hands out copies, so reading cannot change it", async () => {
    await outboxMailer.send({ to: "a@example.com", subject: "One", text: "first" }, new Date());
    outboxMessages()[0].subject = "changed";
    expect(outboxMessages()[0].subject).toBe("One");
  });

  it("is the sender only where invented data is allowed", () => {
    expect(getMailer({ NODE_ENV: "development" })).toBe(outboxMailer);
    expect(getMailer({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBe(outboxMailer);
    expect(getMailer({ NODE_ENV: "production" })).toBeNull();
    expect(getMailer({ NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production" })).toBeNull();
  });
});
