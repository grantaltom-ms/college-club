import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import raw from "./content/site.json";
import { PAGE_KEYS, PAGE_PATHS, SITE, parseSiteContent, type Page } from "./content";

/** The file as a plain object a test can break one piece of. */
const copy = () => structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const breaks = (change: (c: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = copy();
  change(c);
  return () => parseSiteContent(c);
};

const everyText = (page: Page) => [page.title, page.heading, ...page.intro, page.cta?.label ?? "", page.previewNote ?? "", ...page.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs, ...s.bullets, ...s.cards.flatMap((c) => [c.title, ...c.lines])])];

describe("the public site's words (src/site/content/site.json)", () => {
  it("are all there: the five pages, each with a menu label and a heading", () => {
    expect(PAGE_KEYS).toEqual(["home", "about", "membership", "programs", "contact"]);
    for (const key of PAGE_KEYS) {
      const page = SITE.pages[key];
      expect(page.title, key).not.toBe("");
      expect(page.heading, key).not.toBe("");
      expect(PAGE_PATHS[key].startsWith("/site"), key).toBe(true);
    }
    expect(new Set(PAGE_KEYS.map((k) => SITE.pages[k].title)).size).toBe(PAGE_KEYS.length);
    expect(new Set(Object.values(PAGE_PATHS)).size).toBe(PAGE_KEYS.length);
  });

  it("point the menu at pages that really exist in the app", () => {
    const root = join(__dirname, "../app");
    for (const key of PAGE_KEYS) {
      expect(existsSync(join(root, PAGE_PATHS[key], "page.tsx")), `${key}: ${PAGE_PATHS[key]}`).toBe(true);
    }
  });

  it("carry the club's real contact details exactly as the current public site gives them", () => {
    expect(SITE.club).toMatchObject({ name: "College Club Seattle", phone: "206-622-0624", email: "membership@collegeclubseattle.com" });
    expect(SITE.club.address).toEqual(["11 East Allison Street", "Seattle, WA 98102"]);
    expect(SITE.club.hours).toEqual({ club: "5am-8pm daily, 24/7 fob access", office: "Mon-Fri 8am-4pm, Sat by appointment" });
    // Names and roles only: the directors' own email addresses are never on the public site (Grant, Oct 23).
    expect(SITE.club.people).toEqual([
      { name: "Caitlin Sogn", role: "Admin" },
      { name: "Julia Gamache", role: "Operations" },
    ]);
  });

  it("show one public email address, the membership one, and no director's own address, anywhere in the content", () => {
    const everything = JSON.stringify(SITE);
    expect(new Set(everything.match(/[\w.+-]+@[\w.-]+\.\w+/g))).toEqual(new Set([SITE.club.email]));
    expect(everything).not.toMatch(/caitlin\.sogn@|julia@/i);
  });

  it("show both membership types with their prices, as the current public site does", () => {
    const cards = SITE.pages.membership.sections.flatMap((s) => s.cards);
    expect(cards.map((c) => c.title)).toEqual(["Intermediate", "Resident"]);
    expect(cards[0].lines).toContain("$103/month");
    expect(cards[0].lines).toContain("$350 one time initiation fee");
    expect(cards[1].lines).toContain("$154.50/month");
    expect(cards[1].lines).toContain("$600 one time initiation fee");
  });

  it("repeat the phone and email the same way everywhere they appear, so one change cannot leave an old number behind", () => {
    const all = PAGE_KEYS.flatMap((k) => everyText(SITE.pages[k])).join("\n");
    const phones = new Set(all.match(/\d{3}-\d{3}-\d{4}/g));
    expect([...phones]).toEqual([SITE.club.phone]);
    const emails = new Set(all.match(/[\w.]+@[\w.]+\.\w+/g));
    expect([...emails]).toEqual([SITE.club.email]);
  });

  it("send every button to a page of this site or to the member sign-in, never to another website", () => {
    for (const key of PAGE_KEYS) {
      const cta = SITE.pages[key].cta;
      if (cta) expect([...Object.values(PAGE_PATHS), "/club/sign-in"]).toContain(cta.href);
    }
    expect(SITE.pages.home.cta).toEqual({ label: "Sign in to reserve a boat or class", href: "/club/sign-in" });
    const all = PAGE_KEYS.flatMap((k) => everyText(SITE.pages[k])).join("\n");
    expect(all).not.toMatch(/https?:\/\//);
  });

  it("say where the words came from, and flag the two placeholder pages built only from public sentences", () => {
    expect(SITE.copiedFrom).toContain("Oct 23, 2026");
    expect(SITE.copiedFrom).toContain("directors' own email addresses are deliberately left out");
    expect(SITE.pages.about.previewNote).toMatch(/^Placeholder\./);
    expect(SITE.pages.programs.previewNote).toMatch(/^Placeholder\./);
    expect(SITE.pages.contact.previewNote).toContain("left out on purpose");
  });
});

describe("a mistake in the content file is refused in plain words", () => {
  it("accepts the real file unchanged", () => {
    expect(() => parseSiteContent(copy())).not.toThrow();
  });

  it("names a missing or extra page", () => {
    expect(breaks((c) => delete c.pages.about)).toThrow("Site content: pages.about is missing.");
    expect(breaks((c) => (c.pages.faq = c.pages.about))).toThrow("pages.faq is not something this file knows about. Allowed here: home, about, membership, programs, contact.");
  });

  it("names a typo in a key instead of ignoring it", () => {
    expect(breaks((c) => (c.pages.home.headng = "x"))).toThrow("pages.home.headng is not something this file knows about");
    expect(breaks((c) => (c.club.phon = "x"))).toThrow("club.phon is not something this file knows about");
    expect(breaks((c) => (c.pages.membership.sections[2].cards[0].line = ["x"]))).toThrow("pages.membership.sections[2].cards[0].line is not something");
  });

  it("refuses empty or missing text, with the place it happened", () => {
    expect(breaks((c) => (c.pages.home.heading = "  "))).toThrow("pages.home.heading must not be empty.");
    expect(breaks((c) => delete c.pages.contact.title)).toThrow("pages.contact.title must be text.");
    expect(breaks((c) => (c.pages.about.intro[0] = ""))).toThrow("pages.about.intro[0] must not be empty.");
    expect(breaks((c) => (c.pages.about.sections[0].bullets = "one"))).toThrow("pages.about.sections[0].bullets must be a list of text.");
  });

  it("refuses text that is far too long for the page", () => {
    expect(breaks((c) => (c.pages.home.heading = "x".repeat(121)))).toThrow("pages.home.heading must be 120 characters or fewer.");
    expect(breaks((c) => (c.pages.about.previewNote = "x".repeat(401)))).toThrow("must be 400 characters or fewer.");
  });

  it("refuses an empty section or a card with nothing on it", () => {
    expect(breaks((c) => (c.pages.about.sections[0] = { heading: "Empty" }))).toThrow("pages.about.sections[0] is empty: give it paragraphs, bullets or cards.");
    expect(breaks((c) => (c.pages.home.sections[0].cards[0].lines = []))).toThrow("pages.home.sections[0].cards[0].lines needs at least one line.");
    expect(breaks((c) => delete c.pages.home.sections[0].cards[1].title)).toThrow("pages.home.sections[0].cards[1].title must be text.");
  });

  it("refuses a phone number or email that cannot be right", () => {
    expect(breaks((c) => (c.club.phone = "622-0624"))).toThrow('club.phone "622-0624" must look like 206-555-0100.');
    expect(breaks((c) => (c.club.phone = "(206) 622-0624"))).toThrow("must look like 206-555-0100.");
    expect(breaks((c) => (c.club.email = "membership-at-club"))).toThrow('club.email "membership-at-club" does not look like an email address.');
    expect(breaks((c) => (c.club.people[1].email = "julia@collegeclubseattle.com"))).toThrow("club.people[1].email is not something this file knows about");
  });

  it("refuses a button that goes anywhere but this site or the sign-in", () => {
    for (const href of ["https://icrew.club/logon", "http://example.com", "//evil.example", "/club/admin", "/club", "javascript:alert(1)", "/site/../club/admin", ""]) {
      expect(breaks((c) => (c.pages.home.cta.href = href)), href).toThrow(/pages\.home\.cta\.href/);
    }
    expect(breaks((c) => (c.pages.home.cta.href = "/site/membership"))).not.toThrow();
    expect(breaks((c) => (c.pages.home.cta.link = "/site"))).toThrow("pages.home.cta.link is not something");
  });

  it("refuses an address with no lines, and people that are not a list", () => {
    expect(breaks((c) => (c.club.address = []))).toThrow("club.address needs at least one line.");
    expect(breaks((c) => (c.club.people = "Caitlin"))).toThrow("club.people must be a list (it may be empty).");
    expect(breaks((c) => (c.club.people = []))).not.toThrow();
  });

  it("refuses a file that is not an object, or sections that are not a list", () => {
    expect(() => parseSiteContent(null)).toThrow("Site content: the file must be an object.");
    expect(() => parseSiteContent([])).toThrow("the file must be an object.");
    expect(breaks((c) => (c.pages.home.sections = "none"))).toThrow("pages.home.sections must be a list (it may be empty).");
    expect(breaks((c) => (c.pages.contact.sections = []))).not.toThrow();
  });

  it("trims stray spaces from the words", () => {
    const c = copy();
    c.pages.home.heading = "  Welcome  ";
    expect(parseSiteContent(c).pages.home.heading).toBe("Welcome");
  });
});
