import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const saved = { ...process.env };
const URL_ = "https://example-project.supabase.co";
const KEY = "service-role-key-for-tests-only";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const months = (n: number[]) =>
  Object.fromEntries(n.map((v, i) => [`visit_days_2026_${String(i + 1).padStart(2, "0")}`, v]));

const memberRow = (name: string, visits: number[], band: string) => ({
  member_name: name,
  usage_band: band,
  visits_per_month: visits.reduce((a, b) => a + b, 0) / 10.3,
  visit_days: visits.reduce((a, b) => a + b, 0),
  door_entries: 0,
  icrew_booking_days_jul_sep: 0,
  last_visit: null,
  own_brivo_fob: false,
  joined: "2019-10-18",
  icrew_member_type: "Resident",
  data_through: "2026-11-10",
  ...months(visits),
});

const qbRow = (name: string) => ({
  qb_name: name,
  qb_member_type: "Resident",
  qb_member_number: "1",
  qb_created_on: "2019-10-18",
  link: "matched",
  usage_member_name: name,
  door_entries_if_door_only: null,
  roster_as_of: "2026-11-17",
});

/** Invented Supabase tables, keyed by the table in the address. */
function stub(tables: Record<string, unknown[] | number>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const table = Object.keys(tables).find((t) => url.includes(`/rest/v1/${t}?`));
    const answer = table ? tables[table] : 404;
    return typeof answer === "number" ? json({ message: "relation does not exist" }, answer) : json(answer);
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = URL_;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  delete process.env.CCS_ALLOW_SAMPLE_DATA;
});

afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/membership/leavers", () => {
  const tables = () => ({
    resignations: [{ member_name: "Invented Leaver", resigned_on: "2026-11-17", reason: "not_using", note: "Private note text" }],
    members: [memberRow("Invented Leaver", Array(11).fill(0), "0 visits"), memberRow("Invented Stayer", Array(11).fill(6), "4+/month")],
    qb_members: [qbRow("Invented Stayer")],
  });

  it("answers 200 with counts only: no names, no notes, no key", async () => {
    stub(tables());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.source).toBe("live");
    expect(body.resignations).toBe(1);
    expect(body.groups.find((g: { key: string }) => g.key === "notUsing").people).toBe(1);
    for (const secret of ["Invented Leaver", "Invented Stayer", "Private note text", KEY, URL_]) expect(text).not.toContain(secret);
  });

  it("answers 503 with a plain message when no resignations are loaded", async () => {
    stub({ ...tables(), resignations: [] });
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("db/resignations.sql");
  });

  it("answers 502 without leaking anything when the table is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ ...tables(), resignations: 404 });
    const res = await GET();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).toContain("db/resignations.sql");
    expect(text).not.toContain(URL_);
    expect(text).not.toContain(KEY);
  });

  it("gives the invented sample while developing, and refuses in production with no database", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const dev = await GET();
    expect((await dev.json()).source).toBe("sample");
    vi.stubEnv("NODE_ENV", "production");
    const prod = await GET();
    expect(prod.status).toBe(500);
    vi.unstubAllEnvs();
  });
});
