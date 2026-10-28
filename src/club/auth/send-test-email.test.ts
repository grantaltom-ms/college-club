import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RESEND_URL } from "./resend";
import { runSendTest } from "./send-test-email";

/** `npm run mail:test`: one test email through the club's real sender, tried here against a pretend Resend only. */

const KEY = "re_AbCdEfGh_1234567890abcdef";
const FROM = "College Club Seattle <no-reply@example.org>";
const REAL = { RESEND_API_KEY: KEY, CLUB_MAIL_FROM: FROM };

function run(args: string[], env: Record<string, string | undefined>, reply: () => Response = () => Response.json({ id: "email_1" })) {
  const fetched: { url: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    fetched.push({ url: String(url), body: JSON.parse(init!.body as string) });
    return reply();
  });
  const out: string[] = [];
  const err: string[] = [];
  const done = runSendTest(args, env, { fetch: fn as unknown as typeof fetch, log: (l) => out.push(l), error: (l) => err.push(l) });
  return { done, fetched, out, err };
}

describe("the test email command", () => {
  it("sends exactly one email to the address given, through the club's sender", async () => {
    const r = run(["Ada@Example.com"], REAL);
    expect(await r.done).toBe(0);
    expect(r.fetched).toHaveLength(1);
    expect(r.fetched[0].url).toBe(RESEND_URL);
    expect(r.fetched[0].body).toMatchObject({ from: FROM, to: ["ada@example.com"], subject: "College Club Seattle: test email", reply_to: "membership@collegeclubseattle.com" });
    expect(String(r.fetched[0].body.text)).toContain("test email from the College Club Seattle reservation system");
    expect(r.err).toEqual([]);
  });

  it("says where it went, what the From line was, and where replies go", async () => {
    const r = run(["ada@example.com"], REAL);
    await r.done;
    expect(r.out[0]).toBe(`Sent one test email to ada@example.com from ${FROM}, with replies going to membership@collegeclubseattle.com.`);
    expect(r.out[1]).toContain("spam folder");
    expect(r.out[1]).toContain("link tracking");
  });

  it("says so when replies are switched off", async () => {
    const r = run(["ada@example.com"], { ...REAL, CLUB_MAIL_REPLY_TO: "none" });
    await r.done;
    expect(r.out[0]).toBe(`Sent one test email to ada@example.com from ${FROM}, with replies switched off.`);
    expect(r.fetched[0].body).not.toHaveProperty("reply_to");
  });

  it.each([[[]], [["ada@example.com", "bob@example.com"]], [["not an address"]], [[""]]])("sends nothing and explains the command when it is used as %j", async (args) => {
    const r = run(args as string[], REAL);
    expect(await r.done).toBe(2);
    expect(r.fetched).toEqual([]);
    expect(r.err).toEqual(["Give one email address to send the test to, for example: npm run mail:test -- you@example.org"]);
  });

  it("sends nothing and says what is missing when there is no key", async () => {
    const r = run(["ada@example.com"], { CLUB_MAIL_FROM: FROM });
    expect(await r.done).toBe(1);
    expect(r.fetched).toEqual([]);
    expect(r.err).toEqual(["RESEND_API_KEY is not set. Put it (with CLUB_MAIL_FROM) in .env.local, never in chat or in the code, and run this again."]);
  });

  it("sends nothing and says what is wrong when a setting is wrong, without repeating the key", async () => {
    const r = run(["ada@example.com"], { RESEND_API_KEY: KEY });
    expect(await r.done).toBe(1);
    expect(r.fetched).toEqual([]);
    expect(r.err.join("\n")).toContain("CLUB_MAIL_FROM is missing");
    expect(r.err.join("\n")).not.toContain(KEY);
  });

  it("tells what Resend said, and the usual causes, when it refuses", async () => {
    const r = run(["ada@example.com"], REAL, () => Response.json({ name: "validation_error", message: "The example.org domain is not verified." }, { status: 403 }));
    expect(await r.done).toBe(1);
    expect(r.err[0]).toBe("Resend refused the email (status 403: validation_error: The example.org domain is not verified.).");
    expect(r.err[1]).toContain("domain is not verified in Resend");
    expect(r.out).toEqual([]);
    expect([...r.out, ...r.err].join("\n")).not.toContain(KEY);
  });

  it("really runs when it is the command, and does nothing when it is only loaded", () => {
    // Run as a program with no address: the usage line and exit code 2 prove the command ran. (No key is given, so nothing could be sent.)
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(__dirname, "send-test-email.ts")], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", RESEND_API_KEY: "", CLUB_MAIL_FROM: "" },
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Give one email address to send the test to");
  });
});
