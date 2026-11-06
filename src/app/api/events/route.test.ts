import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleEvents } from "@/lib/events";
import { seedRows } from "@/lib/events-seed.testkit";
import { GET } from "./route";

const saved = { ...process.env };
const URL_ = "https://example-project.supabase.co";
const KEY = "service-role-key-for-tests-only";

type Stub = (url: string, init?: RequestInit) => Promise<Response>;
let calls: { url: string; init?: RequestInit }[] = [];

/** Stands in for Supabase, so no test touches the real database. */
function stubSupabase(answer: Stub) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CCS_ALLOW_SAMPLE_DATA;
});

afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function withDatabase() {
  process.env.SUPABASE_URL = URL_;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
}

describe("GET /api/events with the table loaded", () => {
  it("answers 200 with the eight pilot events as live data, in date order, uncached", async () => {
    withDatabase();
    stubSupabase(async () => json(seedRows()));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.source).toBe("live");
    expect(body.events).toHaveLength(8);
    expect(body.events.map((e: { date: string }) => e.date)).toEqual([...body.events.map((e: { date: string }) => e.date)].sort());
    expect(body.events[0]).toEqual({
      name: "BINGO Night",
      date: "2026-09-10",
      priceLabel: "$20 buy-in",
      capacity: 55,
      timesPromoted: 2,
      rsvpMembers: 16,
      rsvpPersons: 43,
      doorEntriesWindow: 36,
      doorComparison: "Baseline Thursdays Sep 3 and Sep 17: 27 and 24 entries in the same 4-9 PM window",
      status: "held",
      note: "Door entries agree with iCrew: busiest Thursday evening of the four checked",
    });
    expect(body.events[2]).toMatchObject({ name: "Boathouse Work Party", capacity: null, doorEntriesWindow: null, doorComparison: null });
    expect(body.events[7]).toMatchObject({ name: "International Comedy Competition (at WAC)", status: "upcoming" });
  });

  it("asks Supabase for the event_scoreboard table, by date, with the server's key only in the request header", async () => {
    withDatabase();
    stubSupabase(async () => json(seedRows()));
    await GET();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`${URL_}/rest/v1/event_scoreboard?`);
    expect(calls[0].url).toContain("order=event_date.asc");
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].init?.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  it("carries counts and event labels only: a column added to the table later never reaches the page", async () => {
    withDatabase();
    const sneaky = seedRows().map((r) => ({ ...r, id: 7, member_email: "someone@example.org", member_name: "A Member", attendees: ["A Member"] }));
    stubSupabase(async () => json(sneaky));
    const text = JSON.stringify(await (await GET()).json());
    // "attendees" appears in a real note's words, so only the column name (a JSON key) is looked for.
    expect(text).not.toMatch(/someone@example\.org|A Member|member_email|member_name|"attendees"/);
    expect(text).not.toMatch(/@/);
    const keys = new Set(Object.keys((await (await GET()).json()).events[0]));
    expect([...keys].sort()).toEqual(
      ["capacity", "date", "doorComparison", "doorEntriesWindow", "name", "note", "priceLabel", "rsvpMembers", "rsvpPersons", "status", "timesPromoted"].sort(),
    );
  });

  it("reads a second page when the table has more than a thousand rows", async () => {
    withDatabase();
    const row = seedRows()[0];
    stubSupabase(async (url) => json(url.includes("offset=0") ? Array.from({ length: 1000 }, () => row) : [row, row]));
    const body = await (await GET()).json();
    expect(body.events).toHaveLength(1002);
    expect(calls).toHaveLength(2);
  });
});

describe("GET /api/events when the table is missing or cannot be read", () => {
  it("answers 502 with a plain message that points at db/event_scoreboard.sql when the table does not exist", async () => {
    withDatabase();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSupabase(async () => json({ code: "PGRST205", message: "Could not find the table 'public.event_scoreboard' in the schema cache" }, 404));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error).toBe("The event figures could not be loaded. If the event_scoreboard table has not been set up yet, see db/event_scoreboard.sql.");
    expect(log).toHaveBeenCalledOnce();
  });

  it("answers 502 when Supabase refuses the key, and when it cannot be reached at all", async () => {
    withDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSupabase(async () => json({ message: "Invalid API key" }, 401));
    expect((await GET()).status).toBe(502);
    stubSupabase(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await GET()).status).toBe(502);
  });

  it("never puts the database address, the key or the underlying error in the answer", async () => {
    withDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSupabase(async () => {
      throw new Error(`connect ECONNREFUSED ${URL_} with ${KEY}`);
    });
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("example-project");
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("GET /api/events when the table is empty", () => {
  it("answers 503 and says what to load, rather than showing an empty scoreboard", async () => {
    withDatabase();
    stubSupabase(async () => json([]));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error).toBe("There are no event figures yet. Load db/event_scoreboard.csv into the event_scoreboard table.");
  });
});

describe("GET /api/events with no database set up", () => {
  it("serves the invented sample while developing, labelled sample, and never calls Supabase", async () => {
    stubSupabase(async () => json([]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(sampleEvents());
    expect(calls).toHaveLength(0);
  });

  it("refuses in production without a database, and does not serve invented figures as real ones", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  });

  it("serves the sample on a production build only when the sample switch is set (a preview)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.CCS_ALLOW_SAMPLE_DATA = "1";
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("sample");
  });

  it("prefers the real table over the sample whenever the database is set, even with the sample switch on", async () => {
    withDatabase();
    process.env.CCS_ALLOW_SAMPLE_DATA = "1";
    stubSupabase(async () => json(seedRows()));
    expect((await (await GET()).json()).source).toBe("live");
  });
});
