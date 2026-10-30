import raw from "./content/site.json";

/**
 * The words on the public website, kept in `content/site.json` so staff can change them without touching code. The file is
 * read by `parseSiteContent`, which refuses a typo or a missing piece in plain words, so a mistaken edit is caught by the
 * tests (and the build) instead of showing up as a broken page.
 *
 * The homepage has its own shape (`homepage`: the hero, three things you get, three steps to join) because it is not a plain
 * page; the other pages (`pages`) share one shape. `footer` is the words every page's footer adds to the club's details.
 */

/** The pages after the homepage, in the order the menu shows them (the homepage is first, see `NAV`). */
export const PAGE_KEYS = ["about", "programs", "membership", "tour", "contact"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** The homepage's address. */
export const HOME_PATH = "/site";

/** Where each page lives. */
export const PAGE_PATHS: Record<PageKey, string> = {
  about: "/site/about",
  programs: "/site/programs",
  membership: "/site/membership",
  tour: "/site/request-a-tour",
  contact: "/site/contact",
};

/** The only places a button may point: a page of this site, or the member sign-in. Never another website. */
const ALLOWED_LINKS: readonly string[] = [HOME_PATH, ...Object.values(PAGE_PATHS), "/club/sign-in"];

export interface Card {
  title: string;
  lines: string[];
}

export interface Section {
  heading?: string;
  paragraphs: string[];
  bullets: string[];
  cards: Card[];
}

export interface Page {
  /** The menu label and the browser tab. */
  title: string;
  /** The big heading on the page. */
  heading: string;
  intro: string[];
  cta?: { label: string; href: string };
  /** A note to staff about this preview ("Draft: ..."), shown in a box marked as not part of the page. Remove it when the page is final. */
  previewNote?: string;
  sections: Section[];
}

export interface Homepage {
  hero: { eyebrow: string; heading: string; lead: string; tourLabel: string; joinLabel: string };
  features: { eyebrow: string; items: { title: string; text: string }[] };
  join: { eyebrow: string; heading: string; steps: { lead: string; text: string }[]; previewNote: string };
}

export interface SiteContent {
  copiedFrom: string;
  club: {
    name: string;
    tagline: string;
    address: string[];
    /** Written as (206) 555-0100. This is the club's only public phone number. */
    phone: string;
    email: string;
    hours: { club: string; office: string };
    /** Names and roles only: the directors' own email addresses are never shown on the public site. */
    people: { name: string; role: string }[];
  };
  homepage: Homepage;
  footer: { heading: string; copyright: string };
  pages: Record<PageKey, Page>;
}

export interface NavItem {
  label: string;
  href: string;
}

type Json = unknown;

const fail = (path: string, problem: string): never => {
  throw new Error(`Site content: ${path} ${problem}`);
};

const isObject = (v: Json): v is Record<string, Json> => typeof v === "object" && v !== null && !Array.isArray(v);

function onlyKeys(path: string, v: Record<string, Json>, allowed: string[]) {
  for (const key of Object.keys(v)) if (!allowed.includes(key)) fail(`${path}.${key}`, `is not something this file knows about. Allowed here: ${allowed.join(", ")}.`);
}

function text(path: string, v: Json, max = 600): string {
  if (typeof v !== "string") return fail(path, "must be text.");
  const t = v.trim();
  if (t === "") return fail(path, "must not be empty.");
  if (t.length > max) return fail(path, `must be ${max} characters or fewer.`);
  return t;
}

function list(path: string, v: Json | undefined, max = 600): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return fail(path, "must be a list of text.");
  return v.map((item, i) => text(`${path}[${i}]`, item, max));
}

function email(path: string, v: Json): string {
  const e = text(path, v, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(path, `"${e}" does not look like an email address.`);
  return e;
}

function phone(path: string, v: Json): string {
  const p = text(path, v, 40);
  if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(p)) fail(path, `"${p}" must look like (206) 555-0100.`);
  return p;
}

/** The link for tapping a phone number: digits only, as in tel:2065550100. */
export const phoneHref = (formatted: string): string => `tel:${formatted.replace(/\D/g, "")}`;

function card(path: string, v: Json): Card {
  if (!isObject(v)) return fail(path, "must be a card with a title and lines.");
  onlyKeys(path, v, ["title", "lines"]);
  const lines = list(`${path}.lines`, v.lines);
  if (lines.length === 0) fail(`${path}.lines`, "needs at least one line.");
  return { title: text(`${path}.title`, v.title, 80), lines };
}

function section(path: string, v: Json): Section {
  if (!isObject(v)) return fail(path, "must be a section.");
  onlyKeys(path, v, ["heading", "paragraphs", "bullets", "cards"]);
  const cards = v.cards === undefined ? [] : Array.isArray(v.cards) ? v.cards.map((c, i) => card(`${path}.cards[${i}]`, c)) : fail(`${path}.cards`, "must be a list of cards.");
  const s: Section = {
    paragraphs: list(`${path}.paragraphs`, v.paragraphs),
    bullets: list(`${path}.bullets`, v.bullets),
    cards,
  };
  if (v.heading !== undefined) s.heading = text(`${path}.heading`, v.heading, 120);
  if (s.paragraphs.length + s.bullets.length + s.cards.length === 0) fail(path, "is empty: give it paragraphs, bullets or cards.");
  return s;
}

function page(path: string, v: Json): Page {
  if (!isObject(v)) return fail(path, "must be a page.");
  onlyKeys(path, v, ["title", "heading", "intro", "cta", "previewNote", "sections"]);
  if (!Array.isArray(v.sections)) fail(`${path}.sections`, "must be a list (it may be empty).");
  const p: Page = {
    title: text(`${path}.title`, v.title, 60),
    heading: text(`${path}.heading`, v.heading, 120),
    intro: list(`${path}.intro`, v.intro),
    sections: (v.sections as Json[]).map((s, i) => section(`${path}.sections[${i}]`, s)),
  };
  if (v.cta !== undefined) {
    if (!isObject(v.cta)) fail(`${path}.cta`, "must have a label and a href.");
    const cta = v.cta as Record<string, Json>;
    onlyKeys(`${path}.cta`, cta, ["label", "href"]);
    const href = text(`${path}.cta.href`, cta.href, 100);
    if (!ALLOWED_LINKS.includes(href)) fail(`${path}.cta.href`, `"${href}" is not allowed. A button can only go to a page of this site or to /club/sign-in.`);
    p.cta = { label: text(`${path}.cta.label`, cta.label, 80), href };
  }
  if (v.previewNote !== undefined) p.previewNote = text(`${path}.previewNote`, v.previewNote, 400);
  return p;
}

/** A block with exactly these text fields and no others. */
function fields<K extends string>(path: string, v: Json, shape: Record<K, number>): Record<K, string> {
  if (!isObject(v)) return fail(path, "must be an object.");
  onlyKeys(path, v, Object.keys(shape));
  return Object.fromEntries((Object.keys(shape) as K[]).map((k) => [k, text(`${path}.${k}`, v[k], shape[k])])) as Record<K, string>;
}

/** A list of exactly three blocks (the design has three things you get and three steps). */
function three<T>(path: string, v: Json, one: (path: string, item: Json) => T): T[] {
  if (!Array.isArray(v)) return fail(path, "must be a list of exactly 3.");
  if (v.length !== 3) return fail(path, `must have exactly 3 items (it has ${v.length}); the design is laid out for three.`);
  return v.map((item, i) => one(`${path}[${i}]`, item));
}

function homepage(v: Json): Homepage {
  if (!isObject(v)) return fail("homepage", "must be an object.");
  onlyKeys("homepage", v, ["hero", "features", "join"]);
  const hero = fields("homepage.hero", v.hero, { eyebrow: 60, heading: 100, lead: 200, tourLabel: 40, joinLabel: 40 });
  const featuresIn = v.features;
  if (!isObject(featuresIn)) return fail("homepage.features", "must be an object.");
  onlyKeys("homepage.features", featuresIn, ["eyebrow", "items"]);
  const joinIn = v.join;
  if (!isObject(joinIn)) return fail("homepage.join", "must be an object.");
  onlyKeys("homepage.join", joinIn, ["eyebrow", "heading", "steps", "previewNote"]);
  return {
    hero,
    features: {
      eyebrow: text("homepage.features.eyebrow", featuresIn.eyebrow, 60),
      items: three("homepage.features.items", featuresIn.items, (path, item) => fields(path, item, { title: 60, text: 200 })),
    },
    join: {
      eyebrow: text("homepage.join.eyebrow", joinIn.eyebrow, 60),
      heading: text("homepage.join.heading", joinIn.heading, 100),
      steps: three("homepage.join.steps", joinIn.steps, (path, item) => fields(path, item, { lead: 60, text: 200 })),
      previewNote: text("homepage.join.previewNote", joinIn.previewNote, 400),
    },
  };
}

export function parseSiteContent(input: Json): SiteContent {
  if (!isObject(input)) return fail("the file", "must be an object.");
  onlyKeys("the file", input, ["copiedFrom", "club", "homepage", "footer", "pages"]);
  const club = input.club;
  if (!isObject(club)) return fail("club", "must be an object.");
  onlyKeys("club", club, ["name", "tagline", "address", "phone", "email", "hours", "people"]);
  const hours = club.hours;
  if (!isObject(hours)) return fail("club.hours", "must have club and office hours.");
  onlyKeys("club.hours", hours, ["club", "office"]);
  const address = list("club.address", club.address, 120);
  if (address.length === 0) fail("club.address", "needs at least one line.");
  if (!Array.isArray(club.people)) return fail("club.people", "must be a list (it may be empty).");
  const people = (club.people as Json[]).map((p, i) => {
    if (!isObject(p)) return fail(`club.people[${i}]`, "must have a name and a role.");
    onlyKeys(`club.people[${i}]`, p, ["name", "role"]);
    return { name: text(`club.people[${i}].name`, p.name, 80), role: text(`club.people[${i}].role`, p.role, 80) };
  });
  const pagesIn = input.pages;
  if (!isObject(pagesIn)) return fail("pages", "must be an object.");
  onlyKeys("pages", pagesIn, [...PAGE_KEYS]);
  const pages = Object.fromEntries(PAGE_KEYS.map((key) => [key, page(`pages.${key}`, pagesIn[key] ?? fail(`pages.${key}`, "is missing."))])) as Record<PageKey, Page>;
  return {
    copiedFrom: text("copiedFrom", input.copiedFrom, 600),
    club: {
      name: text("club.name", club.name, 80),
      tagline: text("club.tagline", club.tagline, 200),
      address,
      phone: phone("club.phone", club.phone),
      email: email("club.email", club.email),
      hours: { club: text("club.hours.club", hours.club, 120), office: text("club.hours.office", hours.office, 120) },
      people,
    },
    homepage: homepage(input.homepage ?? fail("homepage", "is missing.")),
    footer: fields("footer", input.footer ?? fail("footer", "is missing."), { heading: 80, copyright: 120 }),
    pages,
  };
}

/** The content as the pages use it. A mistake in the file stops the build, in words. */
export const SITE: SiteContent = parseSiteContent(raw);

/** The menu, in order: the homepage, then each page by the title it carries. */
export const NAV: NavItem[] = [{ label: "Home", href: HOME_PATH }, ...PAGE_KEYS.map((key) => ({ label: SITE.pages[key].title, href: PAGE_PATHS[key] }))];
