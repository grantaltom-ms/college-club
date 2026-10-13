import { liveConfig, loadLiveData } from "./supabase";
import { sampleData } from "./sample";
import type { DashboardData } from "./types";

export type Loaded = { ok: true; data: DashboardData } | { ok: false; status: number; error: string };

/** Loads the full dashboard data, with member names. Never send this to a visitor who has not signed in. */
export async function loadDashboard(): Promise<Loaded> {
  const cfg = liveConfig();
  if (cfg) {
    try {
      return { ok: true, data: await loadLiveData(cfg) };
    } catch (error) {
      console.error("Could not load dashboard data", error);
      return { ok: false, status: 502, error: "The member database could not be reached. Try again in a minute." };
    }
  }
  // Sample data is for development and tests only. Production must never show it as if it were real.
  if (process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1") {
    return { ok: true, data: sampleData() };
  }
  return {
    ok: false,
    status: 500,
    error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  };
}

/** The same data with every member's name and join date removed, safe for anyone with the link. */
export function withoutNames(data: DashboardData): DashboardData {
  return { ...data, members: data.members.map((m) => ({ ...m, name: "", joined: null })) };
}
