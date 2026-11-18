import type { NextRequest } from "next/server";
import { applyRule, describeRule, pacificToday, samplePool, type ListResult, type ListRule, type PoolInfo, type RecentMail } from "./email-lists";
import { ClaudeError } from "./email-lists-claude";
import {
  finishPool,
  ListStoreError,
  loadLivePool,
  memoryListStore,
  sampleAllowed,
  SupabaseListStore,
  type ListStore,
  type SavedList,
} from "./email-lists-data";
import { EMAIL_LISTS_COOKIE, emailListsUnlocked } from "./email-lists-lock";
import { listsMailchimp, loadAudience, loadRecentMail, MailchimpError, syncTag, type ListsMailchimp } from "./email-lists-mailchimp";
import { sameOrigin } from "./same-origin";
import { liveConfig } from "./supabase";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 20_000;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function getListStore(): ListStore | null {
  const cfg = liveConfig();
  if (cfg) return new SupabaseListStore(cfg);
  if (sampleAllowed()) return memoryListStore();
  return null;
}

export async function readBody(request: Request): Promise<{ body: Record<string, unknown> } | { response: Response }> {
  const tooBig = json({ error: "That is too much text to send at once. Shorten it and try again." }, 413);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return { response: tooBig };
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return { response: tooBig };
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { body };
  } catch {
    return { response: json({ error: "That request could not be read. Reload the page and try again." }, 400) };
  }
}

/** Every list builder route goes through here: the list password's pass, and for a change, a request from this site's own page. */
export async function withLists(request: NextRequest, change: boolean, run: () => Promise<Response>): Promise<Response> {
  if (change && !sameOrigin(request.headers)) return json({ error: "That request did not come from this page." }, 403);
  if (!emailListsUnlocked(request.cookies.get(EMAIL_LISTS_COOKIE)?.value)) {
    return json({ error: "The list builder is locked. Type the list builder password first." }, 401);
  }
  try {
    return await run();
  } catch (error) {
    if (error instanceof ClaudeError || error instanceof MailchimpError || error instanceof ListStoreError) return json({ error: error.message }, error.status);
    console.error("Email list builder failed", error);
    return json({ error: "Something went wrong building the list. Try again, and if it keeps happening, check the server logs." }, 500);
  }
}

export interface Pool {
  pool: Awaited<ReturnType<typeof finishPool>>["pool"];
  info: PoolInfo;
  recent: RecentMail;
  mailchimp: ListsMailchimp | null;
}

/** The members, their addresses, and who was emailed in the last week. */
export async function loadPool(now: Date = new Date()): Promise<Pool> {
  const today = pacificToday(now);
  const cfg = liveConfig();
  let base;
  if (cfg) {
    try {
      base = await loadLivePool(cfg);
    } catch (error) {
      console.error("Member list could not be loaded", error instanceof Error ? error.message : error);
      throw new ListStoreError(502, "The member list could not be loaded. Check that qb_members and members are loaded in Supabase, and that member_interests and member_rowing can be read if they have been made. Nothing was changed in Mailchimp.");
    }
  } else if (sampleAllowed()) {
    base = samplePool(today);
  } else {
    throw new ListStoreError(500, "The database connection is not set up. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const mailchimp = listsMailchimp();
  const [contacts, recent] = mailchimp ? await Promise.all([loadAudience(mailchimp), loadRecentMail(mailchimp, now)]) : [null, new Map() as RecentMail];
  if (!mailchimp && base.info.source === "live") {
    throw new MailchimpError(503, "Mailchimp is not connected yet. Add MAILCHIMP_API_KEY in Vercel, then redeploy.");
  }
  const { pool, info } = finishPool(base, contacts);
  return { pool, info, recent, mailchimp };
}

/** What the page gets back for a rule: the filters in words and who matches. Names and addresses, so password only. */
export function resultBody(p: Pool, rule: ListRule, now: Date = new Date()): { words: string[]; result: ListResult; info: PoolInfo } {
  const today = pacificToday(now);
  return { words: describeRule(rule, today, p.info), result: applyRule(p.pool, rule, today, p.recent), info: p.info };
}

export function needMailchimp(p: Pool): ListsMailchimp {
  if (!p.mailchimp) throw new MailchimpError(503, "Mailchimp is not connected yet. Add MAILCHIMP_API_KEY in Vercel, then redeploy.");
  return p.mailchimp;
}

/** Re-runs a saved list's rule and puts exactly those addresses on its Mailchimp tag. */
export async function refreshList(store: ListStore, list: SavedList, p: Pool, now: Date = new Date()): Promise<{ list: SavedList; result: ListResult; added: number; removed: number }> {
  const { result } = resultBody(p, list.rule, now);
  const { added, removed } = await syncTag(needMailchimp(p), list.tagId, result.emails);
  const updated = await store.update(list.id, { households: result.people.length, emails: result.emails.length, lastSyncedAt: now.toISOString() });
  return { list: updated, result, added, removed };
}
