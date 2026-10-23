import raw from "./content/site.json";

/**
 * The words on the public website, kept in `content/site.json` so staff can change them without touching code. The file is
 * read by `parseSiteContent`, which refuses a typo or a missing piece in plain words, so a mistaken edit is caught by the
 * tests (and the build) instead of showing up as a broken page.
 */

export const PAGE_KEYS = ["home", "about", "membership", "programs", "contact"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** Where each page lives, in the order the menu shows them. */
export const PAGE_PATHS: Record<PageKey, string> = {
  home: "/site",
  about: "/site/about",
  membership: "/site/membership",
  programs: "/site/programs",
  contact: "/site/contact",
};

/** The only places a button may point: a page of this site, or the member sign-in. Never another website. */
const ALLOWED_LINKS: readonly string[] = [...Object.values(PAGE_PATHS), "/club/sign-in"];

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

export interface SiteContent {
  copiedFrom: string;
  club: {
    name: string;
    tagline: string;
    address: string[];
    phone: string;
    email: string;
    hours: { club: string; office: string };
    people: { name: string; role: string; email: string }[];
  };
  pages: Record<PageKey, Page>;
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
  if (!/^\d{3}-\d{3}-\d{4}$/.test(p)) fail(path, `"${p}" must look like 206-555-0100.`);
  return p;
}

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

export function parseSiteContent(input: Json): SiteContent {
  if (!isObject(input)) return fail("the file", "must be an object.");
  onlyKeys("the file", input, ["copiedFrom", "club", "pages"]);
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
    if (!isObject(p)) return fail(`club.people[${i}]`, "must have a name, role and email.");
    onlyKeys(`club.people[${i}]`, p, ["name", "role", "email"]);
    return { name: text(`club.people[${i}].name`, p.name, 80), role: text(`club.people[${i}].role`, p.role, 80), email: email(`club.people[${i}].email`, p.email) };
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
    pages,
  };
}

/** The content as the pages use it. A mistake in the file stops the build, in words. */
export const SITE: SiteContent = parseSiteContent(raw);
