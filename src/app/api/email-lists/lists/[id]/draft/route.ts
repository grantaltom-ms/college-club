import type { NextRequest } from "next/server";
import { getListStore, json, loadPool, needMailchimp, readBody, refreshList, withLists } from "@/lib/email-lists-api";
import { describeRule, draftHtml, pacificToday } from "@/lib/email-lists";
import { writeDraft } from "@/lib/email-lists-claude";
import { createDraftCampaign } from "@/lib/email-lists-mailchimp";

type Context = { params: Promise<{ id: string }> };

/**
 * Writes a draft campaign to a saved list. The list is refreshed first so the tag is current, Claude writes the words, and the
 * draft is made in Mailchimp aimed at the tag. It is never sent from here: someone opens it in Mailchimp, checks it and sends it.
 */
export async function POST(request: NextRequest, { params }: Context) {
  return withLists(request, true, async () => {
    const { id } = await params;
    const read = await readBody(request);
    if ("response" in read) return read.response;
    const ask = typeof read.body.request === "string" ? read.body.request.trim() : "";
    if (ask.length < 10) return json({ error: "Say what the email should tell them, in a sentence or two." }, 400);
    if (ask.length > 3000) return json({ error: "That is too long. Keep it under 3,000 characters." }, 400);
    const store = getListStore();
    if (!store) return json({ error: "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }, 500);
    const list = await store.get(id);
    if (!list) return json({ error: "That list is not there any more. Reload the page." }, 404);
    const now = new Date();
    const pool = await loadPool(now);
    const mc = needMailchimp(pool);
    const done = await refreshList(store, list, pool, now);
    if (done.result.emails.length === 0) return json({ error: "Nobody on this list has an email address Mailchimp can send to right now, so no draft was made." }, 400);
    const words = describeRule(list.rule, pacificToday(now), pool.info);
    const copy = await writeDraft(ask, list.name, words, done.result.people.length);
    const draft = await createDraftCampaign(mc, {
      tagId: list.tagId,
      title: `${list.name} (draft ${pacificToday(now)})`,
      subject: copy.subject,
      previewText: copy.previewText,
      html: draftHtml(copy),
    });
    const updated = await store.update(list.id, { lastDraftUrl: draft.editUrl, lastDraftAt: now.toISOString() });
    return json({
      list: updated,
      draft: { ...copy, editUrl: draft.editUrl },
      households: done.result.people.length,
      emails: done.result.emails.length,
      recentAmongIncluded: done.result.recentAmongIncluded,
    });
  });
}
