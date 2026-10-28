import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailSettings } from "./mail-settings";
import { createResendMailer, RESEND_TIMEOUT_MS, RESEND_URL } from "./resend";

/**
 * The real sender, always against a pretend Resend (an injected or stubbed `fetch`): these tests never touch the network and
 * never send anything to anyone.
 */

const SETTINGS: MailSettings = { apiKey: "re_AbCdEfGh_1234567890abcdef", from: "College Club Seattle <no-reply@example.org>", replyTo: "membership@example.org" };
const MAIL = { to: "ada@example.com", subject: "Your sign-in link", text: "Open https://club.example.org/club/sign-in/abc\nIt works once." };
const NOW = new Date("2026-10-28T20:00:00Z");

type Call = { url: string; init: RequestInit };
function pretendResend(reply: () => Response | Promise<Response> = () => Response.json({ id: "email_1" })) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return reply();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

async function failure(mailer: ReturnType<typeof createResendMailer>): Promise<string> {
  try {
    await mailer.send(MAIL, NOW);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Expected the send to fail.");
}

afterEach(() => vi.unstubAllGlobals());

describe("sending through Resend", () => {
  it("makes one POST to Resend with the key, the From line, one recipient, the subject and the plain text", async () => {
    const { fn, calls } = pretendResend();
    await createResendMailer(SETTINGS, { fetch: fn }).send(MAIL, NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_URL);
    expect(RESEND_URL).toBe("https://api.resend.com/emails");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${SETTINGS.apiKey}`, "Content-Type": "application/json", "User-Agent": "ccs-reservations/1.0" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      from: "College Club Seattle <no-reply@example.org>",
      to: ["ada@example.com"],
      subject: "Your sign-in link",
      text: MAIL.text,
      reply_to: "membership@example.org",
    });
  });

  it("leaves reply_to out when replies are switched off", async () => {
    const { fn, calls } = pretendResend();
    await createResendMailer({ ...SETTINGS, replyTo: null }, { fetch: fn }).send(MAIL, NOW);
    expect(Object.keys(JSON.parse(calls[0].init.body as string)).sort()).toEqual(["from", "subject", "text", "to"]);
  });

  it("sends plain text only, never HTML, and puts the key nowhere but the header", async () => {
    const { fn, calls } = pretendResend();
    await createResendMailer(SETTINGS, { fetch: fn }).send(MAIL, NOW);
    expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty("html");
    expect(calls[0].init.body).not.toContain(SETTINGS.apiKey);
  });

  it("gives up when Resend is slow, and says so", async () => {
    const hang = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason))));
    const message = await failure(createResendMailer(SETTINGS, { fetch: hang as unknown as typeof fetch, timeoutMs: 20 }));
    expect(message).toBe("Resend did not answer in time.");
  });

  it("waits ten seconds by default", async () => {
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
    const { fn, calls } = pretendResend();
    const spy = vi.spyOn(AbortSignal, "timeout");
    await createResendMailer(SETTINGS, { fetch: fn }).send(MAIL, NOW);
    expect(spy).toHaveBeenCalledWith(10_000);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });

  it("uses whatever fetch exists when it sends, so a stub put in later still catches it", async () => {
    const mailer = createResendMailer(SETTINGS);
    const { fn, calls } = pretendResend();
    vi.stubGlobal("fetch", fn);
    await mailer.send(MAIL, NOW);
    expect(calls).toHaveLength(1);
  });

  describe("when Resend says no", () => {
    it("says the status and Resend's own reason", async () => {
      const { fn } = pretendResend(() => Response.json({ statusCode: 403, name: "validation_error", message: "The example.org domain is not verified." }, { status: 403 }));
      expect(await failure(createResendMailer(SETTINGS, { fetch: fn }))).toBe("Resend refused the email (status 403: validation_error: The example.org domain is not verified.).");
    });

    it("says only the status when the answer cannot be read", async () => {
      const { fn } = pretendResend(() => new Response("<html>Bad gateway</html>", { status: 502 }));
      expect(await failure(createResendMailer(SETTINGS, { fetch: fn }))).toBe("Resend refused the email (status 502).");
    });

    it("never repeats the key or the person's address, even if Resend does", async () => {
      const { fn } = pretendResend(() => Response.json({ name: "validation_error", message: `Invalid to field ${MAIL.to} using key ${SETTINGS.apiKey}` }, { status: 422 }));
      const message = await failure(createResendMailer(SETTINGS, { fetch: fn }));
      expect(message).toBe("Resend refused the email (status 422: validation_error: Invalid to field [hidden] using key [hidden]).");
      expect(message).not.toContain(MAIL.to);
      expect(message).not.toContain(SETTINGS.apiKey);
    });

    it("keeps a long explanation short", async () => {
      const { fn } = pretendResend(() => Response.json({ name: "x", message: "y".repeat(5000) }, { status: 500 }));
      const message = await failure(createResendMailer(SETTINGS, { fetch: fn }));
      expect(message.length).toBeLessThan(260);
    });

    it("ignores an explanation that is not text", async () => {
      const { fn } = pretendResend(() => Response.json({ name: 5, message: { nested: true } }, { status: 500 }));
      expect(await failure(createResendMailer(SETTINGS, { fetch: fn }))).toBe("Resend refused the email (status 500).");
    });

    it("counts only a 2xx answer as sent", async () => {
      for (const status of [200, 201, 202]) {
        const { fn } = pretendResend(() => Response.json({ id: "x" }, { status }));
        await expect(createResendMailer(SETTINGS, { fetch: fn }).send(MAIL, NOW)).resolves.toBeUndefined();
      }
      for (const status of [301, 400, 401, 429, 500]) {
        const { fn } = pretendResend(() => new Response(null, { status }));
        await expect(createResendMailer(SETTINGS, { fetch: fn }).send(MAIL, NOW)).rejects.toThrow(`status ${status}`);
      }
    });
  });

  it("says when Resend cannot be reached, without the key or the address", async () => {
    const down = vi.fn(async () => {
      throw new TypeError(`fetch failed while sending to ${MAIL.to} with ${SETTINGS.apiKey}`);
    });
    const message = await failure(createResendMailer(SETTINGS, { fetch: down as unknown as typeof fetch }));
    expect(message).toBe("Resend could not be reached (fetch failed while sending to [hidden] with [hidden]).");
  });
});
