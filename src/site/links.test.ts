import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMBER_APP_URL, MEMBER_APP_URL, PUBLIC_SITE_URL, resolveMemberAppUrl } from "./links";

/** Where "Member login" goes: one setting, one default, and nothing unsafe. */
const quiet = () => vi.fn();

describe("where Member login goes", () => {
  it("is this site's own sign-in page when nothing is set", () => {
    const log = quiet();
    for (const raw of [undefined, "", "   "]) expect(resolveMemberAppUrl(raw, log)).toBe("/club/sign-in");
    expect(DEFAULT_MEMBER_APP_URL).toBe("/club/sign-in");
    expect(log).not.toHaveBeenCalled();
  });

  it("is the address in NEXT_PUBLIC_MEMBER_APP_URL, written the same way every time", () => {
    const log = quiet();
    expect(resolveMemberAppUrl("https://members.collegeclubseattle.com", log)).toBe("https://members.collegeclubseattle.com");
    expect(resolveMemberAppUrl("  https://members.collegeclubseattle.com/  ", log)).toBe("https://members.collegeclubseattle.com");
    expect(resolveMemberAppUrl("https://MEMBERS.CollegeClubSeattle.com", log)).toBe("https://members.collegeclubseattle.com");
    expect(resolveMemberAppUrl("https://club.example.org/members/", log)).toBe("https://club.example.org/members");
    expect(resolveMemberAppUrl("https://club.example.org/members?utm=x#top", log)).toBe("https://club.example.org/members");
    // An empty username in front of the @ carries nothing, and is not written back.
    expect(resolveMemberAppUrl("https://@members.collegeclubseattle.com", log)).toBe("https://members.collegeclubseattle.com");
    expect(log).not.toHaveBeenCalled();
  });

  it("allows http only for localhost, so development works and nothing else is sent in the clear", () => {
    const log = quiet();
    expect(resolveMemberAppUrl("http://localhost:3000", log)).toBe("http://localhost:3000");
    expect(resolveMemberAppUrl("http://127.0.0.1:3100/club/sign-in", log)).toBe("http://127.0.0.1:3100/club/sign-in");
    expect(resolveMemberAppUrl("http://members.collegeclubseattle.com", log)).toBe("/club/sign-in");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["//evil.example"],
    ["members.collegeclubseattle.com"],
    ["ftp://members.collegeclubseattle.com"],
    ["https://user:secret@members.collegeclubseattle.com"],
    ["not a web address"],
    ["https://"],
  ])("ignores %s, uses the default, and says so in the log", (raw) => {
    const log = quiet();
    expect(resolveMemberAppUrl(raw, log)).toBe("/club/sign-in");
    expect(log).toHaveBeenCalledWith("NEXT_PUBLIC_MEMBER_APP_URL is not a safe web address (it must start with https://), so /club/sign-in is used instead.");
  });

  it("never puts what was typed into the log line", () => {
    const log = quiet();
    resolveMemberAppUrl("https://user:secret@members.collegeclubseattle.com", log);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("is, in this test run, the default (no setting is present)", () => {
    expect(MEMBER_APP_URL).toBe("/club/sign-in");
  });

  it("sends 'Back to' at the club's current public website", () => {
    expect(PUBLIC_SITE_URL).toBe("https://collegeclubseattle.com");
  });
});
