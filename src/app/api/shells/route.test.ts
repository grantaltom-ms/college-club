import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { sampleShells } from "@/lib/shells";
import { GET } from "./route";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

function get(query = "") {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return GET(new NextRequest(`http://localhost/api/shells${query}`));
}

describe("GET /api/shells ownership", () => {
  it("defaults to the club sample and does not add member-owned outings", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownership).toEqual(["club"]);
    expect(body.memberFrom).toBeUndefined();
    expect(body.outings).toEqual(sampleShells().outings);
    expect(JSON.stringify(body)).not.toMatch(/rower_key/);
  });

  it("returns member-owned outings from 2026 only", async () => {
    const res = await get("?ownership=member");
    const body = await res.json();
    expect(body.ownership).toEqual(["member"]);
    expect(body.memberFrom).toBe("2026-01-01");
    expect(body.outings.length).toBeGreaterThan(0);
    expect(body.outings.every((o: { day: string }) => o.day >= "2026-01-01")).toBe(true);
    expect(body.outings.some((o: { day: string }) => o.day.startsWith("2025"))).toBe(false);
  });

  it("keeps an unknown value on club boats", async () => {
    const res = await get("?ownership=all");
    const body = await res.json();
    expect(body.ownership).toEqual(["club"]);
    expect(body.outings).toEqual(sampleShells().outings);
  });

  it("accepts club and member together", async () => {
    const res = await get("?ownership=member&ownership=club");
    const body = await res.json();
    expect(body.ownership).toEqual(["club", "member"]);
    const club2025 = sampleShells().outings.filter((o) => o.day.startsWith("2025")).length;
    expect(body.outings.filter((o: { day: string }) => o.day.startsWith("2025")).length).toBe(club2025);
  });
});
