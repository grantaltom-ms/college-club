"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  FILTERS,
  LIMITS,
  STATUSES,
  buildGroups,
  dueText,
  filterGroups,
  progressText,
  summarize,
  todayLocal,
  type Filter,
  type RoadmapData,
  type RoadmapItem,
  type RoadmapNote,
  type Status,
} from "@/lib/roadmap";

/* ---------- Talking to the server ---------- */

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api(method: string, url: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? "Something went wrong. Try again.");
  return payload;
}

type Gate =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: RoadmapData };

async function fetchRoadmap(): Promise<Gate> {
  try {
    return { status: "ready", data: (await api("GET", "/api/roadmap")) as RoadmapData };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The goals could not be loaded." };
  }
}

/** Runs a change, then reloads the list. Returns false (and shows a plain sentence) if it did not work. */
type Act = (change: () => Promise<unknown>) => Promise<boolean>;

/* ---------- The page ---------- */

export default function GoalsPage() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRoadmap().then((next) => {
      if (!cancelled) setGate(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Fetches the latest list. Throws (so the caller can show the problem) if it cannot, keeping what is on screen. */
  const reload = useCallback(async () => {
    const next = await fetchRoadmap();
    if (next.status === "ready") setGate(next);
    else throw new ApiError(0, next.status === "error" ? next.message : "The goals could not be loaded.");
  }, []);

  return (
    <>
      <h1 className="page-title goal-page-title">Goals and Action Items for Tech and Communications</h1>
      {gate.status === "loading" && (
        <p className="status" role="status">
          Loading the goals
        </p>
      )}
      {gate.status === "error" && (
        <div className="status-error" role="alert">
          <p>{gate.message}</p>
          <button type="button" className="link-button" onClick={() => fetchRoadmap().then(setGate)}>
            Try again
          </button>
        </div>
      )}
      {gate.status === "ready" && (
        <>
          <p className="page-sub">
            Planning for technology and member communications, from the October 2026 meeting with Caitlin Sogn. Everything here can be
            changed on this page.
          </p>
          {gate.data.source === "sample" && (
            <p className="sample-banner" role="note">
              Sample list. Changes here are only kept in memory for testing, not saved.
            </p>
          )}
          <Roadmap data={gate.data} reload={reload} />
        </>
      )}
    </>
  );
}

function Roadmap({ data, reload }: { data: RoadmapData; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  // Today comes from the visitor's own clock every time, never a fixed date.
  const today = todayLocal();

  const act: Act = useCallback(
    async (change) => {
      setError(null);
      try {
        await change();
        await reload();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
        return false;
      }
    },
    [reload],
  );

  const groups = useMemo(() => buildGroups(data.items), [data.items]);
  const shown = filterGroups(groups, filter, today);
  const notesByItem = useMemo(() => {
    const map = new Map<string, RoadmapNote[]>();
    for (const note of data.notes) map.set(note.itemId, [...(map.get(note.itemId) ?? []), note]);
    return map;
  }, [data.notes]);
  const groupNames = groups.flatMap((g) => (g.name ? [g.name] : []));
  const summary = summarize(data.items, today);

  return (
    <div className="stack">
      <p className="goal-summary" aria-live="polite">
        {summary.open} open · {summary.overdue} overdue · {summary.soon} due in the next 7 days · {summary.done} done
      </p>

      {error && (
        <div className="status-error" role="alert">
          <p>{error}</p>
          <button type="button" className="link-button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <AddItemForm groupNames={groupNames} act={act} />

      <div className="chips" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="status" role="status">
          {data.items.length === 0 ? "No items yet. Add the first one above." : "Nothing matches this filter."}
        </p>
      )}

      {shown.map((group) => {
        const openCount = group.nodes.filter((n) => n.item.status !== "Done").length;
        return (
          <details className="goal-group card" key={group.name ?? "(none)"} open>
            <summary>
              <span className="goal-group-name">{group.name ?? "No group"}</span>
              <span className="goal-group-count">
                {openCount} open of {group.nodes.length}
              </span>
            </summary>
            <ul className="goal-list">
              {group.nodes.map(({ item, children }) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  subitems={children}
                  notesByItem={notesByItem}
                  today={today}
                  groupNames={groupNames}
                  act={act}
                  level={1}
                />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

/* ---------- Adding ---------- */

function AddItemForm({ groupNames, act }: { groupNames: string[]; act: Act }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [group, setGroup] = useState("");
  const [status, setStatus] = useState<Status>("Not started");
  const [dueDate, setDueDate] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const done = await act(() => api("POST", "/api/roadmap/items", { title, group, status, dueDate, owner }));
    setBusy(false);
    if (done) {
      setTitle("");
      setDueDate("");
      setOwner("");
      setStatus("Not started");
    }
  }

  return (
    <form className="card goal-add" onSubmit={submit} aria-label="Add an item">
      <h2 className="card-title">Add an item</h2>
      <div className="goal-fields">
        <div className="goal-field goal-field-wide">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} className="search" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="goal-field goal-field-group">
          <label htmlFor={`${id}-group`}>Group</label>
          <input id={`${id}-group`} className="search" list={`${id}-groups`} value={group} maxLength={LIMITS.group} onChange={(e) => setGroup(e.target.value)} />
          <datalist id={`${id}-groups`}>
            {groupNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select id={`${id}-status`} className="search" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-due`}>Due date (optional)</label>
          <input id={`${id}-due`} className="search" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-owner`}>Owner (optional)</label>
          <input id={`${id}-owner`} className="search" value={owner} maxLength={LIMITS.owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="chip goal-submit" disabled={busy}>
        {busy ? "Adding" : "Add item"}
      </button>
    </form>
  );
}

function AddSubitemForm({ parent, act }: { parent: RoadmapItem; act: Act }) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("Not started");
  const [dueDate, setDueDate] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const done = await act(() => api("POST", "/api/roadmap/items", { parentId: parent.id, title, status, dueDate, owner }));
    setBusy(false);
    if (done) {
      setTitle("");
      setDueDate("");
      setOwner("");
      setStatus("Not started");
    }
  }

  return (
    <form className="goal-subform" onSubmit={submit} aria-label={`Add subitem to ${parent.title}`}>
      <div className="goal-fields">
        <div className="goal-field goal-field-wide">
          <label htmlFor={`${id}-title`}>Subitem title</label>
          <input id={`${id}-title`} className="search" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select id={`${id}-status`} className="search" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-due`}>Due date (optional)</label>
          <input id={`${id}-due`} className="search" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-owner`}>Owner (optional)</label>
          <input id={`${id}-owner`} className="search" value={owner} maxLength={LIMITS.owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="chip goal-submit" disabled={busy}>
        {busy ? "Adding" : "Add subitem"}
      </button>
    </form>
  );
}

/* ---------- One item (or subitem) ---------- */

interface CardProps {
  item: RoadmapItem;
  subitems: RoadmapItem[];
  notesByItem: Map<string, RoadmapNote[]>;
  today: string;
  groupNames: string[];
  act: Act;
  level: 1 | 2;
}

function ItemCard({ item, subitems, notesByItem, today, groupNames, act, level }: CardProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const due = dueText(item.dueDate, item.status, today);
  const progress = progressText(subitems);
  const notes = notesByItem.get(item.id) ?? [];
  const what = level === 1 ? "item" : "subitem";
  const doomedNotes = notes.length + subitems.reduce((sum, s) => sum + (notesByItem.get(s.id)?.length ?? 0), 0);

  return (
    <li className={`goal-item goal-level-${level}`} aria-label={item.title} data-due={due.state}>
      <div className="goal-row">
        <button type="button" className="goal-toggle" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(!open)}>
          <span className="goal-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="goal-name">{item.title}</span>
        </button>
        <select
          className="goal-status"
          aria-label={`Status of ${item.title}`}
          value={item.status}
          onChange={(e) => act(() => api("PATCH", `/api/roadmap/items/${item.id}`, { status: e.target.value }))}
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className={`goal-due goal-due-${due.state}`}>{due.text}</span>
        {item.owner && <span className="goal-owner">Owner: {item.owner}</span>}
        {progress && <span className="goal-progress">{progress}</span>}
      </div>

      {open && (
        <div className="goal-panel" id={`${id}-panel`}>
          <EditForm item={item} level={level} groupNames={groupNames} act={act} />
          <Notes item={item} notes={notes} act={act} />

          {level === 1 && (
            <section className="goal-subitems" aria-label={`Subitems of ${item.title}`}>
              <h3>Subitems{progress ? ` (${progress})` : ""}</h3>
              {subitems.length > 0 && (
                <ul className="goal-list">
                  {subitems.map((sub) => (
                    <ItemCard key={sub.id} item={sub} subitems={[]} notesByItem={notesByItem} today={today} groupNames={groupNames} act={act} level={2} />
                  ))}
                </ul>
              )}
              <AddSubitemForm parent={item} act={act} />
            </section>
          )}

          {confirming ? (
            <div className="status-error goal-confirm" role="group" aria-label={`Confirm deleting ${item.title}`}>
              <p>
                Delete “{item.title}”?
                {level === 1 && subitems.length > 0 ? ` This also deletes its ${subitems.length} subitem${subitems.length === 1 ? "" : "s"}.` : ""}
                {doomedNotes > 0 ? ` All ${doomedNotes} note${doomedNotes === 1 ? "" : "s"} on it go too.` : ""} This cannot be undone.
              </p>
              <button type="button" className="link-button" onClick={() => act(() => api("DELETE", `/api/roadmap/items/${item.id}`))}>
                Yes, delete {what}
              </button>{" "}
              <button type="button" className="link-button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="link-button goal-delete" onClick={() => setConfirming(true)}>
              Delete {what}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function EditForm({ item, level, groupNames, act }: { item: RoadmapItem; level: 1 | 2; groupNames: string[]; act: Act }) {
  const id = useId();
  const [title, setTitle] = useState(item.title);
  const [group, setGroup] = useState(item.group ?? "");
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [owner, setOwner] = useState(item.owner ?? "");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await act(() =>
      api("PATCH", `/api/roadmap/items/${item.id}`, {
        title,
        dueDate,
        owner,
        ...(level === 1 ? { group } : {}),
      }),
    );
    setBusy(false);
  }

  return (
    <form className="goal-edit" onSubmit={save} aria-label={`Edit ${item.title}`}>
      <div className="goal-fields">
        <div className="goal-field goal-field-wide">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} className="search" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        {level === 1 && (
          <div className="goal-field goal-field-group">
            <label htmlFor={`${id}-group`}>Group</label>
            <input id={`${id}-group`} className="search" list={`${id}-groups`} value={group} maxLength={LIMITS.group} onChange={(e) => setGroup(e.target.value)} />
            <datalist id={`${id}-groups`}>
              {groupNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        )}
        <div className="goal-field">
          <label htmlFor={`${id}-due`}>Due date</label>
          <span className="goal-date">
            <input id={`${id}-due`} className="search" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <button type="button" className="link-button" onClick={() => setDueDate("")} disabled={dueDate === ""}>
              Clear date
            </button>
          </span>
        </div>
        <div className="goal-field">
          <label htmlFor={`${id}-owner`}>Owner</label>
          <input id={`${id}-owner`} className="search" value={owner} maxLength={LIMITS.owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="chip goal-submit" disabled={busy}>
        {busy ? "Saving" : "Save changes"}
      </button>
    </form>
  );
}

const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Notes({ item, notes, act }: { item: RoadmapItem; notes: RoadmapNote[]; act: Act }) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const done = await act(() => api("POST", `/api/roadmap/items/${item.id}/notes`, { body: text }));
    setBusy(false);
    if (done) setText("");
  }

  return (
    <section className="goal-notes" aria-label={`Notes for ${item.title}`}>
      <h3>Notes</h3>
      <form onSubmit={add}>
        <label htmlFor={`${id}-note`}>New note</label>
        <textarea id={`${id}-note`} className="search goal-textarea" rows={3} value={text} maxLength={LIMITS.note} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="chip goal-submit" disabled={busy || text.trim() === ""}>
          {busy ? "Adding" : "Add note"}
        </button>
      </form>
      {notes.length === 0 ? (
        <p className="muted">No notes yet.</p>
      ) : (
        <ul className="goal-note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <time dateTime={note.createdAt}>{stamp(note.createdAt)}</time>
              <p className="goal-note-body">{note.body}</p>
              <button type="button" className="link-button" aria-label={`Delete the note from ${stamp(note.createdAt)}`} onClick={() => act(() => api("DELETE", `/api/roadmap/notes/${note.id}`))}>
                Delete note
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
