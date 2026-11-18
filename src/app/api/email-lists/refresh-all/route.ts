import type { NextRequest } from "next/server";
import { timingSafeEqual, createHash } from "node:crypto";
import { getListStore, json, loadPool, refreshList } from "@/lib/email-lists-api";

/**
 * The nightly refresh (vercel.json runs it once a day). Vercel sends "Authorization: Bearer <CRON_SECRET>"; anything else is
 * refused, so nobody else can make the club's server call Mailchimp. Answers counts only.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization") ?? "";
  const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
  if (!secret || secret.length < 16 || !same(given, `Bearer ${secret}`)) return json({ error: "Not allowed." }, 401);
  const store = getListStore();
  if (!store) return json({ error: "The database connection is not set up." }, 500);
  try {
    const lists = await store.list();
    if (lists.length === 0) return json({ refreshed: 0, failed: 0 });
    const pool = await loadPool();
    let refreshed = 0;
    let failed = 0;
    for (const list of lists) {
      try {
        await refreshList(store, list, pool);
        refreshed++;
      } catch (error) {
        failed++;
        console.error("Nightly refresh failed for one list", list.id, error instanceof Error ? error.message : error);
      }
    }
    return json({ refreshed, failed }, failed ? 207 : 200);
  } catch (error) {
    console.error("Nightly refresh failed", error instanceof Error ? error.message : error);
    return json({ error: "The nightly refresh could not run." }, 502);
  }
}
