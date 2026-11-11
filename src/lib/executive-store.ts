import { MAX_ITEMS, SEED_PRIORITIES, type Priority, type PriorityInput } from "./executive-items";
import { isUuid } from "./roadmap";

/** A problem the visitor can understand: carries the HTTP status and a plain sentence. */
export class PriorityError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const GONE = "That priority no longer exists. Reload the page to see the latest list.";
const FULL = `The page holds up to ${MAX_ITEMS} priorities. Remove one before adding another.`;

export interface PriorityStore {
  readonly source: "live" | "sample";
  list(): Promise<Priority[]>;
  create(input: PriorityInput): Promise<Priority>;
  update(id: string, input: PriorityInput): Promise<Priority>;
  remove(id: string): Promise<void>;
  /** Puts every item in the given order (each id exactly once). */
  reorder(ids: string[]): Promise<Priority[]>;
}

const byOrder = (a: Priority, b: Priority) => a.sortOrder - b.sortOrder || a.updatedAt.localeCompare(b.updatedAt);

/* ---------- In memory (development and tests) ---------- */

export function seedPriorities(now = new Date()): Priority[] {
  return SEED_PRIORITIES.map((p, i) => ({ ...p, facts: [...p.facts], id: crypto.randomUUID(), sortOrder: i + 1, updatedAt: now.toISOString() }));
}

export class MemoryPriorityStore implements PriorityStore {
  readonly source = "sample" as const;
  private items: Priority[];

  constructor(start: Priority[] = seedPriorities()) {
    this.items = start.map((p) => ({ ...p, facts: [...p.facts] }));
  }

  private copy = (p: Priority): Priority => ({ ...p, facts: [...p.facts] });

  async list() {
    return [...this.items].sort(byOrder).map(this.copy);
  }

  private find(id: string) {
    const item = isUuid(id) ? this.items.find((p) => p.id === id) : undefined;
    if (!item) throw new PriorityError(404, GONE);
    return item;
  }

  async create(input: PriorityInput) {
    if (this.items.length >= MAX_ITEMS) throw new PriorityError(400, FULL);
    const item: Priority = {
      ...input,
      facts: [...input.facts],
      id: crypto.randomUUID(),
      sortOrder: Math.max(0, ...this.items.map((p) => p.sortOrder)) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.items.push(item);
    return this.copy(item);
  }

  async update(id: string, input: PriorityInput) {
    const item = this.find(id);
    Object.assign(item, { ...input, facts: [...input.facts], updatedAt: new Date().toISOString() });
    return this.copy(item);
  }

  async remove(id: string) {
    const item = this.find(id);
    this.items = this.items.filter((p) => p !== item);
  }

  async reorder(ids: string[]) {
    ids.forEach((id, i) => (this.find(id).sortOrder = i + 1));
    return this.list();
  }
}

const globalStore = globalThis as unknown as { __ccsPrioritiesMemory?: MemoryPriorityStore };

/** One shared copy for the whole running server, so changes survive between requests. */
export function memoryPriorityStore(): MemoryPriorityStore {
  return (globalStore.__ccsPrioritiesMemory ??= new MemoryPriorityStore());
}

/* ---------- Supabase ---------- */

export interface PriorityRow {
  id: string;
  sort_order: number;
  title: string;
  summary: string;
  facts: string[] | null;
  meaning: string;
  question: string;
  careful: string;
  updated_at: string;
}

/** Names every field passed on, so a column added to the table later never reaches the browser by accident. */
export const toPriority = (r: PriorityRow): Priority => ({
  id: r.id,
  sortOrder: r.sort_order,
  title: r.title,
  summary: r.summary,
  facts: Array.isArray(r.facts) ? r.facts.filter((f) => typeof f === "string") : [],
  meaning: r.meaning ?? "",
  question: r.question ?? "",
  careful: r.careful ?? "",
  updatedAt: r.updated_at,
});

const toRow = (p: PriorityInput) => ({ title: p.title, summary: p.summary, facts: p.facts, meaning: p.meaning, question: p.question, careful: p.careful });

const UNREACHABLE = "The priorities could not be reached. Try again in a minute.";
const TABLE = "executive_priorities";

export class SupabasePriorityStore implements PriorityStore {
  readonly source = "live" as const;

  constructor(
    private cfg: { url: string; key: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async rows<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.url}/rest/v1/${path}`, {
        method: init.method ?? "GET",
        headers: {
          apikey: this.cfg.key,
          Authorization: `Bearer ${this.cfg.key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (error) {
      console.error("Priorities request failed", path.split("?")[0], error);
      throw new PriorityError(502, UNREACHABLE);
    }
    if (!res.ok) {
      console.error("Priorities request refused", path.split("?")[0], res.status);
      throw new PriorityError(502, "The priorities could not be loaded. If the executive_priorities table has not been set up yet, see db/executive_priorities.sql.");
    }
    return (await res.json()) as T[];
  }

  async list() {
    const rows = await this.rows<PriorityRow>(`${TABLE}?select=*&order=sort_order.asc,updated_at.asc&limit=100`);
    return rows.map(toPriority);
  }

  async create(input: PriorityInput) {
    const existing = await this.rows<{ sort_order: number }>(`${TABLE}?select=sort_order&order=sort_order.desc&limit=100`);
    if (existing.length >= MAX_ITEMS) throw new PriorityError(400, FULL);
    const [row] = await this.rows<PriorityRow>(TABLE, { method: "POST", body: { ...toRow(input), sort_order: (existing[0]?.sort_order ?? 0) + 1 } });
    return toPriority(row);
  }

  async update(id: string, input: PriorityInput) {
    if (!isUuid(id)) throw new PriorityError(404, GONE);
    const [row] = await this.rows<PriorityRow>(`${TABLE}?id=eq.${id}`, { method: "PATCH", body: { ...toRow(input), updated_at: new Date().toISOString() } });
    if (!row) throw new PriorityError(404, GONE);
    return toPriority(row);
  }

  async remove(id: string) {
    if (!isUuid(id)) throw new PriorityError(404, GONE);
    const gone = await this.rows<{ id: string }>(`${TABLE}?id=eq.${id}&select=id`, { method: "DELETE" });
    if (gone.length === 0) throw new PriorityError(404, GONE);
  }

  async reorder(ids: string[]) {
    for (const [i, id] of ids.entries()) {
      if (!isUuid(id)) throw new PriorityError(404, GONE);
      const [row] = await this.rows<{ id: string }>(`${TABLE}?id=eq.${id}&select=id`, { method: "PATCH", body: { sort_order: i + 1 } });
      if (!row) throw new PriorityError(404, GONE);
    }
    return this.list();
  }
}
