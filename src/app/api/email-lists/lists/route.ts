import type { NextRequest } from "next/server";
import { getListStore, json, loadPool, needMailchimp, readBody, refreshList, withLists } from "@/lib/email-lists-api";
import { parseRule, ruleIsEmpty } from "@/lib/email-lists";
import { createTag, tagName } from "@/lib/email-lists-mailchimp";

/** Saves a list: makes its Mailchimp tag and puts the matching addresses on it. From then on it is refreshed every night. */
export async function POST(request: NextRequest) {
  return withLists(request, true, async () => {
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const name = typeof read.body.name === "string" ? read.body.name.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2 || name.length > 80) return json({ error: "Give the list a name of 2 to 80 characters." }, 400);
    const requestText = typeof read.body.request === "string" ? read.body.request.trim().slice(0, 1000) : "";
    const parsed = parseRule(read.body.rule);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    if (ruleIsEmpty(parsed.rule)) return json({ error: "Pick at least one filter. With none, the list would be the whole club." }, 400);
    const store = getListStore();
    if (!store) return json({ error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, 500);
    const existing = await store.list();
    if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) return json({ error: `There is already a list called "${name}". Pick another name.` }, 400);
    const now = new Date();
    const pool = await loadPool(now);
    const mc = needMailchimp(pool);
    const tag = tagName(name);
    const tagId = await createTag(mc, tag);
    const saved = await store.add({ name, request: requestText, rule: parsed.rule, tagId, tagName: tag, households: 0, emails: 0, lastSyncedAt: now.toISOString() });
    const done = await refreshList(store, saved, pool, now);
    return json({ list: done.list, added: done.added }, 201);
  });
}
