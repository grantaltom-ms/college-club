import { describe, expect, it } from "vitest";
import { buildGroups } from "./roadmap";
import { SEED, seedCounts, seedSql, type SeedItem } from "./roadmap-seed";
import type { RoadmapItem } from "./roadmap";
import { MemoryStore, RoadmapError, SupabaseStore, seedData } from "./roadmap-store";
import { readFileSync } from "node:fs";

const base = { title: "T", group: null, status: "Not started" as const, dueDate: null, owner: null, parentId: null };
const MISSING = "00000000-0000-4000-8000-00000000dead";

async function expectError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (e) => e,
  );
  expect(error).toBeInstanceOf(RoadmapError);
  expect((error as RoadmapError).status).toBe(status);
  expect((error as RoadmapError).message).toMatch(/^[A-Z].*[.]$/);
}

describe("the starting content", () => {
  it("is what the meeting produced, within the length limits", () => {
    expect(SEED.map((g) => g.group)).toEqual([
      "Member engagement",
      "Usage data and dashboard",
      "Offseason usage and revenue",
      "Systems (iCrew and website)",
    ]);
    expect(seedCounts()).toEqual({ items: 15, subitems: 10, notes: 13 });
    const texts: SeedItem[] = SEED.flatMap((g) => g.items.flatMap((i) => [i, ...(i.subitems ?? [])]));
    for (const t of texts) {
      expect(t.title.length).toBeLessThanOrEqual(200);
      for (const n of t.notes ?? []) expect(n.length).toBeLessThanOrEqual(4000);
      if (t.due) expect(t.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const byTitle = (needle: string) => texts.find((t) => t.title.includes(needle))!;
    expect(byTitle("Pick 2-3 engagement tracks").due).toBe("2026-10-30");
    expect(byTitle("Pick 2-3 engagement tracks").status).toBeUndefined(); // starts as Not started
    expect(byTitle("Pick 2-3 engagement tracks").subitems).toHaveLength(3);
    expect(byTitle("room rental program")).toMatchObject({ due: "2026-10-20", status: "In progress" });
    expect(byTitle("Usage dashboard: built and live").status).toBe("Done");
    expect(byTitle("Connect Mailchimp").status).toBe("Waiting");
    expect(byTitle("Shell usage by month").status).toBe("Waiting");
    expect(byTitle("Decide whether to replace iCrew").subitems).toHaveLength(4);
  });

  it("loads into memory as groups with subitems and notes", () => {
    const { items, notes } = seedData();
    const counts = seedCounts();
    expect(items).toHaveLength(counts.items + counts.subitems);
    expect(notes).toHaveLength(counts.notes);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(buildGroups(items).map((g) => g.name)).toEqual(SEED.map((g) => g.group));
    expect(items.filter((i) => i.parentId).every((i) => i.group === null)).toBe(true);
  });

  it("has a SQL file that matches the list, creates nothing twice, and keeps every text safe", () => {
    const sql = seedSql();
    expect(readFileSync(new URL("../../db/roadmap_seed.sql", import.meta.url), "utf8")).toBe(sql);
    expect(sql).toContain("if exists (select 1 from public.roadmap_items) then");
    expect((sql.match(/insert into public\.roadmap_items/g) ?? []).length).toBe(25);
    expect((sql.match(/insert into public\.roadmap_notes/g) ?? []).length).toBe(13);
    expect(sql).toContain("from Grant's address"); // apostrophes need no escaping inside dollar quotes
  });
});

describe("the in-memory store", () => {
  it("adds items with the next order number, and subitems under a top-level item only", async () => {
    const store = new MemoryStore({ items: [], notes: [] });
    const a = await store.createItem({ ...base, title: "A", group: "G" });
    const b = await store.createItem({ ...base, title: "B", group: "G" });
    expect(b.sortOrder).toBe(a.sortOrder + 1);
    const sub = await store.createItem({ ...base, title: "S", group: "ignored", parentId: a.id });
    expect(sub).toMatchObject({ parentId: a.id, group: null, sortOrder: 1 });
    await expectError(store.createItem({ ...base, parentId: sub.id }), 400); // two levels only
    await expectError(store.createItem({ ...base, parentId: MISSING }), 404);
  });

  it("updates only what was sent, can clear a date, and keeps subitems out of groups", async () => {
    const store = new MemoryStore({ items: [], notes: [] });
    const a = await store.createItem({ ...base, title: "A", group: "G", dueDate: "2026-11-01", owner: "Grant" });
    const sub = await store.createItem({ ...base, title: "S", parentId: a.id });
    expect(await store.updateItem(a.id, { status: "Done" })).toMatchObject({ status: "Done", title: "A", dueDate: "2026-11-01" });
    expect(await store.updateItem(a.id, { dueDate: null, owner: null })).toMatchObject({ dueDate: null, owner: null });
    expect(await store.updateItem(a.id, { title: "A2", group: "H" })).toMatchObject({ title: "A2", group: "H" });
    expect((await store.updateItem(sub.id, { group: "H" })).group).toBeNull();
    await expectError(store.updateItem(MISSING, { status: "Done" }), 404);
    await expectError(store.updateItem("not-an-id", { status: "Done" }), 404);
  });

  it("keeps notes newest first, in the order they were added even in the same millisecond", async () => {
    const store = new MemoryStore({ items: [], notes: [] });
    const a = await store.createItem(base);
    for (let i = 1; i <= 12; i++) await store.addNote(a.id, `note ${i}`);
    expect((await store.list()).notes.map((n) => n.body)).toEqual(Array.from({ length: 12 }, (_, i) => `note ${12 - i}`));
    await expectError(store.addNote(MISSING, "x"), 404);
  });

  it("deletes a note by itself, and an item together with its subitems and notes", async () => {
    const store = new MemoryStore({ items: [], notes: [] });
    const keep = await store.createItem({ ...base, title: "keep" });
    const a = await store.createItem({ ...base, title: "A" });
    const sub = await store.createItem({ ...base, title: "S", parentId: a.id });
    const n1 = await store.addNote(a.id, "on parent");
    await store.addNote(sub.id, "on sub");
    await store.addNote(keep.id, "on keep");
    await store.deleteNote(n1.id);
    await expectError(store.deleteNote(n1.id), 404);
    await store.deleteItem(a.id);
    const data = await store.list();
    expect(data.items.map((i) => i.title)).toEqual(["keep"]);
    expect(data.notes.map((n) => n.body)).toEqual(["on keep"]);
    await expectError(store.deleteItem(a.id), 404);
  });

  it("holds up to repeated use: 200 adds and deletes, 100 notes, many status flips", async () => {
    const store = new MemoryStore();
    const start = (await store.list()).items.length;
    const made: RoadmapItem[] = [];
    for (let i = 0; i < 200; i++) made.push(await store.createItem({ ...base, title: `Item ${i}`, group: "Churn" }));
    expect((await store.list()).items).toHaveLength(start + 200);
    for (let i = 0; i < 100; i++) await store.addNote(made[0].id, `note ${i}`);
    for (let i = 0; i < 50; i++) await store.updateItem(made[1].id, { status: i % 2 ? "Done" : "Waiting" });
    expect((await store.list()).items.find((i) => i.id === made[1].id)?.status).toBe("Done");
    for (const m of made) await store.deleteItem(m.id);
    const after = await store.list();
    expect(after.items).toHaveLength(start);
    expect(after.notes.some((n) => n.itemId === made[0].id)).toBe(false);
  });

  it("hands out copies, so callers cannot change the stored list by accident", async () => {
    const store = new MemoryStore();
    const data = await store.list();
    data.items[0].title = "changed";
    expect((await store.list()).items[0].title).not.toBe("changed");
  });
});

describe("the Supabase store", () => {
  const cfg = { url: "https://example.supabase.co", key: "service-key" };

  /** A fake network: records each request and answers from a list of canned responses. */
  function fakeFetch(...answers: { status?: number; body?: unknown }[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const answer = answers.shift() ?? { body: [] };
      return new Response(JSON.stringify(answer.body ?? []), { status: answer.status ?? 200 });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }
  const row = (over: Record<string, unknown> = {}) => ({
    id: "123e4567-e89b-42d3-a456-426614174000",
    parent_id: null,
    title: "T",
    group_name: null,
    status: "Not started",
    due_date: null,
    owner: null,
    sort_order: 1,
    created_at: "2026-10-14T10:00:00Z",
    ...over,
  });

  it("sends the secret key as headers and maps rows to items", async () => {
    const { fn, calls } = fakeFetch({ body: [row({ status: "Mystery", due_date: "2026-11-06" })] }, { body: [] });
    const data = await new SupabaseStore(cfg, fn).list();
    // Items are asked for first, notes second (both start together).
    expect(data.source).toBe("live");
    expect(data.items[0]).toMatchObject({ status: "Not started", dueDate: "2026-11-06", parentId: null });
    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/roadmap_items?select=*&order=sort_order.asc,created_at.asc&limit=1000&offset=0");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.apikey).toBe("service-key");
    expect(headers.Authorization).toBe("Bearer service-key");
    expect(calls[1].url).toContain("roadmap_notes?select=*&order=created_at.desc");
  });

  it("reads every page when there are more than 1,000 rows", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
    const urls: string[] = [];
    // Items and notes load at the same time, so answer by address rather than by order.
    const fn = (async (url: string) => {
      urls.push(url);
      const body = url.includes("roadmap_items") ? (url.includes("offset=0") ? full : [row()]) : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const data = await new SupabaseStore(cfg, fn).list();
    expect(data.items).toHaveLength(1001);
    expect(urls.filter((u) => u.includes("roadmap_items")).map((u) => u.match(/offset=(\d+)/)?.[1])).toEqual(["0", "1000"]);
  });

  it("adds an item after the last one, and checks the parent for a subitem", async () => {
    const parent = row({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const { fn, calls } = fakeFetch({ body: [parent] }, { body: [{ sort_order: 4 }] }, { status: 201, body: [row({ parent_id: parent.id, sort_order: 5 })] });
    const made = await new SupabaseStore(cfg, fn).createItem({ ...base, title: "Sub", group: "ignored", parentId: parent.id });
    expect(made).toMatchObject({ parentId: parent.id, sortOrder: 5 });
    expect(calls[1].url).toContain(`parent_id=eq.${parent.id}`);
    expect(JSON.parse(calls[2].init.body as string)).toMatchObject({ parent_id: parent.id, group_name: null, sort_order: 5, title: "Sub" });
    expect((calls[2].init.headers as Record<string, string>).Prefer).toBe("return=representation");
  });

  it("refuses a subitem under a subitem or a missing item", async () => {
    const sub = row({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", parent_id: MISSING });
    await expectError(new SupabaseStore(cfg, fakeFetch({ body: [sub] }).fn).createItem({ ...base, parentId: sub.id }), 400);
    await expectError(new SupabaseStore(cfg, fakeFetch({ body: [] }).fn).createItem({ ...base, parentId: sub.id }), 404);
  });

  it("changes only what was sent, stamps the time, and leaves a subitem's group alone", async () => {
    const top = row();
    const { fn, calls } = fakeFetch({ body: [top] }, { body: [row({ status: "Done" })] });
    await new SupabaseStore(cfg, fn).updateItem(top.id, { status: "Done", dueDate: null });
    const body = JSON.parse(calls[1].init.body as string);
    expect(Object.keys(body).sort()).toEqual(["due_date", "status", "updated_at"]);
    expect(body.due_date).toBeNull();
    expect(calls[1].init.method).toBe("PATCH");

    const sub = row({ parent_id: top.id });
    const second = fakeFetch({ body: [sub] }, { body: [sub] });
    await new SupabaseStore(cfg, second.fn).updateItem(sub.id, { group: "Nope", owner: "Grant" });
    expect(JSON.parse(second.calls[1].init.body as string)).not.toHaveProperty("group_name");
  });

  it("never puts an unchecked id into a web address", async () => {
    const { fn, calls } = fakeFetch();
    const store = new SupabaseStore(cfg, fn);
    const evil = "x&select=*;drop";
    await expectError(store.updateItem(evil, { status: "Done" }), 404);
    await expectError(store.deleteItem(evil), 404);
    await expectError(store.addNote(evil, "hi"), 404);
    await expectError(store.deleteNote(evil), 404);
    await expectError(store.createItem({ ...base, parentId: evil }), 404);
    expect(calls).toHaveLength(0);
  });

  it("reports a missing item or note as gone, and a database problem as a plain sentence", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    await expectError(new SupabaseStore(cfg, fakeFetch({ body: [] }).fn).deleteItem(id), 404);
    await expectError(new SupabaseStore(cfg, fakeFetch({ body: [] }).fn).deleteNote(id), 404);
    await expectError(new SupabaseStore(cfg, fakeFetch({ status: 409, body: {} }).fn).addNote(id, "hi"), 404); // item deleted meanwhile
    await expectError(new SupabaseStore(cfg, fakeFetch({ status: 500, body: {} }).fn).list(), 502);
    const down = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expectError(new SupabaseStore(cfg, down).list(), 502);
  });

  it("deletes with one request, and subitems and notes go with it in the database", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const { fn, calls } = fakeFetch({ body: [{ id }] });
    await new SupabaseStore(cfg, fn).deleteItem(id);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe(`https://example.supabase.co/rest/v1/roadmap_items?select=id&id=eq.${id}`);
  });
});
