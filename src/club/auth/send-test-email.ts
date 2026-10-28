import { pathToFileURL } from "node:url";
import { normalizeEmail } from "./email.ts";
import { MailSettingsError, parseMailSettings } from "./mail-settings.ts";
import { createResendMailer } from "./resend.ts";

/**
 * `npm run mail:test -- someone@example.org`: sends ONE test email through the same sender the club's sign-in uses, so the Resend
 * account, the verified domain and the From address can be proved before any member signs in. The member area is hidden on the
 * live site until switch-on, so this is the only way to try the real sender beforehand. It reads the same private settings
 * (RESEND_API_KEY, CLUB_MAIL_FROM, CLUB_MAIL_REPLY_TO) from the environment or from .env.local, and sends nothing else to anyone.
 */

interface Run {
  fetch?: typeof fetch;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Returns the exit code: 0 sent, 1 could not send, 2 the command was used wrongly. */
export async function runSendTest(args: string[], env: Partial<Record<string, string | undefined>>, run: Run): Promise<number> {
  const to = args.length === 1 ? normalizeEmail(args[0]) : null;
  if (!to) {
    run.error("Give one email address to send the test to, for example: npm run mail:test -- you@example.org");
    return 2;
  }
  let settings;
  try {
    settings = parseMailSettings(env);
  } catch (e) {
    if (!(e instanceof MailSettingsError)) throw e;
    run.error(e.message);
    return 1;
  }
  if (!settings) {
    run.error("RESEND_API_KEY is not set. Put it (with CLUB_MAIL_FROM) in .env.local, never in chat or in the code, and run this again.");
    return 1;
  }
  try {
    await createResendMailer(settings, { fetch: run.fetch }).send(
      {
        to,
        subject: "College Club Seattle: test email",
        text: ["This is a test email from the College Club Seattle reservation system.", "", "If you can read it, the club's email sender works. Nothing else was sent to anyone, and you do not need to reply."].join("\n"),
      },
      new Date(),
    );
  } catch (e) {
    run.error(e instanceof Error ? e.message : String(e));
    run.error("Common causes: the club's domain is not verified in Resend yet, the From address is not on that verified domain, or the key was made for a different Resend account.");
    return 1;
  }
  run.log(`Sent one test email to ${to} from ${settings.from}${settings.replyTo ? `, with replies going to ${settings.replyTo}` : ", with replies switched off"}.`);
  run.log("Check that inbox, and its spam folder. In Resend, also switch off link tracking for the domain, so a sign-in link is not rewritten.");
  return 0;
}

// Runs only when this file is the command being run, not when a test or the website loads it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runSendTest(process.argv.slice(2), process.env, { log: console.log, error: console.error });
}
