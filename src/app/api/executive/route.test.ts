import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXECUTIVE_COOKIE, makeEditToken } from "@/lib/executive-lock";
import { SEED_PRIORITIES } from "@/lib/executive-items";
import { GET } from "./route";
import { POST as CREATE } from "./items/route";
import { DELETE, PUT } from "./items/[id]/route";
import { POST as ORDER } from "./order/route";

const PASSWORD = "unit-test-executive-1";
const BASE = "http://localhost:3000";

function request(path: string, init: { method?: string; body?: unknown; pass?: boolean; origin?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", host: "localhost:3000" });
  if (init.origin) headers.set("origin", init.origin);
  if (init.pass) headers.set("cookie", `${EXECUTIVE_COOKIE}=${makeEditToken(PASSWORD, new Date())}`);
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv("DASHBOARD_EXECUTIVE_PASSWORD", PASSWORD);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  delete (globalThis as { __ccsPrioritiesMemory?: unknown }).__ccsPrioritiesMemory;
});
afterEach(() => vi.unstubAllEnvs());

describe("the executive page's data", () => {
  it("is readable by anyone, and says whether this browser can edit", async () => {
    const open = await (await GET(request("/api/executive"))).json();
    expect(open).toMatchObject({ source: "sample", canEdit: false, editingSetUp: true });
    expect(open.items.map((p: { title: string }) => p.title)).toEqual(SEED_PRIORITIES.map((p) => p.title));
    expect((await (await GET(request("/api/executive", { pass: true }))).json()).canEdit).toBe(true);
  });

  it("says when no editing password is set up", async () => {
    vi.stubEnv("DASHBOARD_EXECUTIVE_PASSWORD", "");
    expect((await (await GET(request("/api/executive", { pass: true }))).json())).toMatchObject({ canEdit: false, editingSetUp: false });
  });

  it("refuses every change without the editing pass, or from another website", async () => {
    const id = (await (await GET(request("/api/executive"))).json()).items[0].id;
    const body = { title: "T", summary: "S" };
    for (const res of [
      await CREATE(request("/api/executive/items", { method: "POST", body })),
      await PUT(request(`/api/executive/items/${id}`, { method: "PUT", body }), ctx(id)),
      await DELETE(request(`/api/executive/items/${id}`, { method: "DELETE" }), ctx(id)),
      await ORDER(request("/api/executive/order", { method: "POST", body: { ids: [id] } })),
    ]) {
      expect(res.status).toBe(401);
    }
    const cross = await CREATE(request("/api/executive/items", { method: "POST", body, pass: true, origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    expect((await (await GET(request("/api/executive"))).json()).items).toHaveLength(3);
  });

  it("adds, edits, reorders and removes with the pass", async () => {
    const created = await CREATE(request("/api/executive/items", { method: "POST", pass: true, body: { title: "Fourth", summary: "Four", facts: "a\nb" } }));
    expect(created.status).toBe(201);
    const { item } = await created.json();
    expect(item).toMatchObject({ title: "Fourth", facts: ["a", "b"] });

    const edited = await PUT(request(`/api/executive/items/${item.id}`, { method: "PUT", pass: true, body: { title: "Fourth!", summary: "Four" } }), ctx(item.id));
    expect((await edited.json()).item.title).toBe("Fourth!");

    const ids: string[] = (await (await GET(request("/api/executive"))).json()).items.map((p: { id: string }) => p.id);
    const reordered = await ORDER(request("/api/executive/order", { method: "POST", pass: true, body: { ids: [...ids].reverse() } }));
    expect((await reordered.json()).items.map((p: { id: string }) => p.id)).toEqual([...ids].reverse());

    expect((await DELETE(request(`/api/executive/items/${item.id}`, { method: "DELETE", pass: true }), ctx(item.id))).status).toBe(200);
    expect((await DELETE(request(`/api/executive/items/${item.id}`, { method: "DELETE", pass: true }), ctx(item.id))).status).toBe(404);
    expect((await (await GET(request("/api/executive"))).json()).items).toHaveLength(3);
  });

  it("explains a bad edit and a stale order", async () => {
    const bad = await CREATE(request("/api/executive/items", { method: "POST", pass: true, body: { title: "", summary: "S" } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Give the priority a heading.");
    const stale = await ORDER(request("/api/executive/order", { method: "POST", pass: true, body: { ids: ["x"] } }));
    expect(stale.status).toBe(409);
  });

  it("has no storage in production without a database, and says so plainly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "");
    const res = await GET(request("/api/executive"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("SUPABASE_URL");
  });
});
