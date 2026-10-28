import type { Mailer } from "./mail.ts";
import type { MailSettings } from "./mail-settings.ts";

/** Resend's "send an email" address. */
export const RESEND_URL = "https://api.resend.com/emails";
/** How long to wait for Resend before giving up. A sign-in request should never hang on a slow mail service. */
export const RESEND_TIMEOUT_MS = 10_000;

interface Options {
  /** Replaces the network call. Tests pass a pretend Resend here; the live site uses the real one. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Keeps a failure message short and free of the secret key and of the person's address, because messages end up in logs. */
function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[hidden]");
  return out.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * The real sender: one email through Resend, plain text only. It throws, in words that hold neither the key nor the recipient, when
 * Resend cannot be reached or says no; the sign-in then treats that like any other failure to send.
 */
export function createResendMailer(settings: MailSettings, options: Options = {}): Mailer {
  return {
    async send(mail) {
      // Looked up at send time, so a test can swap the network call even after this sender was made.
      const call = options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
      const secrets = [settings.apiKey, mail.to];
      let response: Response;
      try {
        response = await call(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json", "User-Agent": "ccs-reservations/1.0" },
          body: JSON.stringify({ from: settings.from, to: [mail.to], subject: mail.subject, text: mail.text, ...(settings.replyTo ? { reply_to: settings.replyTo } : {}) }),
          signal: AbortSignal.timeout(options.timeoutMs ?? RESEND_TIMEOUT_MS),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        throw new Error(timedOut ? "Resend did not answer in time." : `Resend could not be reached (${scrub(e instanceof Error ? e.message : String(e), secrets)}).`);
      }
      if (response.ok) return;
      let detail = "";
      try {
        const body = (await response.json()) as { name?: unknown; message?: unknown };
        detail = [body.name, body.message].filter((p): p is string => typeof p === "string").join(": ");
      } catch {
        // No readable explanation; the status alone is told.
      }
      throw new Error(`Resend refused the email (status ${response.status}${detail ? `: ${scrub(detail, secrets)}` : ""}).`);
    },
  };
}
