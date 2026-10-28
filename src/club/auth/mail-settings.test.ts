import { describe, expect, it } from "vitest";
import site from "../../site/content/site.json";
import { DEFAULT_REPLY_TO, MailSettingsError, parseMailSettings } from "./mail-settings";

const KEY = "re_AbCdEfGh_1234567890abcdef";
const FROM = "College Club Seattle <no-reply@example.org>";
const base = { RESEND_API_KEY: KEY, CLUB_MAIL_FROM: FROM };

function refusal(env: Record<string, string | undefined>): string {
  try {
    parseMailSettings(env);
  } catch (e) {
    expect(e).toBeInstanceOf(MailSettingsError);
    return (e as Error).message;
  }
  throw new Error("Expected the settings to be refused.");
}

describe("the real email sender's settings", () => {
  it("means no real sender when there is no key, whatever else is set", () => {
    expect(parseMailSettings({})).toBeNull();
    expect(parseMailSettings({ RESEND_API_KEY: "", CLUB_MAIL_FROM: FROM })).toBeNull();
    expect(parseMailSettings({ RESEND_API_KEY: "   ", CLUB_MAIL_FROM: "not even an address" })).toBeNull();
  });

  it("reads a complete set, trimming the key and the address", () => {
    expect(parseMailSettings({ RESEND_API_KEY: `  ${KEY}  `, CLUB_MAIL_FROM: `  ${FROM}  ` })).toEqual({ apiKey: KEY, from: FROM, replyTo: DEFAULT_REPLY_TO });
  });

  it("accepts a bare From address and writes it the way the sign-in compares addresses (lower case)", () => {
    expect(parseMailSettings({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "No-Reply@Example.ORG" })!.from).toBe("no-reply@example.org");
  });

  it("tidies the spacing around a name", () => {
    expect(parseMailSettings({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "  College Club Seattle   <no-reply@example.org>" })!.from).toBe("College Club Seattle <no-reply@example.org>");
  });

  it("allows a name of exactly 60 characters and refuses 61", () => {
    expect(parseMailSettings({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: `${"x".repeat(60)} <a@example.org>` })!.from).toBe(`${"x".repeat(60)} <a@example.org>`);
    expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: `${"x".repeat(61)} <a@example.org>` })).toBe("CLUB_MAIL_FROM: the name is longer than 60 characters.");
  });

  describe("replies", () => {
    it("go to the club's public membership address unless told otherwise", () => {
      expect(parseMailSettings(base)!.replyTo).toBe("membership@collegeclubseattle.com");
      expect(parseMailSettings({ ...base, CLUB_MAIL_REPLY_TO: "   " })!.replyTo).toBe(DEFAULT_REPLY_TO);
    });

    it("use the same address as the public Contact page, so the two cannot drift apart", () => {
      expect(DEFAULT_REPLY_TO).toBe(site.club.email);
    });

    it("can go to another address, or nowhere", () => {
      expect(parseMailSettings({ ...base, CLUB_MAIL_REPLY_TO: " Front.Desk@Example.org " })!.replyTo).toBe("front.desk@example.org");
      expect(parseMailSettings({ ...base, CLUB_MAIL_REPLY_TO: "none" })!.replyTo).toBeNull();
      expect(parseMailSettings({ ...base, CLUB_MAIL_REPLY_TO: " None " })!.replyTo).toBeNull();
    });

    it("refuses a reply address that is not one", () => {
      expect(refusal({ ...base, CLUB_MAIL_REPLY_TO: "front desk" })).toBe("CLUB_MAIL_REPLY_TO is not a usable email address. Use an address, or the word none to turn replies off.");
      expect(refusal({ ...base, CLUB_MAIL_REPLY_TO: "a@example.org, b@example.org" })).toContain("CLUB_MAIL_REPLY_TO");
    });
  });

  describe("mistakes, refused in words", () => {
    it.each(["oops", "re_short", `"${KEY}"`, `${KEY} extra`, "re_has space inside1234", "RE_AbCdEfGh_1234567890", `re_${"a".repeat(201)}`])("refuses the key %j without repeating it", (key) => {
      const message = refusal({ RESEND_API_KEY: key, CLUB_MAIL_FROM: FROM });
      expect(message).toBe("RESEND_API_KEY does not look like a Resend key (they start with re_). Check it was pasted whole, with no spaces or quotation marks.");
      expect(message).not.toContain(key);
    });

    it("never repeats a good key in a message about another setting", () => {
      expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "nonsense" })).not.toContain(KEY);
      expect(refusal({ RESEND_API_KEY: KEY })).not.toContain(KEY);
    });

    it("refuses a key with no From address", () => {
      expect(refusal({ RESEND_API_KEY: KEY })).toBe("CLUB_MAIL_FROM is missing. Set it to the address the emails come from, for example no-reply@example.org or College Club Seattle <no-reply@example.org>.");
      expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "   " })).toContain("CLUB_MAIL_FROM is missing");
    });

    it.each(["nonsense", "a@b", "two@example.org, three@example.org", "Club <not an address>", "Club <a@example.org> extra", "ada..quill@example.org"])("refuses the From address %j", (from) => {
      expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: from })).toContain("CLUB_MAIL_FROM is not a usable email address");
    });

    it("refuses brackets with no name", () => {
      expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "<no-reply@example.org>" })).toContain("angle brackets but no name");
    });

    it.each([['Club "Seattle" <a@example.org>'], ["Club @ Seattle <a@example.org>"], ["Club\\Seattle <a@example.org>"], ["Club\nBcc: someone@example.org <a@example.org>"], ["Club\u0000 <a@example.org>"]])(
      "refuses a name that could bend the message: %j",
      (from) => {
        expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: from })).toBe("CLUB_MAIL_FROM: the name cannot contain quotation marks, backslashes, @ signs or line breaks.");
      },
    );

    it("refuses a line break after the address, which would add a header", () => {
      expect(refusal({ RESEND_API_KEY: KEY, CLUB_MAIL_FROM: "Club <a@example.org>\nBcc: someone@example.org" })).toContain("CLUB_MAIL_FROM");
    });
  });
});
