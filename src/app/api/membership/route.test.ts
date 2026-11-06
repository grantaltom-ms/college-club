import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleMembership } from "@/lib/membership";
import { membershipSeedRows, oldShapeRows } from "@/lib/membership-seed.testkit";
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

type Month = Record<string, number | string | null>;

describe("GET /api/membership with the extended table loaded", () => {
  it("answers 200 with the 28 months as live data, oldest first, uncached", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.source).toBe("live");
    expect(body.months).toHaveLength(28);
    const order = body.months.map((m: Month) => (m.year as number) * 12 + (m.month as number));
    expect(order).toEqual([...order].sort((a: number, b: number) => a - b));
    expect([body.months[0].year, body.months[0].month]).toEqual([2024, 7]);
    expect([body.months[27].year, body.months[27].month]).toEqual([2026, 10]);
  });

  it("carries the reason and category fields, with the two totals as separate fields", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const body = await (await GET()).json();
    expect(body.months[0]).toEqual({
      year: 2024,
      month: 7,
      previousTotal: 497,
      resignations: 5,
      applicants: 9,
      transferred: 0,
      withApprovals: 501,
      waitlist: 49,
      resignationsMoved: 3,
      resignationsNotUsing: 2,
      resignationsOther: 0,
      catResident: 417,
      catIntermediate: 56,
      catNonResident: 27,
      catSuburban: 1,
      catHonorary: 10,
      totalAllCategories: 511,
      note: null,
    });
    // The dues-paying count (500s) and the all-categories count (510 to 518) are different numbers in different fields.
    for (const m of body.months as Month[]) {
      if (m.totalAllCategories !== null) expect(m.totalAllCategories as number).toBeGreaterThan(m.withApprovals as number);
    }
  });

  it("sends the Jun 2025 split as null, not as zeroes, and keeps its note", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const body = await (await GET()).json();
    const jun = body.months.find((m: Month) => m.year === 2025 && m.month === 6);
    for (const key of ["resignationsMoved", "resignationsNotUsing", "resignationsOther", "catResident", "catIntermediate", "catNonResident", "catSuburban", "catHonorary", "totalAllCategories"]) {
      expect(jun[key]).toBeNull();
    }
    expect(jun.note).toMatch(/No resignation-reason or category split available/);
    // The dues-paying figures for that month are still there.
    expect([jun.previousTotal, jun.resignations, jun.withApprovals, jun.waitlist]).toEqual([500, 3, 503, 45]);
    // It is the only month with a gap.
    expect(body.months.filter((m: Month) => m.resignationsMoved === null)).toHaveLength(1);
  });

  it("sends the note text unchanged, including the flagged waitlist estimates", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const body = await (await GET()).json();
    const note = (y: number, m: number) => body.months.find((x: Month) => x.year === y && x.month === m).note;
    expect(note(2024, 12)).toContain("Waitlist 45 is a placeholder estimate in the Berg workbook; the club's Dec 2024 sheet shows no waitlist figure.");
    expect(note(2025, 1)).toContain("Waitlist 44 is a placeholder estimate in the Berg workbook; the club's Jan 2025 sheet shows no waitlist figure.");
    expect(note(2026, 3)).toBe("Resignation-reason split in the Berg workbook sums to 7; the monthly sheet records 6 resignations.");
    // Months with no note send null.
    expect(note(2024, 7)).toBeNull();
  });

  it("hands the reason split back as stored, so a month that does not add up is not corrected", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const body = await (await GET()).json();
    const mar = body.months.find((m: Month) => m.year === 2026 && m.month === 3);
    expect([mar.resignationsMoved, mar.resignationsNotUsing, mar.resignationsOther, mar.resignations]).toEqual([0, 4, 3, 6]);
    const oct = body.months.find((m: Month) => m.year === 2024 && m.month === 10);
    expect([oct.resignationsMoved, oct.resignationsNotUsing, oct.resignationsOther, oct.resignations]).toEqual([0, 7, 0, 8]);
  });

  it("has no applications or sign-ups field, and asks Supabase for the membership_monthly table by date", async () => {
    withDatabase();
    stubSupabase(async () => json(membershipSeedRows()));
    const body = await (await GET()).json();
    expect(JSON.stringify(Object.keys(body.months[0]))).not.toMatch(/sign.?up/i);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(`${URL_}/rest/v1/membership_monthly?`);
    expect(calls[0].url).toContain("order=year.asc,month.asc");
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].init?.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  it("carries counts and notes only: a column added to the table later never reaches the page", async () => {
    withDatabase();
    const sneaky = membershipSeedRows().map((r) => ({ ...r, id: 7, member_email: "someone@example.org", member_name: "A Member" }));
    stubSupabase(async () => json(sneaky));
    const body = await (await GET()).json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/someone@example\.org|A Member|member_email|member_name/);
    expect(Object.keys(body.months[0]).sort()).toEqual(
      [
        "year", "month", "previousTotal", "resignations", "applicants", "transferred", "withApprovals", "waitlist",
        "resignationsMoved", "resignationsNotUsing", "resignationsOther",
        "catResident", "catIntermediate", "catNonResident", "catSuburban", "catHonorary", "totalAllCategories", "note",
      ].sort(),
    );
  });
});

describe("GET /api/membership before the extension has been run", () => {
  it("still answers 200 for a table with only the original columns, with every new field null", async () => {
    withDatabase();
    stubSupabase(async () => json(oldShapeRows()));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.months).toHaveLength(28);
    for (const m of body.months as Month[]) {
      for (const key of ["resignationsMoved", "resignationsNotUsing", "resignationsOther", "catResident", "catIntermediate", "catNonResident", "catSuburban", "catHonorary", "totalAllCategories"]) {
        expect(m[key]).toBeNull();
      }
    }
    expect(body.months[0]).toMatchObject({ withApprovals: 501, waitlist: 49 });
  });
});

describe("GET /api/membership when the table is missing, empty or cannot be read", () => {
  it("answers 503 with a plain message when the table is empty", async () => {
    withDatabase();
    stubSupabase(async () => json([]));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("There are no membership counts yet.");
  });

  it("answers 502 with a plain message that points at db/membership_monthly.sql when the table does not exist", async () => {
    withDatabase();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSupabase(async () => json({ code: "PGRST205", message: "Could not find the table 'public.membership_monthly' in the schema cache" }, 404));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error).toBe(
      "The membership figures could not be loaded. If the membership_monthly table has not been set up yet, see db/membership_monthly.sql.",
    );
    expect(log).toHaveBeenCalledOnce();
  });

  it("answers 502 when Supabase refuses the key or cannot be reached, without the address, key or underlying error", async () => {
    withDatabase();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubSupabase(async () => json({ message: "Invalid API key" }, 401));
    expect((await GET()).status).toBe(502);
    stubSupabase(async () => {
      throw new Error(`connect ECONNREFUSED ${URL_} with ${KEY}`);
    });
    const res = await GET();
    expect(res.status).toBe(502);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("example-project");
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("GET /api/membership with no database", () => {
  it("serves the invented sample, labelled sample, while developing or when asked to", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const dev = await GET();
    expect(dev.status).toBe(200);
    expect(await dev.json()).toEqual(sampleMembership());
    vi.stubEnv("NODE_ENV", "production");
    expect((await GET()).status).toBe(500);
    process.env.CCS_ALLOW_SAMPLE_DATA = "1";
    expect((await (await GET()).json()).source).toBe("sample");
    vi.unstubAllEnvs();
  });

  it("answers 500 in production with no database and no sample switch, and never serves sample data as live", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("SUPABASE_URL");
    vi.unstubAllEnvs();
  });
});
