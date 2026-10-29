import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import raw from "./content/site.json";
import { HOME_PATH, NAV, PAGE_KEYS, PAGE_PATHS, SITE, parseSiteContent, phoneHref, type Page } from "./content";

/** The file as a plain object a test can break one piece of. */
const copy = () => structuredClone(raw) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const breaks = (change: (c: Record<string, any>) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = copy();
  change(c);
  return () => parseSiteContent(c);
};

const everyText = (page: Page) => [page.title, page.heading, ...page.intro, page.cta?.label ?? "", page.previewNote ?? "", ...page.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs, ...s.bullets, ...s.cards.flatMap((c) => [c.title, ...c.lines])])];

/** Every word the public site can show, in one string. */
const allWords = () => JSON.stringify(SITE);

describe("the public site's words (src/site/content/site.json)", () => {
  it("are all there: the homepage and five more pages, each with a menu label and a heading", () => {
    expect(PAGE_KEYS).toEqual(["about", "programs", "membership", "tour", "contact"]);
    for (const key of PAGE_KEYS) {
      const page = SITE.pages[key];
      expect(page.title, key).not.toBe("");
      expect(page.heading, key).not.toBe("");
      expect(PAGE_PATHS[key].startsWith("/site"), key).toBe(true);
    }
    expect(new Set(PAGE_KEYS.map((k) => SITE.pages[k].title)).size).toBe(PAGE_KEYS.length);
    expect(new Set([HOME_PATH, ...Object.values(PAGE_PATHS)]).size).toBe(PAGE_KEYS.length + 1);
  });

  it("put the menu in the order the design asks for, with the design's names", () => {
    expect(NAV.map((n) => n.label)).toEqual(["Home", "About", "Our Programs", "Membership", "Request a Tour", "Contact"]);
    expect(NAV.map((n) => n.href)).toEqual(["/site", "/site/about", "/site/programs", "/site/membership", "/site/request-a-tour", "/site/contact"]);
  });

  it("point the menu at pages that really exist in the app", () => {
    const root = join(__dirname, "../app");
    for (const { href, label } of NAV) {
      expect(existsSync(join(root, href, "page.tsx")), `${label}: ${href}`).toBe(true);
    }
  });

  it("carry the club's real contact details as the current public site gives them, with the phone written the design's way", () => {
    expect(SITE.club).toMatchObject({ name: "College Club Seattle", phone: "(206) 622-0624", email: "membership@collegeclubseattle.com" });
    expect(SITE.club.address).toEqual(["11 East Allison Street", "Seattle, WA 98102"]);
    expect(SITE.club.hours).toEqual({ club: "5am-8pm daily, 24/7 fob access", office: "Mon-Fri 8am-4pm, Sat by appointment" });
    // Names and roles only: the directors' own email addresses are never on the public site (Grant, Oct 23).
    expect(SITE.club.people).toEqual([
      { name: "Caitlin Sogn", role: "Admin" },
      { name: "Julia Gamache", role: "Operations" },
    ]);
    expect(phoneHref(SITE.club.phone)).toBe("tel:2066220624");
  });

  it("show one public email address, the membership one, and no director's own address, anywhere in the content", () => {
    const everything = allWords();
    expect(new Set(everything.match(/[\w.+-]+@[\w.-]+\.\w+/g))).toEqual(new Set([SITE.club.email]));
    expect(everything).not.toMatch(/caitlin\.sogn@|julia@/i);
  });

  it("show one phone number, the club's main line, written one way, and nothing that looks like another", () => {
    const everything = allWords();
    const phones = new Set(everything.match(/\(?\d{3}\)?[ .-]?\d{3}-\d{4}/g));
    expect([...phones]).toEqual(["(206) 622-0624"]);
    expect(everything).not.toMatch(/\d{3}-\d{3}-\d{4}/);
  });

  it("never mention the bar, Happy Hour, drinks, access codes, staff phone numbers or iCrew (Grant, Oct 29)", () => {
    const everything = allWords();
    expect(everything).not.toMatch(/\bbars?\b|happy hour|\bdrinks?\b|beverage|\bwine\b|\bbeer\b|cocktail|\bsip\b|toast bar|brewery/i);
    expect(everything).not.toMatch(/access code|door code|key ?code|passcode|\bPIN\b/i);
    expect(everything).not.toMatch(/icrew/i);
    expect(everything).not.toMatch(/extension|\bext\.? ?\d/i);
  });

  it("show both membership types with their prices, as the current public site does", () => {
    const cards = SITE.pages.membership.sections.flatMap((s) => s.cards);
    expect(cards.map((c) => c.title)).toEqual(["Intermediate", "Resident"]);
    expect(cards[0].lines).toContain("$103/month");
    expect(cards[0].lines).toContain("$350 one time initiation fee");
    expect(cards[1].lines).toContain("$154.50/month");
    expect(cards[1].lines).toContain("$600 one time initiation fee");
  });

  it("carry the design's homepage words exactly, with the 'since' line as Grant chose it", () => {
    const { hero, features, join } = SITE.homepage;
    expect(hero).toEqual({
      eyebrow: "A Seattle institution since 1910",
      heading: "Your summer evenings, on Lake Union.",
      lead: "Rowing, paddling, a private gym and the best deck in town.",
      tourLabel: "Request a tour",
      joinLabel: "How to join",
    });
    expect(features.eyebrow).toBe("What you get");
    expect(features.items).toEqual([
      { title: "Out on the water", text: "Rowing and paddling for every level, with boats and boards ready to go." },
      { title: "A lounge with a view", text: "The Members Lounge looks right out over Lake Union." },
      { title: "People worth knowing", text: "A full calendar run by members. Come for a class, stay for the friends." },
    ]);
    expect(join.eyebrow).toBe("How to join");
    expect(join.heading).toBe("Three steps to the dock.");
    expect(join.steps).toEqual([
      { lead: "Take a tour.", text: "Thirty minutes, no pressure." },
      { lead: "Apply.", text: "A short form and two member sponsors. We'll help you find them." },
      { lead: "Welcome aboard.", text: "Row, paddle, train, or just come for the company." },
    ]);
    expect(SITE.footer).toEqual({ heading: "Come see it for yourself.", copyright: "© 2026 College Club Seattle. Member-owned." });
  });

  it("flag that How to join steps 1 and 2 are placeholder wording to confirm with the club", () => {
    expect(SITE.homepage.join.previewNote).toMatch(/^Placeholder\. Steps 1 and 2/);
    expect(SITE.homepage.join.previewNote).toContain("Confirm the real process with the club");
  });

  it("repeat the phone and email the same way everywhere they appear, so one change cannot leave an old number behind", () => {
    const all = PAGE_KEYS.flatMap((k) => everyText(SITE.pages[k])).join("\n");
    const phones = new Set(all.match(/\(\d{3}\) \d{3}-\d{4}/g));
    expect([...phones]).toEqual([SITE.club.phone]);
    const emails = new Set(all.match(/[\w.]+@[\w.]+\.\w+/g));
    expect([...emails]).toEqual([SITE.club.email]);
  });

  it("send every button to a page of this site or to the member sign-in, never to another website", () => {
    for (const key of PAGE_KEYS) {
      const cta = SITE.pages[key].cta;
      if (cta) expect([HOME_PATH, ...Object.values(PAGE_PATHS), "/club/sign-in"]).toContain(cta.href);
    }
    expect(allWords()).not.toMatch(/https?:\/\//);
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
    expect(breaks((c) => (c.pages.faq = c.pages.about))).toThrow("pages.faq is not something this file knows about. Allowed here: about, programs, membership, tour, contact.");
    expect(breaks((c) => delete c.homepage)).toThrow("Site content: homepage is missing.");
    expect(breaks((c) => delete c.footer)).toThrow("Site content: footer is missing.");
  });

  it("names a typo in a key instead of ignoring it", () => {
    expect(breaks((c) => (c.pages.about.headng = "x"))).toThrow("pages.about.headng is not something this file knows about");
    expect(breaks((c) => (c.club.phon = "x"))).toThrow("club.phon is not something this file knows about");
    expect(breaks((c) => (c.pages.membership.sections[2].cards[0].line = ["x"]))).toThrow("pages.membership.sections[2].cards[0].line is not something");
    expect(breaks((c) => (c.homepage.hero.eyebrows = "x"))).toThrow("homepage.hero.eyebrows is not something this file knows about");
    expect(breaks((c) => (c.homepage.herro = {}))).toThrow("homepage.herro is not something this file knows about. Allowed here: hero, features, join.");
    expect(breaks((c) => (c.footer.small = "x"))).toThrow("footer.small is not something this file knows about");
  });

  it("refuses empty or missing text, with the place it happened", () => {
    expect(breaks((c) => (c.pages.tour.heading = "  "))).toThrow("pages.tour.heading must not be empty.");
    expect(breaks((c) => delete c.pages.contact.title)).toThrow("pages.contact.title must be text.");
    expect(breaks((c) => (c.pages.about.intro[0] = ""))).toThrow("pages.about.intro[0] must not be empty.");
    expect(breaks((c) => (c.pages.about.sections[0].bullets = "one"))).toThrow("pages.about.sections[0].bullets must be a list of text.");
    expect(breaks((c) => (c.homepage.hero.heading = ""))).toThrow("homepage.hero.heading must not be empty.");
    expect(breaks((c) => delete c.homepage.hero.lead)).toThrow("homepage.hero.lead must be text.");
    expect(breaks((c) => (c.homepage.features.items[1].text = " "))).toThrow("homepage.features.items[1].text must not be empty.");
    expect(breaks((c) => delete c.homepage.join.steps[2].lead)).toThrow("homepage.join.steps[2].lead must be text.");
    expect(breaks((c) => delete c.homepage.join.previewNote)).toThrow("homepage.join.previewNote must be text.");
    expect(breaks((c) => (c.footer.copyright = ""))).toThrow("footer.copyright must not be empty.");
  });

  it("refuses text that is far too long for the page", () => {
    expect(breaks((c) => (c.pages.tour.heading = "x".repeat(121)))).toThrow("pages.tour.heading must be 120 characters or fewer.");
    expect(breaks((c) => (c.pages.about.previewNote = "x".repeat(401)))).toThrow("must be 400 characters or fewer.");
    expect(breaks((c) => (c.homepage.hero.heading = "x".repeat(101)))).toThrow("homepage.hero.heading must be 100 characters or fewer.");
    expect(breaks((c) => (c.homepage.hero.lead = "x".repeat(201)))).toThrow("homepage.hero.lead must be 200 characters or fewer.");
    expect(breaks((c) => (c.homepage.features.items[0].title = "x".repeat(61)))).toThrow("homepage.features.items[0].title must be 60 characters or fewer.");
    expect(breaks((c) => (c.footer.copyright = "x".repeat(121)))).toThrow("footer.copyright must be 120 characters or fewer.");
  });

  it("insists on exactly three things you get and three steps, because the design is laid out for three", () => {
    expect(breaks((c) => c.homepage.features.items.pop())).toThrow("homepage.features.items must have exactly 3 items (it has 2); the design is laid out for three.");
    expect(breaks((c) => c.homepage.features.items.push({ title: "x", text: "y" }))).toThrow("homepage.features.items must have exactly 3 items (it has 4)");
    expect(breaks((c) => c.homepage.join.steps.shift())).toThrow("homepage.join.steps must have exactly 3 items (it has 2)");
    expect(breaks((c) => (c.homepage.join.steps = "one two three"))).toThrow("homepage.join.steps must be a list of exactly 3.");
  });

  it("refuses an empty section or a card with nothing on it", () => {
    expect(breaks((c) => (c.pages.about.sections[0] = { heading: "Empty" }))).toThrow("pages.about.sections[0] is empty: give it paragraphs, bullets or cards.");
    expect(breaks((c) => (c.pages.membership.sections[2].cards[0].lines = []))).toThrow("pages.membership.sections[2].cards[0].lines needs at least one line.");
    expect(breaks((c) => delete c.pages.membership.sections[2].cards[1].title)).toThrow("pages.membership.sections[2].cards[1].title must be text.");
  });

  it("refuses a phone number or email that cannot be right, including the old way of writing the phone", () => {
    expect(breaks((c) => (c.club.phone = "622-0624"))).toThrow('club.phone "622-0624" must look like (206) 555-0100.');
    expect(breaks((c) => (c.club.phone = "206-622-0624"))).toThrow("must look like (206) 555-0100.");
    expect(breaks((c) => (c.club.phone = "(206)622-0624"))).toThrow("must look like (206) 555-0100.");
    expect(breaks((c) => (c.club.email = "membership-at-club"))).toThrow('club.email "membership-at-club" does not look like an email address.');
    expect(breaks((c) => (c.club.people[1].email = "julia@collegeclubseattle.com"))).toThrow("club.people[1].email is not something this file knows about");
  });

  it("refuses a button that goes anywhere but this site or the sign-in", () => {
    const withButton = (c: Record<string, any>, href: string) => (c.pages.about.cta = { label: "Go", href }); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const href of ["https://icrew.club/logon", "http://example.com", "//evil.example", "/club/admin", "/club", "javascript:alert(1)", "/site/../club/admin", ""]) {
      expect(breaks((c) => withButton(c, href)), href).toThrow(/pages\.about\.cta\.href/);
    }
    expect(breaks((c) => withButton(c, "/site/membership"))).not.toThrow();
    expect(breaks((c) => withButton(c, "/site/request-a-tour"))).not.toThrow();
    expect(breaks((c) => withButton(c, "/site"))).not.toThrow();
    expect(breaks((c) => withButton(c, "/club/sign-in"))).not.toThrow();
    expect(breaks((c) => (c.pages.about.cta = { label: "Go", link: "/site" }))).toThrow("pages.about.cta.link is not something");
  });

  it("refuses an address with no lines, and people that are not a list", () => {
    expect(breaks((c) => (c.club.address = []))).toThrow("club.address needs at least one line.");
    expect(breaks((c) => (c.club.people = "Caitlin"))).toThrow("club.people must be a list (it may be empty).");
    expect(breaks((c) => (c.club.people = []))).not.toThrow();
  });

  it("refuses a file that is not an object, or sections that are not a list", () => {
    expect(() => parseSiteContent(null)).toThrow("Site content: the file must be an object.");
    expect(() => parseSiteContent([])).toThrow("the file must be an object.");
    expect(breaks((c) => (c.pages.about.sections = "none"))).toThrow("pages.about.sections must be a list (it may be empty).");
    expect(breaks((c) => (c.pages.contact.sections = []))).not.toThrow();
    expect(breaks((c) => (c.homepage = "hello"))).toThrow("homepage must be an object.");
  });

  it("trims stray spaces from the words", () => {
    const c = copy();
    c.pages.tour.heading = "  Welcome  ";
    c.homepage.hero.heading = "  Hello there  ";
    const parsed = parseSiteContent(c);
    expect(parsed.pages.tour.heading).toBe("Welcome");
    expect(parsed.homepage.hero.heading).toBe("Hello there");
  });
});
