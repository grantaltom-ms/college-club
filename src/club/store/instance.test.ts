import { afterEach, describe, expect, it, vi } from "vitest";
import { getClubStore } from "./instance";

const g = globalThis as unknown as { __ccsClubStore?: Promise<unknown> };

afterEach(() => {
  vi.unstubAllEnvs();
  delete g.__ccsClubStore;
});

describe("which store the app opens", () => {
  it("is the in-memory sample unless a database address is set", async () => {
    vi.stubEnv("CLUB_DATABASE_URL", "");
    const store = await getClubStore();
    expect((await store.read()).households).toHaveLength(14);
    expect(await getClubStore()).toBe(store); // one shared store for the running server
  });

  it("refuses a hosted Supabase address, even though it was asked for", async () => {
    vi.stubEnv("CLUB_DATABASE_URL", "postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres");
    await expect(getClubStore()).rejects.toThrow("looks like a hosted Supabase project");
  });

  it("does not remember a failed opening: once the problem is fixed, the next request works", async () => {
    vi.stubEnv("CLUB_DATABASE_URL", "postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres");
    await expect(getClubStore()).rejects.toThrow();
    await Promise.resolve(); // let the failure be forgotten
    vi.stubEnv("CLUB_DATABASE_URL", "");
    expect((await (await getClubStore()).read()).households).toHaveLength(14);
  });

  it("is switched off where the member area is switched off", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => getClubStore()).toThrow("The member area is switched off.");
  });
});
