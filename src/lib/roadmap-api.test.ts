import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStore, readBody, withStore } from "./roadmap-api";
import { RoadmapError } from "./roadmap-store";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("who may reach the roadmap", () => {
  it("is open to anyone with the link: no cookie or password is needed", async () => {
    const res = await withStore(async (store) => Response.json(await store.list()));
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });
});

describe("storage and errors", () => {
  it("uses the in-memory copy in development and refuses in production without a database", async () => {
    expect(getStore()?.source).toBe("sample");
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(getStore()).toBeNull();
    const res = await withStore(async () => new Response("never"));
    expect(res.status).toBe(500);
    process.env.CCS_ALLOW_SAMPLE_DATA = "1";
    expect(getStore()?.source).toBe("sample");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
    expect(getStore()?.source).toBe("live");
  });

  it("turns problems into plain sentences, and never shows a stack trace", async () => {
    const known = await withStore(async () => {
      throw new RoadmapError(404, "That item no longer exists.");
    });
    expect(known.status).toBe(404);
    expect(await known.json()).toEqual({ error: "That item no longer exists." });
    const unknown = await withStore(async () => {
      throw new Error("secret internal detail at /srv/app.js:12");
    });
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toMatch(/secret|\.js/);
  });
});

describe("reading what was sent", () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request("http://x/api", { method: "POST", body, headers });

  it("reads JSON, and says plainly when it cannot", async () => {
    expect(await readBody(post('{"a":1}'))).toEqual({ body: { a: 1 } });
    const bad = await readBody(post("{not json"));
    expect("response" in bad && bad.response.status).toBe(400);
  });

  it("refuses a huge body, whether or not it says how big it is", async () => {
    const big = JSON.stringify({ body: "x".repeat(25_000) });
    const byLength = await readBody(post(big, { "content-length": String(big.length) }));
    expect("response" in byLength && byLength.response.status).toBe(413);
    const bySize = await readBody(post(big));
    expect("response" in bySize && bySize.response.status).toBe(413);
  });
});
