import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOutbox, getMailer, outboxMailer, outboxMessages } from "./mail";
import { RESEND_URL } from "./resend";

afterEach(() => {
  clearOutbox();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

const MAIL = { to: "ada@example.com", subject: "Your sign-in link", text: "Open the link." };
const NOW = new Date("2026-10-28T20:00:00Z");
const REAL = { RESEND_API_KEY: "re_AbCdEfGh_1234567890abcdef", CLUB_MAIL_FROM: "College Club Seattle <no-reply@example.org>" };
const AREA_ON_FOR_REAL_MEMBERS = { outbox: false, club: true };

function pretendResend() {
  const fn = vi.fn(async (...args: unknown[]) => {
    void args;
    return Response.json({ id: "email_1" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("choosing who sends", () => {
  it("is always the test outbox where invented data is allowed, even with every Resend setting present, and nothing leaves the server", async () => {
    const network = pretendResend();
    for (const env of [{ ...REAL, NODE_ENV: "development" }, { ...REAL, NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" }]) {
      const mailer = getMailer(env);
      expect(mailer).toBe(outboxMailer);
      await mailer!.send(MAIL, NOW);
    }
    expect(network).not.toHaveBeenCalled();
    expect(outboxMessages()).toHaveLength(2);
  });

  it("is Resend where the member area is on for real members and the settings are complete", async () => {
    const network = pretendResend();
    const mailer = getMailer({ ...REAL, NODE_ENV: "production" }, AREA_ON_FOR_REAL_MEMBERS);
    expect(mailer).not.toBeNull();
    expect(mailer).not.toBe(outboxMailer);
    await mailer!.send(MAIL, NOW);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0][0]).toBe(RESEND_URL);
    expect(outboxMessages()).toEqual([]);
  });

  it("is nobody where the member area is on for real members but no key is set", () => {
    expect(getMailer({ NODE_ENV: "production" }, AREA_ON_FOR_REAL_MEMBERS)).toBeNull();
    expect(getMailer({ NODE_ENV: "production", RESEND_API_KEY: "  " }, AREA_ON_FOR_REAL_MEMBERS)).toBeNull();
  });

  it("is nobody where the member area is off, even with a full set of Resend settings", () => {
    expect(getMailer({ ...REAL, NODE_ENV: "production" }, { outbox: false, club: false })).toBeNull();
    expect(getMailer({ ...REAL, NODE_ENV: "production" })).toBeNull();
    expect(getMailer({ ...REAL, NODE_ENV: "production", VERCEL_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })).toBeNull();
  });

  it("is nobody, and says why once in words, when the settings are wrong", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrong = { RESEND_API_KEY: REAL.RESEND_API_KEY, CLUB_MAIL_FROM: "once-only-nonsense", NODE_ENV: "production" };
    expect(getMailer(wrong, AREA_ON_FOR_REAL_MEMBERS)).toBeNull();
    expect(getMailer(wrong, AREA_ON_FOR_REAL_MEMBERS)).toBeNull();
    expect(getMailer(wrong, AREA_ON_FOR_REAL_MEMBERS)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0][0]);
    expect(line).toBe("Real email is not switched on: CLUB_MAIL_FROM is not a usable email address (for example no-reply@example.org or College Club Seattle <no-reply@example.org>).");
    expect(line).not.toContain(REAL.RESEND_API_KEY);
  });

  it("does not log a mistake in the settings where the test outbox is in use", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(getMailer({ RESEND_API_KEY: "not-a-key", NODE_ENV: "development" })).toBe(outboxMailer);
    expect(logged).not.toHaveBeenCalled();
  });

  it("reports a different mistake when the settings change", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    getMailer({ RESEND_API_KEY: "re_AbCdEfGh_1234567890abcdef", NODE_ENV: "production" }, AREA_ON_FOR_REAL_MEMBERS);
    getMailer({ RESEND_API_KEY: "badly pasted key", NODE_ENV: "production" }, AREA_ON_FOR_REAL_MEMBERS);
    expect(logged).toHaveBeenCalledTimes(2);
    expect(String(logged.mock.calls[0][0])).toContain("CLUB_MAIL_FROM is missing");
    expect(String(logged.mock.calls[1][0])).toContain("does not look like a Resend key");
  });
});
