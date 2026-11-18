import { mailchimpBase, mailchimpConfig } from "./mailchimp";
import { pacificCalendarDate, dayOffset } from "./dates";
import { RECENT_DAYS, type AudienceContact, type RecentMail } from "./email-lists";

/**
 * Mailchimp for the email list builder: reading the audience (addresses, the Member # field and interest groups), who got a
 * campaign in the last week, keeping a tag in step with a list, and making a draft campaign for a tag. It never sends.
 * Addresses only ever pass between the server and Mailchimp, and between the server and a browser holding the list password.
 */

export class MailchimpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ListsMailchimp {
  key: string;
  dc: string;
  listId: string;
  base: string;
}

/** The Mailchimp settings, or null when MAILCHIMP_API_KEY is not set. Tests may point it at a stand-in server. */
export function listsMailchimp(env: Record<string, string | undefined> = process.env): ListsMailchimp | null {
  const cfg = mailchimpConfig(env);
  if (!cfg) return null;
  return { key: cfg.key, dc: cfg.dc, listId: cfg.listId, base: mailchimpBase(cfg.dc, env) };
}

type Fetch = typeof fetch;

async function call<T>(mc: ListsMailchimp, path: string, init: { method?: string; body?: unknown } = {}, fetchImpl: Fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${mc.base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: "Basic " + Buffer.from(`ccs:${mc.key}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Mailchimp request failed", path.split("?")[0], error);
    throw new MailchimpError(502, "Mailchimp could not be reached. Try again in a minute.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { title?: string; detail?: string };
      detail = [body.title, body.detail].filter(Boolean).join(": ");
    } catch {
      /* no body */
    }
    console.error("Mailchimp refused", init.method ?? "GET", path.split("?")[0], res.status, detail);
    if (res.status === 401 || res.status === 403) throw new MailchimpError(502, "Mailchimp refused the club's key. Check MAILCHIMP_API_KEY in Vercel.");
    throw new MailchimpError(502, `Mailchimp did not accept that${detail ? ` (${detail.slice(0, 200)})` : ""}.`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ---------- Reading the audience ---------- */

interface MergeField {
  tag: string;
  name: string;
}
interface RawMember {
  email_address: string;
  status: string;
  merge_fields?: Record<string, unknown>;
  interests?: Record<string, boolean>;
}

const PAGE = 1000;

/** Finds a merge field's tag by its display name ("Member #"), ignoring capitals, spaces and punctuation. */
export function findTag(fields: MergeField[], ...names: string[]): string | null {
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, "");
  const wanted = names.map(flat);
  return fields.find((f) => wanted.includes(flat(f.name)))?.tag ?? null;
}

export async function loadAudience(mc: ListsMailchimp, fetchImpl: Fetch = fetch): Promise<AudienceContact[]> {
  const fields = await call<{ merge_fields: MergeField[] }>(mc, `/lists/${mc.listId}/merge-fields?count=100&fields=merge_fields.tag,merge_fields.name`, {}, fetchImpl);
  const numberTag = findTag(fields.merge_fields ?? [], "Member #", "Member Number", "Member No");
  const nameTag = findTag(fields.merge_fields ?? [], "Member Name");

  const interestNames = new Map<string, string>();
  const cats = await call<{ categories: { id: string }[] }>(mc, `/lists/${mc.listId}/interest-categories?count=60&fields=categories.id`, {}, fetchImpl);
  for (const cat of cats.categories ?? []) {
    const list = await call<{ interests: { id: string; name: string }[] }>(
      mc,
      `/lists/${mc.listId}/interest-categories/${cat.id}/interests?count=100&fields=interests.id,interests.name`,
      {},
      fetchImpl,
    );
    for (const i of list.interests ?? []) interestNames.set(i.id, i.name);
  }

  const out: AudienceContact[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const page = await call<{ members: RawMember[]; total_items: number }>(
      mc,
      `/lists/${mc.listId}/members?count=${PAGE}&offset=${offset}&fields=total_items,members.email_address,members.status,members.merge_fields,members.interests`,
      {},
      fetchImpl,
    );
    for (const m of page.members ?? []) {
      const mf = m.merge_fields ?? {};
      const text = (tag: string | null) => (tag && typeof mf[tag] === "string" && (mf[tag] as string).trim() ? (mf[tag] as string).trim() : tag && typeof mf[tag] === "number" ? String(mf[tag]) : null);
      out.push({
        email: m.email_address,
        status: m.status,
        memberNumber: text(numberTag),
        memberName: text(nameTag),
        firstName: text("FNAME") ?? "",
        lastName: text("LNAME") ?? "",
        interests: Object.entries(m.interests ?? {})
          .filter(([, on]) => on)
          .map(([id]) => interestNames.get(id))
          .filter((n): n is string => Boolean(n)),
      });
    }
    if (offset + PAGE >= (page.total_items ?? 0)) break;
  }
  return out;
}

/** Who got a campaign to this audience in the last RECENT_DAYS days, by lower-case address. */
export async function loadRecentMail(mc: ListsMailchimp, now: Date, fetchImpl: Fetch = fetch): Promise<RecentMail> {
  const since = dayOffset(pacificCalendarDate(now.toISOString()), -RECENT_DAYS);
  const reports = await call<{ reports: { id: string; list_id?: string; campaign_title?: string; subject_line?: string; send_time?: string }[] }>(
    mc,
    `/reports?count=100&since_send_time=${since}T00:00:00%2B00:00&fields=reports.id,reports.list_id,reports.campaign_title,reports.subject_line,reports.send_time`,
    {},
    fetchImpl,
  );
  const recent: RecentMail = new Map();
  for (const r of reports.reports ?? []) {
    if (r.list_id && r.list_id !== mc.listId) continue;
    if (!r.send_time) continue;
    const entry = { title: r.subject_line || r.campaign_title || "A campaign", sentOn: pacificCalendarDate(r.send_time) };
    for (let offset = 0; offset < 50_000; offset += PAGE) {
      const page = await call<{ sent_to: { email_address: string }[]; total_items: number }>(
        mc,
        `/reports/${r.id}/sent-to?count=${PAGE}&offset=${offset}&fields=total_items,sent_to.email_address`,
        {},
        fetchImpl,
      );
      for (const s of page.sent_to ?? []) {
        const key = s.email_address.toLowerCase();
        recent.set(key, [...(recent.get(key) ?? []), entry]);
      }
      if (offset + PAGE >= (page.total_items ?? 0)) break;
    }
  }
  return recent;
}

/* ---------- The tag ---------- */

/** The tag's name in Mailchimp: marked so staff can tell it is kept up to date by the dashboard. */
export function tagName(listName: string): string {
  return `Auto: ${listName.replace(/\s+/g, " ").trim()}`.slice(0, 100);
}

export async function createTag(mc: ListsMailchimp, name: string, fetchImpl: Fetch = fetch): Promise<number> {
  const seg = await call<{ id: number }>(mc, `/lists/${mc.listId}/segments`, { method: "POST", body: { name, static_segment: [] } }, fetchImpl);
  return seg.id;
}

async function tagMembers(mc: ListsMailchimp, tagId: number, fetchImpl: Fetch): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const page = await call<{ members: { email_address: string }[]; total_items: number }>(
      mc,
      `/lists/${mc.listId}/segments/${tagId}/members?count=${PAGE}&offset=${offset}&fields=total_items,members.email_address`,
      {},
      fetchImpl,
    );
    out.push(...(page.members ?? []).map((m) => m.email_address.toLowerCase()));
    if (offset + PAGE >= (page.total_items ?? 0)) break;
  }
  return out;
}

/** Puts exactly these addresses on the tag: adds the new ones and takes off anyone who no longer fits. */
export async function syncTag(mc: ListsMailchimp, tagId: number, emails: string[], fetchImpl: Fetch = fetch): Promise<{ added: number; removed: number }> {
  const want = new Set(emails.map((e) => e.toLowerCase()));
  const have = new Set(await tagMembers(mc, tagId, fetchImpl));
  const add = [...want].filter((e) => !have.has(e));
  const remove = [...have].filter((e) => !want.has(e));
  // Mailchimp takes at most 500 addresses each way per call.
  for (let i = 0; i < Math.max(add.length, remove.length); i += 500) {
    await call(mc, `/lists/${mc.listId}/segments/${tagId}`, { method: "POST", body: { members_to_add: add.slice(i, i + 500), members_to_remove: remove.slice(i, i + 500) } }, fetchImpl);
  }
  return { added: add.length, removed: remove.length };
}

/* ---------- The draft campaign ---------- */

export interface DraftResult {
  campaignId: string;
  webId: number;
  editUrl: string;
}

export async function createDraftCampaign(
  mc: ListsMailchimp,
  input: { tagId: number; title: string; subject: string; previewText: string; html: string },
  fetchImpl: Fetch = fetch,
): Promise<DraftResult> {
  const list = await call<{ campaign_defaults?: { from_name?: string; from_email?: string } }>(mc, `/lists/${mc.listId}?fields=campaign_defaults`, {}, fetchImpl);
  const fromName = list.campaign_defaults?.from_name || "College Club Seattle";
  const replyTo = list.campaign_defaults?.from_email;
  if (!replyTo) throw new MailchimpError(502, "The Mailchimp audience has no default reply-to address. Set one in Mailchimp (Audience > Settings > Required email footer content), then try again.");
  const campaign = await call<{ id: string; web_id: number }>(
    mc,
    "/campaigns",
    {
      method: "POST",
      body: {
        type: "regular",
        recipients: { list_id: mc.listId, segment_opts: { saved_segment_id: input.tagId } },
        settings: { subject_line: input.subject, preview_text: input.previewText, title: input.title, from_name: fromName, reply_to: replyTo },
      },
    },
    fetchImpl,
  );
  await call(mc, `/campaigns/${campaign.id}/content`, { method: "PUT", body: { html: input.html } }, fetchImpl);
  return { campaignId: campaign.id, webId: campaign.web_id, editUrl: `https://${mc.dc}.admin.mailchimp.com/campaigns/edit?id=${campaign.web_id}` };
}

