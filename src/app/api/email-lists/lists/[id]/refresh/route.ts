import type { NextRequest } from "next/server";
import { getListStore, json, loadPool, refreshList, withLists } from "@/lib/email-lists-api";

type Context = { params: Promise<{ id: string }> };

/** Refreshes one saved list now, instead of waiting for the night. */
export async function POST(request: NextRequest, { params }: Context) {
  return withLists(request, true, async () => {
    const { id } = await params;
    const store = getListStore();
    if (!store) return json({ error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, 500);
    const list = await store.get(id);
    if (!list) return json({ error: "That list is not there any more. Reload the page." }, 404);
    const done = await refreshList(store, list, await loadPool());
    return json({ list: done.list, added: done.added, removed: done.removed });
  });
}
