import { SEED } from "./roadmap-seed";
import {
  STATUSES,
  isUuid,
  type ItemPatch,
  type NewItem,
  type RoadmapData,
  type RoadmapItem,
  type RoadmapNote,
  type Status,
} from "./roadmap";

/** A problem the visitor can understand: carries the HTTP status and a plain sentence. */
export class RoadmapError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const GONE = "That item no longer exists. Reload the page to see the latest list.";
const NOTE_GONE = "That note no longer exists. Reload the page to see the latest list.";
const NOT_TOP_LEVEL = "Subitems can only go under a top-level item.";

/** What the page needs from storage. Real storage and the in-memory copy both fit this. */
export interface RoadmapStore {
  readonly source: "live" | "sample";
  list(): Promise<RoadmapData>;
  createItem(input: NewItem): Promise<RoadmapItem>;
  updateItem(id: string, patch: ItemPatch): Promise<RoadmapItem>;
  /** Also deletes the item's subitems and notes. */
  deleteItem(id: string): Promise<void>;
  addNote(itemId: string, body: string): Promise<RoadmapNote>;
  deleteNote(id: string): Promise<void>;
}

/* ---------- In memory (development and tests) ---------- */

export function seedData(now: Date = new Date()): { items: RoadmapItem[]; notes: RoadmapNote[] } {
  const items: RoadmapItem[] = [];
  const notes: RoadmapNote[] = [];
  const stamp = now.toISOString();
  let order = 0;
  const add = (
    parentId: string | null,
    group: string | null,
    s: { title: string; status?: Status; due?: string; notes?: string[] },
    sortOrder: number,
  ) => {
    const id = crypto.randomUUID();
    items.push({ id, parentId, title: s.title, group, status: s.status ?? "Not started", dueDate: s.due ?? null, owner: null, sortOrder, createdAt: stamp });
    for (const body of s.notes ?? []) notes.push({ id: crypto.randomUUID(), itemId: id, body, createdAt: stamp });
    return id;
  };
  for (const g of SEED) {
    for (const item of g.items) {
      order += 1;
      const id = add(null, g.group, item, order);
      (item.subitems ?? []).forEach((sub, i) => add(id, null, sub, i + 1));
    }
  }
  return { items, notes };
}

export class MemoryStore implements RoadmapStore {
  readonly source = "sample" as const;
  private items: RoadmapItem[];
  private notes: RoadmapNote[];

  constructor(start: { items: RoadmapItem[]; notes: RoadmapNote[] } = seedData()) {
    this.items = start.items.map((i) => ({ ...i }));
    this.notes = start.notes.map((n) => ({ ...n }));
  }

  async list(): Promise<RoadmapData> {
    const notes = [...this.notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { source: this.source, items: this.items.map((i) => ({ ...i })), notes: notes.map((n) => ({ ...n })) };
  }

  private find(id: string): RoadmapItem {
    const item = isUuid(id) ? this.items.find((i) => i.id === id) : undefined;
    if (!item) throw new RoadmapError(404, GONE);
    return item;
  }

  async createItem(input: NewItem): Promise<RoadmapItem> {
    if (input.parentId) {
      const parent = this.find(input.parentId);
      if (parent.parentId !== null) throw new RoadmapError(400, NOT_TOP_LEVEL);
    }
    const siblings = this.items.filter((i) => i.parentId === input.parentId);
    const item: RoadmapItem = {
      id: crypto.randomUUID(),
      parentId: input.parentId,
      title: input.title,
      group: input.parentId ? null : input.group,
      status: input.status,
      dueDate: input.dueDate,
      owner: input.owner,
      sortOrder: Math.max(0, ...siblings.map((i) => i.sortOrder)) + 1,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    return { ...item };
  }

  async updateItem(id: string, patch: ItemPatch): Promise<RoadmapItem> {
    const item = this.find(id);
    const { group, ...rest } = patch;
    Object.assign(item, rest);
    if (group !== undefined && item.parentId === null) item.group = group;
    return { ...item };
  }

  async deleteItem(id: string): Promise<void> {
    const item = this.find(id);
    const gone = new Set([item.id, ...this.items.filter((i) => i.parentId === item.id).map((i) => i.id)]);
    this.items = this.items.filter((i) => !gone.has(i.id));
    this.notes = this.notes.filter((n) => !gone.has(n.itemId));
  }

  async addNote(itemId: string, body: string): Promise<RoadmapNote> {
    this.find(itemId);
    // Two notes added in the same millisecond still keep the order they were added in.
    const latest = this.notes.reduce((max, n) => Math.max(max, Date.parse(n.createdAt)), 0);
    const note: RoadmapNote = {
      id: crypto.randomUUID(),
      itemId,
      body,
      createdAt: new Date(Math.max(Date.now(), latest + 1)).toISOString(),
    };
    this.notes.push(note);
    return { ...note };
  }

  async deleteNote(id: string): Promise<void> {
    const index = isUuid(id) ? this.notes.findIndex((n) => n.id === id) : -1;
    if (index < 0) throw new RoadmapError(404, NOTE_GONE);
    this.notes.splice(index, 1);
  }
}

const globalStore = globalThis as unknown as { __ccsRoadmapMemory?: MemoryStore };

/** One shared copy for the whole running server, so changes survive between requests. */
export function memoryStore(): MemoryStore {
  return (globalStore.__ccsRoadmapMemory ??= new MemoryStore());
}

/* ---------- Supabase ---------- */

interface ItemRow {
  id: string;
  parent_id: string | null;
  title: string;
  group_name: string | null;
  status: string;
  due_date: string | null;
  owner: string | null;
  sort_order: number;
  created_at: string;
}

interface NoteRow {
  id: string;
  item_id: string;
  body: string;
  created_at: string;
}

export const toItem = (r: ItemRow): RoadmapItem => ({
  id: r.id,
  parentId: r.parent_id,
  title: r.title,
  group: r.group_name,
  status: (STATUSES as readonly string[]).includes(r.status) ? (r.status as Status) : "Not started",
  dueDate: r.due_date,
  owner: r.owner,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

export const toNote = (r: NoteRow): RoadmapNote => ({ id: r.id, itemId: r.item_id, body: r.body, createdAt: r.created_at });

const PAGE = 1000;
const SAVE_FAILED = "The roadmap could not be reached. Try again in a minute.";

export class SupabaseStore implements RoadmapStore {
  readonly source = "live" as const;

  constructor(
    private cfg: { url: string; key: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async rest(path: string, init: { method?: string; body?: unknown; returning?: boolean } = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/rest/v1/${path}`, {
        method: init.method ?? "GET",
        headers: {
          apikey: this.cfg.key,
          Authorization: `Bearer ${this.cfg.key}`,
          "Content-Type": "application/json",
          ...(init.returning ? { Prefer: "return=representation" } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (error) {
      console.error("Roadmap request failed", path.split("?")[0], error);
      throw new RoadmapError(502, SAVE_FAILED);
    }
    return res;
  }

  /** Runs a request and returns its rows. A 409 means the item it points at is already gone. */
  private async rows<T>(path: string, init: Parameters<SupabaseStore["rest"]>[1] = {}, goneMessage = GONE): Promise<T[]> {
    const res = await this.rest(path, init);
    if (res.status === 409) throw new RoadmapError(404, goneMessage);
    if (!res.ok) {
      console.error("Roadmap request refused", path.split("?")[0], res.status);
      throw new RoadmapError(502, SAVE_FAILED);
    }
    return (await res.json()) as T[];
  }

  private async all<T>(table: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.rows<T>(`${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  }

  async list(): Promise<RoadmapData> {
    const [items, notes] = await Promise.all([
      this.all<ItemRow>("roadmap_items", "sort_order.asc,created_at.asc"),
      this.all<NoteRow>("roadmap_notes", "created_at.desc"),
    ]);
    return { source: this.source, items: items.map(toItem), notes: notes.map(toNote) };
  }

  private async existing(id: string): Promise<ItemRow> {
    if (!isUuid(id)) throw new RoadmapError(404, GONE);
    const [row] = await this.rows<ItemRow>(`roadmap_items?select=*&id=eq.${id}`);
    if (!row) throw new RoadmapError(404, GONE);
    return row;
  }

  async createItem(input: NewItem): Promise<RoadmapItem> {
    if (input.parentId) {
      const parent = await this.existing(input.parentId);
      if (parent.parent_id !== null) throw new RoadmapError(400, NOT_TOP_LEVEL);
    }
    const siblings = input.parentId ? `parent_id=eq.${input.parentId}` : "parent_id=is.null";
    const [last] = await this.rows<{ sort_order: number }>(`roadmap_items?select=sort_order&${siblings}&order=sort_order.desc&limit=1`);
    const [row] = await this.rows<ItemRow>("roadmap_items", {
      method: "POST",
      returning: true,
      body: {
        parent_id: input.parentId,
        title: input.title,
        group_name: input.parentId ? null : input.group,
        status: input.status,
        due_date: input.dueDate,
        owner: input.owner,
        sort_order: (last?.sort_order ?? 0) + 1,
      },
    });
    return toItem(row);
  }

  async updateItem(id: string, patch: ItemPatch): Promise<RoadmapItem> {
    const current = await this.existing(id);
    const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.status !== undefined) body.status = patch.status;
    if (patch.dueDate !== undefined) body.due_date = patch.dueDate;
    if (patch.owner !== undefined) body.owner = patch.owner;
    // Subitems have no group of their own.
    if (patch.group !== undefined && current.parent_id === null) body.group_name = patch.group;
    const [row] = await this.rows<ItemRow>(`roadmap_items?id=eq.${current.id}`, { method: "PATCH", returning: true, body });
    if (!row) throw new RoadmapError(404, GONE);
    return toItem(row);
  }

  async deleteItem(id: string): Promise<void> {
    if (!isUuid(id)) throw new RoadmapError(404, GONE);
    // Subitems and notes go with it (on delete cascade in the database).
    const gone = await this.rows<{ id: string }>(`roadmap_items?select=id&id=eq.${id}`, { method: "DELETE", returning: true });
    if (gone.length === 0) throw new RoadmapError(404, GONE);
  }

  async addNote(itemId: string, body: string): Promise<RoadmapNote> {
    if (!isUuid(itemId)) throw new RoadmapError(404, GONE);
    const [row] = await this.rows<NoteRow>("roadmap_notes", { method: "POST", returning: true, body: { item_id: itemId, body } });
    return toNote(row);
  }

  async deleteNote(id: string): Promise<void> {
    if (!isUuid(id)) throw new RoadmapError(404, NOTE_GONE);
    const gone = await this.rows<{ id: string }>(`roadmap_notes?select=id&id=eq.${id}`, { method: "DELETE", returning: true }, NOTE_GONE);
    if (gone.length === 0) throw new RoadmapError(404, NOTE_GONE);
  }
}
