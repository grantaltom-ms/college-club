import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyRule,
  describeRule,
  draftHtml,
  EMPTY_RULE,
  linkContacts,
  matchesRule,
  monthsBefore,
  parseDraft,
  parseRule,
  poolInterests,
  QB_LOAD_DAY,
  ruleIsEmpty,
  ruleSchema,
  samplePool,
  sampleContacts,
  type ListPerson,
  type ListRule,
  type RecentMail,
} from "./email-lists";
import { emailListsPassword, emailListsUnlocked, listsTokenValid, makeListsToken } from "./email-lists-lock";

const TODAY = "2026-11-18";
const rule = (patch: Partial<ListRule>): ListRule => ({ ...EMPTY_RULE, memberTypes: [], interestsAny: [], ...patch });
const person = (patch: Partial<ListPerson>): ListPerson => ({
  key: "k",
  name: "Invented Person",
  memberNumber: null,
  memberType: "Resident",
  joined: "2026-10-01",
  visitsPerMonth: 1,
  visitDays: 5,
  lastVisit: "2026-11-01",
  interests: [],
  shellOutings: 0,
  emails: ["invented@example.org"],
  ...patch,
});

describe("checking a rule", () => {
  it("accepts a full rule and fills in what is missing", () => {
    const r = parseRule({ joinedWithinMonths: 3, interestsAny: ["Rowing "], memberTypes: ["Intermediate"] });
    expect(r).toEqual({ rule: rule({ joinedWithinMonths: 3, interestsAny: ["rowing"], memberTypes: ["Intermediate"] }) });
  });

  it("refuses unknown filters, wrong types, silly numbers and contradictions in words", () => {
    expect(parseRule({ age: 30 })).toEqual({ error: 'Unknown filter "age".' });
    expect(parseRule({ joinedWithinMonths: 2.5 })).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(parseRule({ maxVisitsPerMonth: -1 })).toMatchObject({ error: expect.stringContaining("from 0 to 31") });
    expect(parseRule({ memberTypes: ["Junior"] })).toMatchObject({ error: expect.stringContaining("Resident, Intermediate, Non-Resident") });
    expect(parseRule({ joinedOnOrAfter: "2026-02-30" })).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
    expect(parseRule({ minVisitsPerMonth: 4, maxVisitsPerMonth: 1 })).toEqual({ error: "The fewest visits a month is more than the most." });
    expect(parseRule({ minShellOutings: 3, maxShellOutings: 1 })).toEqual({ error: "The fewest times rowed is more than the most." });
    expect(parseRule({ joinedOnOrAfter: "2026-05-01", joinedOnOrBefore: "2026-04-01" })).toMatchObject({ error: expect.stringContaining("after") });
    expect(parseRule("joined recently")).toEqual({ error: "The filters could not be read." });
    expect(parseRule({ leaveOutRecentlyEmailed: "yes" })).toMatchObject({ error: expect.stringContaining("true or false") });
  });

  it("knows an empty rule (the whole club) when it sees one, even with the recent-email switch on", () => {
    expect(ruleIsEmpty(EMPTY_RULE)).toBe(true);
    expect(ruleIsEmpty(rule({ leaveOutRecentlyEmailed: true }))).toBe(true);
    expect(ruleIsEmpty(rule({ maxShellOutings: 0 }))).toBe(false);
  });

  it("asks Claude for every filter by name, and nothing else", () => {
    const schema = ruleSchema(["rowing"]) as { properties: { rule: { required: string[]; properties: Record<string, unknown> } } };
    expect(schema.properties.rule.required.sort()).toEqual(Object.keys(EMPTY_RULE).sort());
    expect(Object.keys(schema.properties.rule.properties).sort()).toEqual(Object.keys(EMPTY_RULE).sort());
  });
});

describe("applying a rule", () => {
  it("counts months back on the calendar, including short months", () => {
    expect(monthsBefore("2026-11-18", 3)).toBe("2026-08-18");
    expect(monthsBefore("2026-05-31", 3)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-15", 1)).toBe("2025-12-15");
    expect(monthsBefore("2026-01-15", 25)).toBe("2023-12-15");
  });

  it("never treats the QuickBooks load day as a recent join", () => {
    const old = person({ joined: QB_LOAD_DAY });
    expect(matchesRule(old, rule({ joinedWithinMonths: 120 }), TODAY)).toBe(false);
    expect(matchesRule(old, rule({ joinedOnOrAfter: "2010-01-01" }), TODAY)).toBe(false);
    expect(matchesRule(old, rule({ joinedOnOrBefore: "2020-01-01" }), TODAY)).toBe(true);
  });

  it("checks each filter", () => {
    const p = person({ joined: "2026-09-01", memberType: "Intermediate", interests: ["rowing"], visitsPerMonth: 0.5, lastVisit: "2026-10-01", shellOutings: 2 });
    expect(matchesRule(p, rule({ joinedWithinMonths: 3 }), TODAY)).toBe(true);
    expect(matchesRule(p, rule({ joinedWithinMonths: 2 }), TODAY)).toBe(false);
    expect(matchesRule(p, rule({ memberTypes: ["Resident"] }), TODAY)).toBe(false);
    expect(matchesRule(p, rule({ interestsAny: ["bridge", "rowing"] }), TODAY)).toBe(true);
    expect(matchesRule(p, rule({ interestsAny: ["bridge"] }), TODAY)).toBe(false);
    expect(matchesRule(p, rule({ maxVisitsPerMonth: 1 }), TODAY)).toBe(true);
    expect(matchesRule(p, rule({ minVisitsPerMonth: 1 }), TODAY)).toBe(false);
    expect(matchesRule(p, rule({ noVisitInDays: 30 }), TODAY)).toBe(true);
    expect(matchesRule(p, rule({ noVisitInDays: 60 }), TODAY)).toBe(false);
    expect(matchesRule(person({ lastVisit: null }), rule({ noVisitInDays: 60 }), TODAY)).toBe(true);
    expect(matchesRule(p, rule({ maxShellOutings: 0 }), TODAY)).toBe(false);
    expect(matchesRule(p, rule({ minShellOutings: 1, maxShellOutings: 3 }), TODAY)).toBe(true);
  });

  it("splits the matches into who gets it, who has no address and who was emailed this week", () => {
    const pool = [
      person({ name: "B Invented", emails: ["b@example.org"] }),
      person({ name: "A Invented", emails: ["a1@example.org", "A2@example.org"] }),
      person({ name: "C Invented", emails: [] }),
      person({ name: "D Invented", emails: ["d@example.org"], joined: "2020-01-01" }),
    ];
    const recent: RecentMail = new Map([["a2@example.org", [{ title: "Watercooler", sentOn: "2026-11-17" }]]]);
    const r = applyRule(pool, rule({ joinedWithinMonths: 3 }), TODAY, recent);
    expect(r.matched).toBe(3);
    expect(r.people.map((p) => p.name)).toEqual(["A Invented", "B Invented"]);
    expect(r.noEmail.map((p) => p.name)).toEqual(["C Invented"]);
    expect(r.recentAmongIncluded).toBe(1);
    expect(r.people[0].recent).toEqual([{ title: "Watercooler", sentOn: "2026-11-17" }]);
    expect(r.emails).toEqual(["a1@example.org", "a2@example.org", "b@example.org"]);

    const skip = applyRule(pool, rule({ joinedWithinMonths: 3, leaveOutRecentlyEmailed: true }), TODAY, recent);
    expect(skip.people.map((p) => p.name)).toEqual(["B Invented"]);
    expect(skip.leftOutRecent.map((p) => p.name)).toEqual(["A Invented"]);
    expect(skip.emails).toEqual(["b@example.org"]);
  });

  it("finds the erg-class group in the invented club", () => {
    const base = samplePool(TODAY);
    const pool = linkContacts(base.pool, sampleContacts());
    const r = applyRule(pool, rule({ joinedWithinMonths: 3, interestsAny: ["rowing"] }), TODAY, new Map());
    // Finley said "Rowing" only in Mailchimp; Harper has no Mailchimp contact; Emery joined too long ago.
    expect(r.people.map((p) => p.name)).toEqual(["Sample Avery Lindqvist", "Sample Brooke Okafor", "Sample Casey Moreau", "Sample Finley Brooks"]);
    expect(r.noEmail.map((p) => p.name)).toEqual(["Sample Harper Quill"]);
    expect(r.emails).toContain("sam.okafor@example.org");
  });

  it("puts every filter into plain words, with how far the data goes", () => {
    const words = describeRule(
      rule({ joinedWithinMonths: 3, memberTypes: ["Intermediate"], interestsAny: ["rowing"], maxVisitsPerMonth: 1, maxShellOutings: 0, leaveOutRecentlyEmailed: true }),
      TODAY,
      { visitsThrough: "2026-09-27", rowing: { from: "2026-09-27", to: "2026-11-11" } },
    );
    expect(words).toEqual([
      "Joined in the last 3 months (on or after Aug 18, 2026)",
      "Membership type: Intermediate",
      "Said they are interested in rowing",
      "Comes in at most 1 visit a month (visits counted through Sep 27, 2026)",
      "Has not rowed (rowing counted Sep 27, 2026 to Nov 11, 2026)",
      "Leaves out anyone who got a campaign in the last 7 days",
    ]);
    expect(describeRule(rule({ minShellOutings: 1 }), TODAY, { visitsThrough: TODAY, rowing: null })).toEqual(["Rowed at least 1 time (no rowing figures loaded yet)"]);
  });
});

describe("linking Mailchimp contacts", () => {
  it("links by Member # first, then by name, keeps only subscribed addresses and adds the interest groups", () => {
    const pool = [person({ name: "Pat & Sam Invented", memberNumber: "0042", emails: [] }), person({ name: "Lee Invented", memberNumber: null, emails: [] })];
    const linked = linkContacts(pool, [
      { email: "Pat@example.org", status: "subscribed", memberNumber: "42", memberName: null, firstName: "Pat", lastName: "Invented", interests: ["Rowing"] },
      { email: "sam@example.org", status: "unsubscribed", memberNumber: "42", memberName: null, firstName: "Sam", lastName: "Invented", interests: [] },
      { email: "lee@example.org", status: "subscribed", memberNumber: null, memberName: null, firstName: "Lee", lastName: "Invented", interests: ["Bridge"] },
      { email: "nobody@example.org", status: "subscribed", memberNumber: "999", memberName: null, firstName: "No", lastName: "One", interests: [] },
    ]);
    expect(linked[0]).toMatchObject({ emails: ["pat@example.org"], interests: ["rowing"] });
    expect(linked[1]).toMatchObject({ emails: ["lee@example.org"], interests: ["bridge"] });
    expect(poolInterests(linked)).toEqual(["bridge", "rowing"]);
  });
});

describe("the draft", () => {
  it("escapes everything Claude wrote and keeps Mailchimp's greeting and unsubscribe tags", () => {
    const html = draftHtml({ subject: "S", previewText: "P", paragraphs: ['Meet <b>"here"</b> & now'], signOff: "Cheers <3" });
    expect(html).toContain("Meet &lt;b&gt;&quot;here&quot;&lt;/b&gt; &amp; now");
    expect(html).toContain("Cheers &lt;3<br>College Club Seattle");
    expect(html).toContain("*|IF:FNAME|*Hi *|FNAME|*,");
    expect(html).toContain("*|UNSUB|*");
    expect(html).not.toContain("<b>");
  });

  it("refuses a draft with missing or oversized parts", () => {
    expect(parseDraft({ subject: "S", previewText: "P", paragraphs: ["One"], signOff: "Bye" })).not.toBeNull();
    expect(parseDraft({ subject: "", previewText: "P", paragraphs: ["One"], signOff: "Bye" })).toBeNull();
    expect(parseDraft({ subject: "S", previewText: "P", paragraphs: [], signOff: "Bye" })).toBeNull();
    expect(parseDraft({ subject: "S".repeat(151), previewText: "P", paragraphs: ["x"], signOff: "Bye" })).toBeNull();
  });
});

describe("the list builder password", () => {
  it("needs 8 characters, and a pass made with it works until it is changed", () => {
    expect(emailListsPassword({ DASHBOARD_EMAIL_LISTS_PASSWORD: "short" })).toBeNull();
    const now = new Date("2026-11-18T20:00:00Z");
    const token = makeListsToken("lists-password-1", now);
    expect(listsTokenValid(token, "lists-password-1", now)).toBe(true);
    expect(listsTokenValid(token, "lists-password-2", now)).toBe(false);
    expect(listsTokenValid(token, "lists-password-1", new Date("2026-12-19T20:00:00Z"))).toBe(false);
    expect(emailListsUnlocked(token, now, { DASHBOARD_EMAIL_LISTS_PASSWORD: "lists-password-1" })).toBe(true);
    // A Financials pass is not a list builder pass.
    expect(emailListsUnlocked(undefined, now, { DASHBOARD_EMAIL_LISTS_PASSWORD: "lists-password-1" })).toBe(false);
  });
});

describe("the tables", () => {
  for (const file of ["saved_email_lists", "member_interests", "member_rowing"]) {
    it(`${file} has row level security on and no policy`, () => {
      const sql = readFileSync(`db/${file}.sql`, "utf8");
      expect(sql).toContain(`alter table public.${file} enable row level security;`);
      expect(sql).not.toMatch(/create policy/i);
    });
  }
  it("the saved lists table holds no member name or address", () => {
    const sql = readFileSync("db/saved_email_lists.sql", "utf8");
    const columns = /create table[^(]+\(([\s\S]+?)\n\);/.exec(sql)![1];
    expect(columns).not.toMatch(/member_name|email_address/);
  });
});

describe("where Mailchimp is", () => {
  it("follows a test stand-in only where invented data is allowed, never on the live site", async () => {
    const { mailchimpBase } = await import("./mailchimp");
    const stand = "http://localhost:3107/3.0/";
    expect(mailchimpBase("us1", { NODE_ENV: "development", MAILCHIMP_API_BASE: stand })).toBe("http://localhost:3107/3.0");
    expect(mailchimpBase("us1", { NODE_ENV: "production", MAILCHIMP_API_BASE: stand })).toBe("https://us1.api.mailchimp.com/3.0");
    expect(mailchimpBase("us1", { NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1", VERCEL_ENV: "production", MAILCHIMP_API_BASE: stand })).toBe("https://us1.api.mailchimp.com/3.0");
    expect(mailchimpBase("us1", { NODE_ENV: "development" })).toBe("https://us1.api.mailchimp.com/3.0");
  });
});
