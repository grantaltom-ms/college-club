"use client";

import { useCallback, useState, type FormEvent } from "react";
import { useDashboard } from "@/components/DataProvider";
import { useJson, type JsonState } from "@/components/useJson";
import { rowingOutlook, usageOutlook, waitlistOutlook } from "@/lib/executive";
import {
  LIMITS,
  LIVE_FIGURES,
  MAX_ITEMS,
  pageHeading,
  splitFigures,
  type LiveSources,
  type PrioritiesData,
  type Priority,
  type PriorityInput,
} from "@/lib/executive-items";
import type { ShellData } from "@/lib/shells";
import type { MembershipData } from "@/lib/types";

/** What a live-figure source looks like to the text: undefined while loading, null when it could not be read. */
function settled<T, R>(state: JsonState<T>, pick: (data: T) => R | null): R | null | undefined {
  if (state.status === "loading") return undefined;
  if (state.status === "error") return null;
  return pick(state.data);
}

/** Text with its live figures filled in. */
function Figured({ text, sources }: { text: string; sources: LiveSources }) {
  return (
    <>
      {splitFigures(text, sources).map((part, i) => {
        if ("text" in part) return <span key={i}>{part.text}</span>;
        if (!part.known) return <span key={i} className="exec-pending">[unknown figure: {part.figure}]</span>;
        if (part.value === undefined) return <span key={i} className="exec-pending">(loading)</span>;
        if (part.value === null) return <span key={i} className="exec-pending">(not available)</span>;
        return (
          <strong key={i} data-figure={part.figure}>
            {part.value}
          </strong>
        );
      })}
    </>
  );
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error ?? "That change could not be saved. Try again.";
  } catch {
    return "That change could not be saved. Check your connection and try again.";
  }
}

const EMPTY: PriorityInput = { title: "", summary: "", facts: [], meaning: "", question: "", careful: "" };

export function ExecutivePage() {
  const priorities = useJson<PrioritiesData>("/api/executive", "The priorities could not be loaded.");
  const membership = useJson<MembershipData>("/api/membership", "The membership figures could not be loaded.");
  const shells = useJson<ShellData>("/api/shells", "The shell figures could not be loaded.");
  const dashboard = useDashboard();

  const sources: LiveSources = {
    waitlist: settled(membership.state, (m) => waitlistOutlook(m.months)),
    rowing: settled(shells.state, (s) => rowingOutlook(s.outings, s.through)),
    usage: dashboard ? usageOutlook(dashboard.members) : undefined,
    visitsThrough: dashboard ? dashboard.dataThrough : undefined,
  };

  const state = priorities.state;
  if (state.status === "ready") return <Board data={state.data} sources={sources} />;
  return (
    <>
      <Intro heading="Things to watch." />
      {state.status === "loading" ? (
        <p className="status" role="status">
          Loading the priorities
        </p>
      ) : (
        <div className="status-error" role="alert">
          <p>{state.message}</p>
          <button type="button" className="link-button" onClick={priorities.retry}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}

function Intro({ heading }: { heading: string }) {
  return (
    <>
      <h1 className="page-title">{heading}</h1>
      <p className="page-sub">
        For the board and club leadership: where the club&apos;s data points for the year ahead. Bold figures are the dashboard&apos;s own
        and update with it. Survey and building figures come from the dated documents named under each one.
      </p>
    </>
  );
}

function Board({ data, sources }: { data: PrioritiesData; sources: LiveSources }) {
  const [items, setItems] = useState(data.items);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Reads the list again after a change, without leaving the page. */
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/executive", { cache: "no-store" });
      if (res.ok) setItems(((await res.json()) as PrioritiesData).items);
    } catch {
      // The change was saved; the list on screen catches up on the next visit.
    }
  }, []);

  const run = useCallback(
    async (action: () => Promise<string | null>) => {
      setBusy(true);
      setError(null);
      const problem = await action();
      setBusy(false);
      if (problem) setError(problem);
      else {
        setEditing(null);
        await reload();
      }
      return problem;
    },
    [reload],
  );

  const move = (index: number, by: number) => {
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    setItems(next);
    void run(() => send("/api/executive/order", "POST", { ids: next.map((p) => p.id) }));
  };

  const remove = (p: Priority) => {
    if (!window.confirm(`Remove "${p.title}" from the page? This cannot be undone.`)) return;
    void run(() => send(`/api/executive/items/${p.id}`, "DELETE"));
  };

  return (
    <>
      <Intro heading={pageHeading(items.length)} />
      {data.source === "sample" && <p className="sample-banner">Sample data: the figures are invented, not the club&apos;s.</p>}
      {items.length > 0 && (
        <ol className="exec-summary" aria-label="Each priority in one line">
          {items.map((p) => (
            <li key={p.id}>
              <a href={`#p-${p.id}`}>
                <Figured text={p.summary} sources={sources} />
              </a>
            </li>
          ))}
        </ol>
      )}
      {items.length === 0 && <p className="exec-footer">There are no priorities on the page yet.</p>}
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}

      {items.map((p, i) =>
        editing === p.id ? (
          <PriorityForm
            key={p.id}
            start={p}
            busy={busy}
            sources={sources}
            onCancel={() => setEditing(null)}
            onSave={(input) => run(() => send(`/api/executive/items/${p.id}`, "PUT", input))}
          />
        ) : (
          <section key={p.id} id={`p-${p.id}`} className="exec-priority" aria-labelledby={`h-${p.id}`} data-testid="priority">
            <p className="exec-number" aria-hidden="true">
              {i + 1}
            </p>
            <div>
              <h2 id={`h-${p.id}`} className="exec-title">
                <Figured text={p.title} sources={sources} />
              </h2>
              {p.facts.length > 0 && (
                <>
                  <h3 className="exec-label">What the data says</h3>
                  <ul className="exec-facts">
                    {p.facts.map((f, j) => (
                      <li key={j}>
                        <Figured text={f} sources={sources} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {p.meaning && (
                <>
                  <h3 className="exec-label">What it means</h3>
                  <p>
                    <Figured text={p.meaning} sources={sources} />
                  </p>
                </>
              )}
              {p.question && (
                <p className="exec-question">
                  <strong>Question for the board:</strong> <Figured text={p.question} sources={sources} />
                </p>
              )}
              {p.careful && (
                <p className="exec-careful">
                  <strong>Read with care:</strong> <Figured text={p.careful} sources={sources} />
                </p>
              )}
              {data.canEdit && (
                <div className="exec-tools" role="group" aria-label={`Change priority ${i + 1}`}>
                  <button type="button" className="exec-button" disabled={busy} onClick={() => setEditing(p.id)}>
                    Edit
                  </button>
                  <button type="button" className="exec-button" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    Move up
                  </button>
                  <button type="button" className="exec-button" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>
                    Move down
                  </button>
                  <button type="button" className="exec-button exec-danger" disabled={busy} onClick={() => remove(p)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
          </section>
        ),
      )}

      {data.canEdit &&
        (editing === "new" ? (
          <PriorityForm
            start={EMPTY}
            busy={busy}
            sources={sources}
            onCancel={() => setEditing(null)}
            onSave={(input) => run(() => send("/api/executive/items", "POST", input))}
          />
        ) : (
          <p className="exec-add">
            <button type="button" className="exec-button" disabled={busy || items.length >= MAX_ITEMS} onClick={() => setEditing("new")}>
              Add a priority
            </button>
            {items.length >= MAX_ITEMS && <span className="exec-pending"> The page holds up to {MAX_ITEMS}.</span>}
          </p>
        ))}

      <section className="exec-footer" aria-labelledby="exec-missing">
        <h2 id="exec-missing" className="exec-label">
          What these are missing
        </h2>
        <p>
          A board target. None of these has a number the board has agreed to aim for, so there is no way yet to say whether the club is
          on track. One target for each would turn this page into a scorecard.
        </p>
      </section>

      <EditAccess canEdit={data.canEdit} editingSetUp={data.editingSetUp} />
    </>
  );
}

function EditAccess({ canEdit, editingSetUp }: { canEdit: boolean; editingSetUp: boolean }) {
  const [wrong] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("wrong"));
  if (canEdit) {
    return (
      <form className="exec-access" method="post" action="/api/executive/lock">
        <p>You can edit this page on this device.</p>
        <button type="submit" className="exec-button">
          Stop editing on this device
        </button>
      </form>
    );
  }
  return (
    <form id="edit" className="exec-access" method="post" action="/api/executive/unlock">
      <h2 className="exec-label">For the executive team</h2>
      {editingSetUp ? (
        <>
          <label htmlFor="exec-password">Editing password</label>
          <div className="exec-access-row">
            <input id="exec-password" name="password" type="password" autoComplete="current-password" required minLength={8} />
            <button type="submit" className="exec-button">
              Unlock editing
            </button>
          </div>
          {wrong && (
            <p className="status-error" role="alert">
              That password was not right. Try again.
            </p>
          )}
        </>
      ) : (
        <p>Editing has not been set up yet: the site needs an editing password (DASHBOARD_EXECUTIVE_PASSWORD in its private settings).</p>
      )}
    </form>
  );
}

function PriorityForm({
  start,
  busy,
  sources,
  onSave,
  onCancel,
}: {
  start: PriorityInput;
  busy: boolean;
  sources: LiveSources;
  onSave: (input: PriorityInput) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ ...start, facts: start.facts.join("\n") });
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSave({ ...draft, facts: draft.facts.split("\n") });
  };
  const isNew = start.title === "";
  return (
    <form className="exec-form" onSubmit={submit} aria-label={isNew ? "New priority" : "Edit priority"}>
      <h2 className="exec-title">{isNew ? "New priority" : "Edit priority"}</h2>
      <label>
        Heading
        <input value={draft.title} onChange={set("title")} maxLength={LIMITS.title} required />
      </label>
      <label>
        One-line summary (shown in the list at the top)
        <input value={draft.summary} onChange={set("summary")} maxLength={LIMITS.summary} required />
      </label>
      <label>
        What the data says (one point per line)
        <textarea value={draft.facts} onChange={set("facts")} rows={6} />
      </label>
      <label>
        What it means
        <textarea value={draft.meaning} onChange={set("meaning")} rows={3} maxLength={LIMITS.meaning} />
      </label>
      <label>
        Question for the board
        <input value={draft.question} onChange={set("question")} maxLength={LIMITS.question} />
      </label>
      <label>
        Read with care
        <textarea value={draft.careful} onChange={set("careful")} rows={2} maxLength={LIMITS.careful} />
      </label>
      <details className="exec-codes">
        <summary>Live figures you can put in the text</summary>
        <p>Type a code with its double braces, for example {"{{waitlist_now}}"}. The page shows the current number in its place.</p>
        <div className="exec-codes-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Shows</th>
                <th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              {LIVE_FIGURES.map((f) => {
                const v = f.value(sources);
                return (
                  <tr key={f.code}>
                    <td>
                      <code>{`{{${f.code}}}`}</code>
                    </td>
                    <td>{f.what}</td>
                    <td>{v === undefined ? "(loading)" : (v ?? "—")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
      <div className="exec-tools">
        <button type="submit" className="exec-button" disabled={busy}>
          {isNew ? "Add to the page" : "Save"}
        </button>
        <button type="button" className="exec-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
