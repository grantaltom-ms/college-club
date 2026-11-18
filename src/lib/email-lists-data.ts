import { randomUUID } from "node:crypto";
import { buildRoster, type QbRow } from "./roster";
import { fetchAll, toMember, type MemberRow } from "./supabase";
import {
  linkContacts,
  normalizeInterest,
  poolInterests,
  samplePool,
  sampleContacts,
  type AudienceContact,
  type ListPerson,
  type ListRule,
  type PoolInfo,
} from "./email-lists";

/**
 * Where the list builder's members and saved lists come from. Live: the dashboard's Supabase tables (qb_members is the roster,
 * members holds visits, member_interests the application answers, member_rowing the shell outings) and the saved_email_lists
 * table. While developing and in tests: invented members and an in-memory list of saved lists.
 */

type Cfg = { url: string; key: string };

interface InterestRow {
  member_name: string;
  member_number: string | null;
  interest: string;
}
interface RowingRow {
  member_name: string;
  member_number: string | null;
  shell_outings: number;
  period_from: string;
  period_to: string;
}

/** A table that has not been made yet reads as empty, so the builder still works with what is loaded. */
async function optional<T>(cfg: Cfg, table: string, order: string): Promise<T[]> {
  try {
    return await fetchAll<T>(cfg, table, order);
  } catch (error) {
    console.warn(`${table} could not be read; treating it as empty`, error instanceof Error ? error.message : error);
    return [];
  }
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export async function loadLivePool(cfg: Cfg): Promise<{ pool: ListPerson[]; info: Omit<PoolInfo, "interests"> }> {
  const [memberRows, qbRows, interestRows, rowingRows] = await Promise.all([
    fetchAll<MemberRow>(cfg, "members", "member_name.asc"),
    fetchAll<QbRow>(cfg, "qb_members", "qb_name.asc"),
    optional<InterestRow>(cfg, "member_interests", "member_name.asc"),
    optional<RowingRow>(cfg, "member_rowing", "member_name.asc"),
  ]);
  if (qbRows.length === 0) throw new Error("qb_members is empty: load the QuickBooks member list first");
  const visitsThrough = memberRows[0]?.data_through ?? "2026-09-27";
  const roster = buildRoster(qbRows, memberRows.map(toMember), visitsThrough);
  const numberOf = new Map(qbRows.map((r) => [r.qb_name, r.qb_member_number]));

  // Application answers and rowing figures are matched by QuickBooks member number first, then by name.
  const keyFor = (name: string, num: string | null) => (num ? `#${num.trim()}` : `@${squash(name)}`);
  const interests = new Map<string, Set<string>>();
  for (const r of interestRows) {
    if (!r.interest?.trim()) continue;
    for (const k of [r.member_number ? keyFor("", r.member_number) : null, keyFor(r.member_name, null)]) {
      if (!k) continue;
      interests.set(k, (interests.get(k) ?? new Set()).add(normalizeInterest(r.interest)));
    }
  }
  const rowing = new Map<string, number>();
  for (const r of rowingRows) {
    if (r.member_number) rowing.set(keyFor("", r.member_number), r.shell_outings);
    rowing.set(keyFor(r.member_name, null), r.shell_outings);
  }
  const period = rowingRows.length
    ? { from: rowingRows.reduce((m, r) => (r.period_from < m ? r.period_from : m), rowingRows[0].period_from), to: rowingRows.reduce((m, r) => (r.period_to > m ? r.period_to : m), rowingRows[0].period_to) }
    : null;

  let withAnswers = 0;
  const pool: ListPerson[] = roster.members.map((m) => {
    const num = numberOf.get(m.name) ?? null;
    const keys = [num ? keyFor("", num) : null, keyFor(m.name, null)].filter((k): k is string => Boolean(k));
    const mine = new Set<string>();
    for (const k of keys) for (const i of interests.get(k) ?? []) mine.add(i);
    if (mine.size) withAnswers++;
    const rowed = keys.map((k) => rowing.get(k)).find((v) => v !== undefined) ?? 0;
    return {
      key: num ?? m.name,
      name: m.name,
      memberNumber: num,
      memberType: m.memberType ?? "",
      joined: m.joined,
      visitsPerMonth: Math.round(m.visitsPerMonth * 10) / 10,
      visitDays: m.visitDays,
      lastVisit: m.lastVisit,
      interests: [...mine].sort(),
      shellOutings: rowed,
      emails: [],
    };
  });
  return { pool, info: { source: "live", visitsThrough, rowing: period, withApplicationAnswers: withAnswers } };
}

export const sampleAllowed = () => process.env.NODE_ENV !== "production" || process.env.CCS_ALLOW_SAMPLE_DATA === "1";

/** The members with their Mailchimp addresses linked. `contacts` is null when Mailchimp is not connected. */
export function finishPool(base: { pool: ListPerson[]; info: Omit<PoolInfo, "interests"> }, contacts: AudienceContact[] | null) {
  const pool = linkContacts(base.pool, contacts ?? (base.info.source === "sample" ? sampleContacts() : []));
  return { pool, info: { ...base.info, interests: poolInterests(pool) } satisfies PoolInfo };
}

export { samplePool };

/* ---------- Saved lists ---------- */

export interface SavedList {
  id: string;
  name: string;
  /** What the person typed. */
  request: string;
  rule: ListRule;
  tagId: number;
  tagName: string;
  /** Households and addresses on the tag after the last refresh. */
  households: number;
  emails: number;
  lastSyncedAt: string;
  createdAt: string;
  lastDraftUrl: string | null;
  lastDraftAt: string | null;
}

export class ListStoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ListStore {
  list(): Promise<SavedList[]>;
  get(id: string): Promise<SavedList | null>;
  add(input: Omit<SavedList, "id" | "createdAt" | "lastDraftUrl" | "lastDraftAt">): Promise<SavedList>;
  update(id: string, patch: Partial<Pick<SavedList, "households" | "emails" | "lastSyncedAt" | "lastDraftUrl" | "lastDraftAt">>): Promise<SavedList>;
}

export const MAX_LISTS = 50;

export class MemoryListStore implements ListStore {
  private rows: SavedList[] = [];
  async list() {
    return [...this.rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async get(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async add(input: Omit<SavedList, "id" | "createdAt" | "lastDraftUrl" | "lastDraftAt">) {
    if (this.rows.length >= MAX_LISTS) throw new ListStoreError(400, `There are already ${MAX_LISTS} saved lists.`);
    const row: SavedList = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), lastDraftUrl: null, lastDraftAt: null };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: Partial<SavedList>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new ListStoreError(404, "That list is not there any more. Reload the page.");
    Object.assign(row, patch);
    return row;
  }
}

const globalStore = globalThis as unknown as { __ccsEmailListsMemory?: MemoryListStore };
export function memoryListStore(): MemoryListStore {
  globalStore.__ccsEmailListsMemory ??= new MemoryListStore();
  return globalStore.__ccsEmailListsMemory;
}

export interface SavedListRow {
  id: string;
  name: string;
  request: string;
  rule: ListRule;
  mailchimp_tag_id: number;
  mailchimp_tag_name: string;
  households: number;
  emails: number;
  last_synced_at: string;
  created_at: string;
  last_draft_url: string | null;
  last_draft_at: string | null;
}

export const toSavedList = (r: SavedListRow): SavedList => ({
  id: r.id,
  name: r.name,
  request: r.request,
  rule: r.rule,
  tagId: Number(r.mailchimp_tag_id),
  tagName: r.mailchimp_tag_name,
  households: r.households,
  emails: r.emails,
  lastSyncedAt: r.last_synced_at,
  createdAt: r.created_at,
  lastDraftUrl: r.last_draft_url,
  lastDraftAt: r.last_draft_at,
});

const TABLE = "saved_email_lists";

export class SupabaseListStore implements ListStore {
  constructor(
    private cfg: Cfg,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async rows<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/rest/v1/${path}`, {
        method: init.method ?? "GET",
        headers: { apikey: this.cfg.key, Authorization: `Bearer ${this.cfg.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (error) {
      console.error("Saved lists request failed", path.split("?")[0], error);
      throw new ListStoreError(502, "The saved lists could not be reached. Try again in a minute.");
    }
    if (!res.ok) {
      console.error("Saved lists request refused", path.split("?")[0], res.status);
      throw new ListStoreError(502, "The saved lists could not be loaded. If the saved_email_lists table has not been set up yet, see db/saved_email_lists.sql.");
    }
    return (await res.json()) as T[];
  }

  async list() {
    return (await this.rows<SavedListRow>(`${TABLE}?select=*&order=created_at.desc&limit=${MAX_LISTS}`)).map(toSavedList);
  }
  async get(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await this.rows<SavedListRow>(`${TABLE}?select=*&id=eq.${id}`);
    return row ? toSavedList(row) : null;
  }
  async add(input: Omit<SavedList, "id" | "createdAt" | "lastDraftUrl" | "lastDraftAt">) {
    const existing = await this.rows<{ id: string }>(`${TABLE}?select=id&limit=${MAX_LISTS + 1}`);
    if (existing.length >= MAX_LISTS) throw new ListStoreError(400, `There are already ${MAX_LISTS} saved lists.`);
    const [row] = await this.rows<SavedListRow>(TABLE, {
      method: "POST",
      body: {
        name: input.name,
        request: input.request,
        rule: input.rule,
        mailchimp_tag_id: input.tagId,
        mailchimp_tag_name: input.tagName,
        households: input.households,
        emails: input.emails,
        last_synced_at: input.lastSyncedAt,
      },
    });
    return toSavedList(row);
  }
  async update(id: string, patch: Partial<SavedList>) {
    const body: Record<string, unknown> = {};
    if (patch.households !== undefined) body.households = patch.households;
    if (patch.emails !== undefined) body.emails = patch.emails;
    if (patch.lastSyncedAt !== undefined) body.last_synced_at = patch.lastSyncedAt;
    if (patch.lastDraftUrl !== undefined) body.last_draft_url = patch.lastDraftUrl;
    if (patch.lastDraftAt !== undefined) body.last_draft_at = patch.lastDraftAt;
    const [row] = await this.rows<SavedListRow>(`${TABLE}?id=eq.${id}`, { method: "PATCH", body });
    if (!row) throw new ListStoreError(404, "That list is not there any more. Reload the page.");
    return toSavedList(row);
  }
}
