import { daysBetween, formatDay } from "./dates";

export const STATUSES = ["Not started", "In progress", "Waiting", "Done"] as const;
export type Status = (typeof STATUSES)[number];

/** Longest text each field may hold. The database enforces the same limits. */
export const LIMITS = { title: 200, group: 80, owner: 100, note: 4000 } as const;

/** An item is "due soon" from today up to this many days ahead. */
export const SOON_DAYS = 7;

export interface RoadmapItem {
  id: string;
  /** Null for a top-level item; the id of the item above for a subitem. */
  parentId: string | null;
  title: string;
  /** Subitems have no group of their own; they sit under their parent. */
  group: string | null;
  status: Status;
  /** YYYY-MM-DD, or null. */
  dueDate: string | null;
  owner: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface RoadmapNote {
  id: string;
  itemId: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface RoadmapData {
  /** "live" comes from Supabase; "sample" is an in-memory list for development and tests. */
  source: "live" | "sample";
  items: RoadmapItem[];
  notes: RoadmapNote[];
}

/* ---------- Checking what the browser sends ---------- */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = (error: string): Parsed<never> => ({ ok: false, error });

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** A real calendar day written YYYY-MM-DD (so 2026-02-30 is not accepted). */
export function isValidDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed text, with an empty string meaning "nothing". */
function optionalText(value: unknown, label: string, max: number): Parsed<string | null> {
  if (value === null || value === undefined) return ok(null);
  if (typeof value !== "string") return fail(`${label} must be text.`);
  const text = value.trim();
  if (text.length > max) return fail(`${label} can be up to ${max} characters. Shorten it and try again.`);
  return ok(text === "" ? null : text);
}

function parseTitle(value: unknown): Parsed<string> {
  const title = optionalText(value, "The title", LIMITS.title);
  if (!title.ok) return title;
  return title.value === null ? fail("Give the item a title.") : ok(title.value);
}

function parseStatus(value: unknown): Parsed<Status> {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value)
    ? ok(value as Status)
    : fail(`The status must be one of: ${STATUSES.join(", ")}.`);
}

function parseDue(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined || value === "") return ok(null);
  return isValidDay(value) ? ok(value) : fail("Use a real date, like 2026-11-06, or leave it empty.");
}

export interface ItemFields {
  title: string;
  group: string | null;
  status: Status;
  dueDate: string | null;
  owner: string | null;
}

export interface NewItem extends ItemFields {
  /** The top-level item this is a subitem of, or null. */
  parentId: string | null;
}

/** Everything needed to add an item. Fields left out get their defaults. */
export function parseNewItem(body: unknown): Parsed<NewItem> {
  if (!isObject(body)) return fail("Send the item as JSON.");
  const title = parseTitle(body.title);
  if (!title.ok) return title;
  const group = optionalText(body.group, "The group", LIMITS.group);
  if (!group.ok) return group;
  const owner = optionalText(body.owner, "The owner", LIMITS.owner);
  if (!owner.ok) return owner;
  const status = body.status === undefined ? ok<Status>("Not started") : parseStatus(body.status);
  if (!status.ok) return status;
  const dueDate = parseDue(body.dueDate);
  if (!dueDate.ok) return dueDate;
  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    if (!isUuid(body.parentId)) return fail("That parent item is not valid.");
    parentId = body.parentId;
  }
  return ok({ title: title.value, group: group.value, status: status.value, dueDate: dueDate.value, owner: owner.value, parentId });
}

export type ItemPatch = Partial<ItemFields>;

/** Only the fields that were sent. A date, owner or group sent as empty is cleared. */
export function parseItemPatch(body: unknown): Parsed<ItemPatch> {
  if (!isObject(body)) return fail("Send the changes as JSON.");
  const patch: ItemPatch = {};
  if ("title" in body) {
    const title = parseTitle(body.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }
  if ("group" in body) {
    const group = optionalText(body.group, "The group", LIMITS.group);
    if (!group.ok) return group;
    patch.group = group.value;
  }
  if ("owner" in body) {
    const owner = optionalText(body.owner, "The owner", LIMITS.owner);
    if (!owner.ok) return owner;
    patch.owner = owner.value;
  }
  if ("status" in body) {
    const status = parseStatus(body.status);
    if (!status.ok) return status;
    patch.status = status.value;
  }
  if ("dueDate" in body) {
    const due = parseDue(body.dueDate);
    if (!due.ok) return due;
    patch.dueDate = due.value;
  }
  return Object.keys(patch).length === 0 ? fail("There is nothing to change.") : ok(patch);
}

export function parseNote(body: unknown): Parsed<string> {
  if (!isObject(body)) return fail("Send the note as JSON.");
  if (body.body !== undefined && typeof body.body !== "string") return fail("The note must be text.");
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text === "") return fail("Write something in the note first.");
  if (text.length > LIMITS.note) return fail(`A note can be up to ${LIMITS.note} characters. Shorten it or split it in two.`);
  return ok(text);
}

/* ---------- Dates ---------- */

/** Today in the visitor's own time zone, as YYYY-MM-DD. Never hard-coded. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export type DueState = "overdue" | "soon" | "later" | "none" | "done";

/** Done items are never overdue. Dates are compared as whole days, so time zones cannot shift them. */
export function dueState(dueDate: string | null, status: Status, today: string): DueState {
  if (status === "Done") return "done";
  if (!dueDate) return "none";
  const days = daysBetween(today, dueDate);
  if (days < 0) return "overdue";
  return days <= SOON_DAYS ? "soon" : "later";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The words shown next to a date, so urgency never depends on color alone. */
export function dueText(dueDate: string | null, status: Status, today: string): { state: DueState; text: string } {
  const state = dueState(dueDate, status, today);
  const when = dueDate ? formatDay(dueDate, dueDate.slice(0, 4) !== today.slice(0, 4)) : "";
  const days = dueDate ? daysBetween(today, dueDate) : 0;
  switch (state) {
    case "none":
      return { state, text: "No due date" };
    case "done":
      return { state, text: dueDate ? `Done (was due ${when})` : "Done" };
    case "overdue":
      return { state, text: `Overdue by ${plural(-days, "day")} (${when})` };
    case "soon":
      return { state, text: days === 0 ? "Due today" : days === 1 ? `Due tomorrow (${when})` : `Due in ${days} days (${when})` };
    default:
      return { state, text: `Due ${when}` };
  }
}

/* ---------- Subitems ---------- */

export function subitemProgress(children: RoadmapItem[]): { done: number; total: number } {
  return { done: children.filter((c) => c.status === "Done").length, total: children.length };
}

/** "3 of 5 done", or nothing when there are no subitems. Finishing every subitem never changes the parent. */
export function progressText(children: RoadmapItem[]): string {
  const { done, total } = subitemProgress(children);
  return total === 0 ? "" : `${done} of ${total} done`;
}

/* ---------- Order, groups and filters ---------- */

/** By due date (undated last), then by the order items were added. */
export function compareItems(a: RoadmapItem, b: RoadmapItem): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title);
}

export type Filter = "all" | "open" | "soon" | "done";
export const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "soon", label: "Due soon" },
  { key: "done", label: "Done" },
];

/** "Due soon" includes anything already overdue, since that is more urgent, not less. */
export function matchesFilter(item: RoadmapItem, filter: Filter, today: string): boolean {
  if (filter === "all") return true;
  if (filter === "done") return item.status === "Done";
  if (filter === "open") return item.status !== "Done";
  const state = dueState(item.dueDate, item.status, today);
  return state === "overdue" || state === "soon";
}

export interface ItemNode {
  item: RoadmapItem;
  children: RoadmapItem[];
}

export interface Group {
  /** Null for items with no group; those are listed last. */
  name: string | null;
  nodes: ItemNode[];
}

/** Top-level items in groups (in the order the groups were created), with their subitems under them. */
export function buildGroups(items: RoadmapItem[]): Group[] {
  const children = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  }
  const groups = new Map<string, { name: string | null; first: number; nodes: ItemNode[] }>();
  for (const item of items.filter((i) => i.parentId === null)) {
    const key = item.group ?? "";
    const group = groups.get(key) ?? { name: item.group, first: item.sortOrder, nodes: [] };
    group.first = Math.min(group.first, item.sortOrder);
    group.nodes.push({ item, children: (children.get(item.id) ?? []).sort(compareItems) });
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort((a, b) => (a.name === null ? 1 : b.name === null ? -1 : a.first - b.first || a.name.localeCompare(b.name)))
    .map(({ name, nodes }) => ({ name, nodes: nodes.sort((a, b) => compareItems(a.item, b.item)) }));
}

/** Keeps an item when it matches, or when any of its subitems does; groups left empty disappear. */
export function filterGroups(groups: Group[], filter: Filter, today: string): Group[] {
  if (filter === "all") return groups;
  return groups
    .map((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => matchesFilter(n.item, filter, today) || n.children.some((c) => matchesFilter(c, filter, today))),
    }))
    .filter((g) => g.nodes.length > 0);
}

export interface Summary {
  open: number;
  overdue: number;
  soon: number;
  done: number;
}

/** Counts every item and subitem. */
export function summarize(items: RoadmapItem[], today: string): Summary {
  const s = { open: 0, overdue: 0, soon: 0, done: 0 };
  for (const item of items) {
    const state = dueState(item.dueDate, item.status, today);
    if (item.status === "Done") s.done += 1;
    else s.open += 1;
    if (state === "overdue") s.overdue += 1;
    if (state === "soon") s.soon += 1;
  }
  return s;
}
