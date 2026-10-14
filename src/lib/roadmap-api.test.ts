import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, createSession } from "./auth";
import { getStore, readBody, requireSignIn, withStore } from "./roadmap-api";
import { RoadmapError } from "./roadmap-store";

const PASSWORD = "unit-test-password";
const saved = { ...process.env };

beforeEach(() => {
  process.env.DASHBOARD_PASSWORD = PASSWORD;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

const withCookie = async (password = PASSWORD) =>
  new Request("http://x/api/roadmap", { headers: { cookie: `${SESSION_COOKIE}=${await createSession(password)}` } });
const bare = (headers: Record<string, string> = {}) => new Request("http://x/api/roadmap", { headers });

describe("who may reach the roadmap", () => {
  it("is locked (503) when no password is set, even for someone holding a cookie", async () => {
    const request = await withCookie();
    delete process.env.DASHBOARD_PASSWORD;
    const res = await requireSignIn(request);
    expect(res?.status).toBe(503);
    expect((await res!.json()).error).toMatch(/locked until a password is set/);
  });

  it("turns away strangers, forged, expired and wrong-password cookies (401)", async () => {
    for (const request of [
      bare(),
      bare({ cookie: `${SESSION_COOKIE}=9999999999.deadbeef` }),
      bare({ cookie: `${SESSION_COOKIE}=1.deadbeef` }),
      bare({ cookie: `${SESSION_COOKIE}=garbage` }),
      await withCookie("some-other-password"),
    ]) {
      expect((await requireSignIn(request))?.status).toBe(401);
    }
  });

  it("lets a signed-in visitor through", async () => {
    expect(await requireSignIn(await withCookie())).toBeNull();
  });

  it("checks sign-in before doing anything else, so a stranger's request never reaches storage", async () => {
    let reached = false;
    const res = await withStore(bare(), async () => {
      reached = true;
      return new Response("secret");
    });
    expect(res.status).toBe(401);
    expect(reached).toBe(false);
  });

  it("never lets the answer be cached", async () => {
    const res = await requireSignIn(bare());
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });
});

describe("storage and errors", () => {
  it("uses the in-memory copy in development and refuses in production without a database", async () => {
    expect(getStore()?.source).toBe("sample");
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(getStore()).toBeNull();
    const res = await withStore(await withCookie(), async () => new Response("never"));
    expect(res.status).toBe(500);
    process.env.CCS_ALLOW_SAMPLE_DATA = "1";
    expect(getStore()?.source).toBe("sample");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "key";
    expect(getStore()?.source).toBe("live");
  });

  it("turns problems into plain sentences, and never shows a stack trace", async () => {
    const known = await withStore(await withCookie(), async () => {
      throw new RoadmapError(404, "That item no longer exists.");
    });
    expect(known.status).toBe(404);
    expect(await known.json()).toEqual({ error: "That item no longer exists." });
    const unknown = await withStore(await withCookie(), async () => {
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
