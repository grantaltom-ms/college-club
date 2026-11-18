import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFake, type FakeState } from "@/lib/email-lists-fake.testkit";
import { EMAIL_LISTS_COOKIE, makeListsToken } from "@/lib/email-lists-lock";
import { GET } from "./route";
import { POST as FIND } from "./find/route";
import { GET as FILTERS, POST as PREVIEW } from "./preview/route";
import { optional } from "@/lib/email-lists-data";
import { POST as SAVE } from "./lists/route";
import { POST as REFRESH } from "./lists/[id]/refresh/route";
import { POST as DRAFT } from "./lists/[id]/draft/route";
import { GET as NIGHTLY } from "./refresh-all/route";

const PASSWORD = "unit-test-lists-0001";
const CRON = "unit-test-cron-secret-0001";
const BASE = "http://localhost:3000";
let fake: FakeState;

function request(path: string, init: { method?: string; body?: unknown; pass?: boolean; origin?: string; auth?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", host: "localhost:3000" });
  if (init.origin) headers.set("origin", init.origin);
  if (init.auth) headers.set("authorization", init.auth);
  if (init.pass !== false) headers.set("cookie", `${EMAIL_LISTS_COOKIE}=${makeListsToken(PASSWORD, new Date())}`);
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ROWING = { joinedWithinMonths: 3, interestsAny: ["rowing"] };

beforeEach(() => {
  vi.stubEnv("DASHBOARD_EMAIL_LISTS_PASSWORD", PASSWORD);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("CCS_ALLOW_SAMPLE_DATA", "1");
  vi.stubEnv("MAILCHIMP_API_KEY", "unittest0fake-us1");
  vi.stubEnv("MAILCHIMP_LIST_ID", "");
  vi.stubEnv("MAILCHIMP_API_BASE", "http://fake.test/3.0");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-unit-test-fake");
  vi.stubEnv("ANTHROPIC_BASE_URL", "http://fake.test");
  vi.stubEnv("CRON_SECRET", CRON);
  const f = createFake();
  fake = f.state;
  vi.stubGlobal("fetch", f.handle);
  delete (globalThis as { __ccsEmailListsMemory?: unknown }).__ccsEmailListsMemory;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the list builder's server", () => {
  it("refuses everything without the list password, and changes from another website", async () => {
    const locked = await GET(request("/api/email-lists", { method: "GET", pass: false }));
    expect(await locked.json()).toEqual({ unlocked: false, passwordSet: true });
    for (const res of [
      await FIND(request("/api/email-lists/find", { body: { description: "rowing" }, pass: false })),
      await PREVIEW(request("/api/email-lists/preview", { body: { rule: ROWING }, pass: false })),
      await SAVE(request("/api/email-lists/lists", { body: { name: "X", rule: ROWING }, pass: false })),
    ]) {
      expect(res.status).toBe(401);
    }
    const cross = await PREVIEW(request("/api/email-lists/preview", { body: { rule: ROWING }, origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  it("reads a description with Claude, which never sees a name or an address", async () => {
    const res = await FIND(request("/api/email-lists/find", { body: { description: "Members that joined within the last three months that indicated interest in rowing" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reading.listName).toBe("New members interested in rowing");
    expect(body.words[0]).toMatch(/^Joined in the last 3 months/);
    expect(body.result.people.map((p: { name: string }) => p.name)).toContain("Sample Avery Lindqvist");
    const sent = JSON.stringify(fake.claudeRequests);
    expect(fake.claudeRequests).toHaveLength(1);
    expect(sent).not.toMatch(/example\.org|Lindqvist|Okafor|Sample /);
  });

  it("says plainly when nothing in the description fits a filter", async () => {
    const res = await FIND(request("/api/email-lists/find", { body: { description: "left-handed people" } }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Not understood: left-handed");
  });

  it("warns about members emailed this week, and can leave them out", async () => {
    const warn = await (await PREVIEW(request("/api/email-lists/preview", { body: { rule: ROWING } }))).json();
    expect(warn.result.recentAmongIncluded).toBe(1);
    const skip = await (await PREVIEW(request("/api/email-lists/preview", { body: { rule: { ...ROWING, leaveOutRecentlyEmailed: true } } }))).json();
    expect(skip.result.leftOutRecent.map((p: { name: string }) => p.name)).toEqual(["Sample Brooke Okafor"]);
    expect(skip.result.emails).not.toContain("brooke.okafor@example.org");
  });

  it("saves a list as a Mailchimp tag, refreshes it, and drafts a campaign without sending", async () => {
    const saved = await SAVE(request("/api/email-lists/lists", { body: { name: "New rowers", request: "rowing", rule: ROWING } }));
    expect(saved.status).toBe(201);
    const { list } = await saved.json();
    const tag = fake.segments.get(list.tagId)!;
    expect(tag.name).toBe("Auto: New rowers");
    expect(tag.members.size).toBe(list.emails);
    expect(tag.members.has("avery.lindqvist@example.org")).toBe(true);

    const dup = await SAVE(request("/api/email-lists/lists", { body: { name: "new rowers", rule: ROWING } }));
    expect(dup.status).toBe(400);

    // Someone is taken off the tag by hand in Mailchimp; a refresh puts the list back to the rule.
    tag.members.delete("avery.lindqvist@example.org");
    tag.members.add("stranger@example.org");
    const refreshed = await (await REFRESH(request(`/api/email-lists/lists/${list.id}/refresh`), ctx(list.id))).json();
    expect(refreshed).toMatchObject({ added: 1, removed: 1 });
    expect(tag.members.has("avery.lindqvist@example.org")).toBe(true);
    expect(tag.members.has("stranger@example.org")).toBe(false);

    const draft = await DRAFT(request(`/api/email-lists/lists/${list.id}/draft`, { body: { request: "trying to put together a member organized erg workout class" } }), ctx(list.id));
    expect(draft.status).toBe(200);
    const d = await draft.json();
    expect(d.draft.editUrl).toBe("https://us1.admin.mailchimp.com/campaigns/edit?id=9001");
    expect(fake.campaigns).toHaveLength(1);
    expect(fake.campaigns[0].body).toMatchObject({ type: "regular", recipients: { segment_opts: { saved_segment_id: list.tagId } } });
    expect(fake.campaigns[0].html).toContain("&lt;every week&gt;");
    expect(fake.calls.some((c) => /actions\/send|actions\/schedule/.test(c))).toBe(false);
  });

  it("keeps working after many lists and drafts (repeated use)", async () => {
    for (let i = 1; i <= 6; i++) {
      const saved = await SAVE(request("/api/email-lists/lists", { body: { name: `List ${i}`, rule: { joinedWithinMonths: i } } }));
      expect(saved.status).toBe(201);
      const { list } = await saved.json();
      const draft = await DRAFT(request(`/api/email-lists/lists/${list.id}/draft`, { body: { request: `email number ${i}` } }), ctx(list.id));
      expect(draft.status).toBe(200);
    }
    const all = await (await GET(request("/api/email-lists", { method: "GET" }))).json();
    expect(all.lists).toHaveLength(6);
    expect(fake.campaigns).toHaveLength(6);
    expect(new Set(fake.campaigns.map((c) => c.web_id)).size).toBe(6);
  });

  it("the nightly refresh needs the secret and answers counts only", async () => {
    expect((await NIGHTLY(request("/api/email-lists/refresh-all", { method: "GET", pass: false }))).status).toBe(401);
    expect((await NIGHTLY(request("/api/email-lists/refresh-all", { method: "GET", pass: false, auth: "Bearer wrong-secret-wrong-secret" }))).status).toBe(401);
    await SAVE(request("/api/email-lists/lists", { body: { name: "Nightly", rule: ROWING } }));
    const ok = await NIGHTLY(request("/api/email-lists/refresh-all", { method: "GET", pass: false, auth: `Bearer ${CRON}` }));
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(JSON.parse(text)).toEqual({ refreshed: 1, failed: 0 });
    expect(text).not.toMatch(/@|Sample/);
  });

  it("gives a plain message when Mailchimp refuses, and never shows the key", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ title: "API Key Invalid" }), { status: 401 }));
    const res = await PREVIEW(request("/api/email-lists/preview", { body: { rule: ROWING } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toContain("unittest0fake");
    expect(JSON.parse(text).error).toMatch(/Mailchimp/);
  });

  it("offers the hand filters without a description, and without anyone's name or address", async () => {
    expect((await FILTERS(request("/api/email-lists/preview", { method: "GET", pass: false }))).status).toBe(401);
    const res = await FILTERS(request("/api/email-lists/preview", { method: "GET" }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(Object.keys(body)).toEqual(["info"]);
    expect(body.info.interests).toContain("rowing");
    expect(text).not.toMatch(/example\.org|Sample /);
    expect(fake.claudeRequests).toHaveLength(0);
  });

  it("reads a table that is not made yet as empty, but never treats a failed read as empty", async () => {
    const cfg = { url: "http://supabase.test", key: "service-key-unit-test" };
    const answer = (status: number) => vi.fn(async () => new Response(status === 200 ? "[]" : JSON.stringify({ message: "nope" }), { status }));
    vi.stubGlobal("fetch", answer(404));
    await expect(optional(cfg, "member_interests", "member_number")).resolves.toEqual([]);
    for (const status of [500, 401, 503]) {
      vi.stubGlobal("fetch", answer(status));
      await expect(optional(cfg, "member_rowing", "member_number")).rejects.toThrow(`Supabase returned ${status} for member_rowing`);
    }
  });

  it("refreshes nothing in Mailchimp when an optional table cannot be read", async () => {
    vi.stubEnv("SUPABASE_URL", "http://supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-unit-test");
    const f = createFake();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("http://supabase.test")) {
        if (url.includes("member_rowing")) return new Response("{}", { status: 500 });
        return new Response("[]", { status: 200 });
      }
      return f.handle(input, init);
    });
    const res = await PREVIEW(request("/api/email-lists/preview", { body: { rule: ROWING } }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("member_rowing");
    expect(f.state.calls.some((c) => /segments/.test(c) && /POST|PATCH|DELETE/.test(c))).toBe(false);
  });
});
