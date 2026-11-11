import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, LIVE_FIGURES, pageHeading, parseOrder, parsePriority, SEED_PRIORITIES, splitFigures, type LiveSources } from "./executive-items";
import { canEditExecutive, EXECUTIVE_COOKIE, executivePassword, makeEditToken } from "./executive-lock";
import { MemoryPriorityStore, PriorityError, SupabasePriorityStore, seedPriorities, toPriority } from "./executive-store";

const SQL = readFileSync(path.resolve(__dirname, "..", "..", "db", "executive_priorities.sql"), "utf8");

const good = { title: "A heading", summary: "One line", facts: "First point\n\n  Second point  \n", meaning: "M", question: "Q", careful: "C" };

describe("checking an edited priority", () => {
  it("accepts a good one, trims it and splits the points by line, dropping blank lines", () => {
    const r = parsePriority(good);
    expect(r).toEqual({ ok: true, value: { title: "A heading", summary: "One line", facts: ["First point", "Second point"], meaning: "M", question: "Q", careful: "C" } });
    expect(parsePriority({ ...good, facts: ["a", " ", "b"] })).toMatchObject({ ok: true, value: { facts: ["a", "b"] } });
  });

  it("only needs a heading and a summary", () => {
    expect(parsePriority({ title: "T", summary: "S" })).toEqual({ ok: true, value: { title: "T", summary: "S", facts: [], meaning: "", question: "", careful: "" } });
  });

  it("says what is wrong in plain words", () => {
    expect(parsePriority(null)).toMatchObject({ ok: false });
    expect(parsePriority({ ...good, title: "  " })).toEqual({ ok: false, error: "Give the priority a heading." });
    expect(parsePriority({ ...good, summary: "" })).toMatchObject({ ok: false, error: expect.stringContaining("one-line summary") });
    expect(parsePriority({ ...good, title: "x".repeat(LIMITS.title + 1) })).toMatchObject({ ok: false, error: expect.stringContaining("heading") });
    expect(parsePriority({ ...good, facts: Array(LIMITS.facts + 1).fill("p") })).toMatchObject({ ok: false, error: expect.stringContaining("points or fewer") });
    expect(parsePriority({ ...good, facts: ["x".repeat(LIMITS.fact + 1)] })).toMatchObject({ ok: false, error: expect.stringContaining("each point") });
    expect(parsePriority({ ...good, meaning: "x".repeat(LIMITS.meaning + 1) })).toMatchObject({ ok: false });
    expect(parsePriority({ ...good, question: "x".repeat(LIMITS.question + 1) })).toMatchObject({ ok: false });
    expect(parsePriority({ ...good, careful: "x".repeat(LIMITS.careful + 1) })).toMatchObject({ ok: false });
  });
});

describe("a new order", () => {
  const ids = ["a", "b", "c"];
  it("must name every item exactly once", () => {
    expect(parseOrder({ ids: ["c", "a", "b"] }, ids)).toEqual({ ok: true, value: ["c", "a", "b"] });
    for (const bad of [{ ids: ["a", "b"] }, { ids: ["a", "a", "b"] }, { ids: ["a", "b", "d"] }, { ids: "abc" }, null]) {
      expect(parseOrder(bad, ids).ok).toBe(false);
    }
  });
});

describe("live figures in the text", () => {
  const sources: LiveSources = {
    waitlist: {
      now: { label: "Oct 2026", waitlist: 16 },
      yearAgo: { label: "Oct 2025", waitlist: 34 },
      twoYearsAgo: null,
      resignations12: 71,
      monthsCounted: 12,
      perMonth: 5.9,
      monthsOfCover: 2.7,
      lastWinter: { label: "Nov 2025 – Feb 2026", resignations: 29 },
      members: 1506,
      membersLabel: "Oct 2026",
    },
    usage: { total: 497, rarely: 148, rarelyShare: 30, regulars: 184, regularEntryShare: 80 },
    rowing: { year: 2026, now: 1811, before: 2404, change: -25, through: "2026-11-04" },
    visitsThrough: "2026-11-10",
  };

  it("are filled in, with thousands separators, words for a change and a dated day", () => {
    const parts = splitFigures("Waitlist {{waitlist_now}} of {{ members_now }}; rowing {{rowing_change}} to {{rowing_through}}.", sources);
    expect(parts).toEqual([
      { text: "Waitlist " },
      { figure: "waitlist_now", value: "16", known: true },
      { text: " of " },
      { figure: "members_now", value: "1,506", known: true },
      { text: "; rowing " },
      { figure: "rowing_change", value: "down 25%", known: true },
      { text: " to " },
      { figure: "rowing_through", value: "Nov 4, 2026", known: true },
      { text: "." },
    ]);
  });

  it("mark a figure that does not exist, one that is missing, and one still loading", () => {
    expect(splitFigures("{{nope}}", sources)).toEqual([{ figure: "nope", value: null, known: false }]);
    expect(splitFigures("{{waitlist_two_years_ago}}", sources)).toEqual([{ figure: "waitlist_two_years_ago", value: null, known: true }]);
    const loading = splitFigures("{{waitlist_now}} {{visits_through}}", { waitlist: undefined, usage: undefined, rowing: undefined, visitsThrough: undefined });
    expect(loading.filter((p) => "figure" in p).map((p) => ("value" in p ? p.value : "x"))).toEqual([undefined, undefined]);
    const failed = splitFigures("{{waitlist_now}}", { waitlist: null, usage: null, rowing: null, visitsThrough: null });
    expect(failed).toEqual([{ figure: "waitlist_now", value: null, known: true }]);
  });

  it("leave text without codes alone", () => {
    expect(splitFigures("Plain {text} and {{ }}", sources)).toEqual([{ text: "Plain {text} and {{ }}" }]);
  });

  it("have unique codes, and every one has a value from full sources", () => {
    const codes = LIVE_FIGURES.map((f) => f.code);
    expect(new Set(codes).size).toBe(codes.length);
    const full = { ...sources, waitlist: { ...sources.waitlist!, twoYearsAgo: { label: "Oct 2024", waitlist: 50 } } };
    for (const f of LIVE_FIGURES) expect(f.value(full), f.code).toEqual(expect.any(String));
  });
});

describe("the starting three", () => {
  it("only use live figure codes that exist, and pass the editing checks", () => {
    const codes = new Set(LIVE_FIGURES.map((f) => f.code));
    for (const p of SEED_PRIORITIES) {
      for (const text of [p.title, p.summary, ...p.facts, p.meaning, p.question, p.careful]) {
        for (const m of text.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)) expect(codes.has(m[1]), m[1]).toBe(true);
      }
      expect(parsePriority(p)).toEqual({ ok: true, value: p });
    }
  });

  it("are the rows the database file loads, word for word, in order", () => {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    let at = 0;
    for (const p of SEED_PRIORITIES) {
      for (const text of [p.title, p.summary, ...p.facts, p.meaning, p.question, p.careful]) {
        const found = SQL.indexOf(q(text), at);
        expect(found, text.slice(0, 40)).toBeGreaterThan(-1);
        at = found;
      }
    }
  });

  it("are loaded only into an empty table, with row level security on and no policy", () => {
    expect(SQL).toMatch(/create table if not exists public\.executive_priorities/);
    expect(SQL).toMatch(/alter table public\.executive_priorities enable row level security;/);
    expect(SQL).not.toMatch(/create policy/i);
    expect(SQL).toMatch(/where not exists \(select 1 from public\.executive_priorities\);\s*$/);
  });
});

describe("the page heading", () => {
  it("counts the priorities in words", () => {
    expect(pageHeading(3)).toBe("Three things to watch.");
    expect(pageHeading(1)).toBe("One thing to watch.");
    expect(pageHeading(0)).toBe("No things to watch.");
    expect(pageHeading(12)).toBe("12 things to watch.");
  });
});

describe("the editing password", () => {
  const env = { DASHBOARD_EXECUTIVE_PASSWORD: "  exec-secret-1  " };
  const now = new Date("2026-11-11T20:00:00Z");

  it("needs at least 8 characters, or nobody can edit", () => {
    expect(executivePassword(env)).toBe("exec-secret-1");
    expect(executivePassword({ DASHBOARD_EXECUTIVE_PASSWORD: "short" })).toBeNull();
    expect(executivePassword({})).toBeNull();
    expect(canEditExecutive(makeEditToken("short", now), now, { DASHBOARD_EXECUTIVE_PASSWORD: "short" })).toBe(false);
  });

  it("gives a 30-day pass that a new password, a forged date or the Financials password cannot use", () => {
    const token = makeEditToken("exec-secret-1", now);
    expect(canEditExecutive(token, now, env)).toBe(true);
    expect(canEditExecutive(token, new Date(now.getTime() + 29 * 86_400_000), env)).toBe(true);
    expect(canEditExecutive(token, new Date(now.getTime() + 31 * 86_400_000), env)).toBe(false);
    expect(canEditExecutive(token, now, { DASHBOARD_EXECUTIVE_PASSWORD: "another-secret" })).toBe(false);
    const [, sig] = token.split(".");
    expect(canEditExecutive(`${now.getTime() + 40 * 86_400_000}.${sig}`, now, env)).toBe(false);
    expect(canEditExecutive(undefined, now, env)).toBe(false);
    expect(canEditExecutive("garbage", now, env)).toBe(false);
    expect(EXECUTIVE_COOKIE).not.toBe("ccs_financials");
  });
});

describe("the in-memory store", () => {
  it("starts with the three, and adds, edits, moves and removes", async () => {
    const store = new MemoryPriorityStore();
    const start = await store.list();
    expect(start.map((p) => p.title)).toEqual(SEED_PRIORITIES.map((p) => p.title));

    const added = await store.create({ ...SEED_PRIORITIES[0], title: "Fourth" });
    expect((await store.list()).map((p) => p.title).at(-1)).toBe("Fourth");

    await store.update(added.id, { ...SEED_PRIORITIES[0], title: "Fourth, edited", facts: ["one"] });
    expect((await store.list()).find((p) => p.id === added.id)).toMatchObject({ title: "Fourth, edited", facts: ["one"] });

    const order = [added.id, ...start.map((p) => p.id)];
    expect((await store.reorder(order)).map((p) => p.id)).toEqual(order);

    await store.remove(start[1].id);
    expect((await store.list()).map((p) => p.id)).toEqual([added.id, start[0].id, start[2].id]);
  });

  it("refuses an item that is gone and an eleventh item, and hands out copies", async () => {
    const store = new MemoryPriorityStore();
    await expect(store.remove("not-a-uuid")).rejects.toBeInstanceOf(PriorityError);
    await expect(store.update(crypto.randomUUID(), SEED_PRIORITIES[0])).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 7; i++) await store.create(SEED_PRIORITIES[0]);
    await expect(store.create(SEED_PRIORITIES[0])).rejects.toMatchObject({ status: 400, message: expect.stringContaining("up to 10") });
    const [first] = await store.list();
    first.facts.push("changed outside");
    expect((await store.list())[0].facts).not.toContain("changed outside");
  });

  it("seeds fresh ids each time", () => {
    expect(seedPriorities()[0].id).not.toBe(seedPriorities()[0].id);
  });
});

describe("the database store", () => {
  const row = { id: "00000000-0000-4000-8000-000000000001", sort_order: 2, title: "T", summary: "S", facts: ["a"], meaning: "M", question: "Q", careful: "C", updated_at: "2026-11-11T00:00:00Z", secret_column: "x" };

  it("passes on only the named fields", () => {
    expect(toPriority(row)).toEqual({ id: row.id, sortOrder: 2, title: "T", summary: "S", facts: ["a"], meaning: "M", question: "Q", careful: "C", updatedAt: row.updated_at });
    expect(toPriority({ ...row, facts: null })).toMatchObject({ facts: [] });
  });

  it("reads in order, and turns a missing table into a plain message without the address or key", async () => {
    const calls: string[] = [];
    const ok = new SupabasePriorityStore({ url: "https://db.example", key: "secret-key" }, (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify([row]), { status: 200 });
    }) as typeof fetch);
    expect(await ok.list()).toHaveLength(1);
    expect(calls[0]).toContain("executive_priorities?select=*&order=sort_order.asc");

    const missing = new SupabasePriorityStore({ url: "https://db.example", key: "secret-key" }, (async () => new Response("{}", { status: 404 })) as typeof fetch);
    const err = await missing.list().catch((e) => e);
    expect(err).toBeInstanceOf(PriorityError);
    expect(err.message).toContain("db/executive_priorities.sql");
    expect(err.message).not.toMatch(/db\.example|secret-key/);
  });

  it("refuses an eleventh item before writing", async () => {
    let posts = 0;
    const store = new SupabasePriorityStore({ url: "https://db.example", key: "k" }, (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts++;
      return new Response(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ sort_order: 10 - i }))), { status: 200 });
    }) as typeof fetch);
    await expect(store.create(SEED_PRIORITIES[0])).rejects.toMatchObject({ status: 400 });
    expect(posts).toBe(0);
  });
});
