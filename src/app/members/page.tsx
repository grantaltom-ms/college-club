"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDay } from "@/lib/dates";
import {
  BAND_COLORS,
  BAND_LABELS,
  PRESETS,
  fmtInt,
  filterMembers,
  membersToCsv,
  paginate,
  presetCounts,
  sortMembers,
  type Preset,
  type SortDir,
  type SortKey,
} from "@/lib/stats";
import type { DashboardData } from "@/lib/types";

const PAGE_SIZE = 25;

type Gate =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DashboardData };

async function fetchMembers(): Promise<Gate> {
  try {
    const res = await fetch("/api/members", { cache: "no-store" });
    if (res.status === 401) return { status: "signed-out" };
    const body = await res.json();
    if (!res.ok) return { status: "error", message: body?.error ?? "The members could not be loaded." };
    return { status: "ready", data: body as DashboardData };
  } catch {
    return { status: "error", message: "The members could not be loaded. Check your connection and try again." };
  }
}

export default function MembersPage() {
  const [gate, setGate] = useState<Gate>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchMembers().then((next) => {
      if (!cancelled) setGate(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    await fetch("/api/members/logout", { method: "POST" });
    setGate({ status: "signed-out" });
  }

  return (
    <>
      <h1 className="page-title">Members.</h1>
      {gate.status === "loading" && (
        <p className="status" role="status">
          Loading member data
        </p>
      )}
      {gate.status === "error" && (
        <div className="status-error" role="alert">
          <p>{gate.message}</p>
          <button type="button" className="link-button" onClick={() => fetchMembers().then(setGate)}>
            Try again
          </button>
        </div>
      )}
      {gate.status === "signed-out" && <SignIn onSignedIn={() => fetchMembers().then(setGate)} />}
      {gate.status === "ready" && (
        <>
          <p className="page-sub">
            <button type="button" className="link-button" onClick={signOut}>
              Sign out
            </button>
          </p>
          <Members data={gate.data} />
        </>
      )}
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/members/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        onSignedIn();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Could not sign in. Try again.");
    } catch {
      setError("Could not sign in. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card signin" onSubmit={submit}>
      <h2 className="card-title">Member names are private.</h2>
      <p className="card-sub">Enter the password to see the list. The rest of the dashboard is open.</p>
      <label htmlFor="members-password">Password</label>
      <input
        id="members-password"
        className="search"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="chip" disabled={busy}>
        {busy ? "Checking" : "Show members"}
      </button>
    </form>
  );
}

function Members({ data }: { data: DashboardData }) {
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);

  const counts = useMemo(() => presetCounts(data.members, data.dataThrough), [data]);
  const filtered = useMemo(
    () => sortMembers(filterMembers(data.members, { query, preset, dataThrough: data.dataThrough }), sort.key, sort.dir),
    [data, query, preset, sort],
  );
  const view = paginate(filtered, page, PAGE_SIZE);
  const from = filtered.length === 0 ? 0 : (view.page - 1) * PAGE_SIZE + 1;
  const to = (view.page - 1) * PAGE_SIZE + view.rows.length;
  const activePreset = PRESETS.find((p) => p.id === preset)!;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  }

  function download() {
    const blob = new Blob([membersToCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ccs-members-${preset}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const header = (key: SortKey, label: string, extra = "") => (
    <th scope="col" className={extra} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-button" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <>
      <p className="page-sub">
        Pick a group to build an outreach list, then download it. Counts run through {formatDay(data.dataThrough, true)}.
      </p>
      {data.source === "sample" && (
        <p className="sample-banner" role="note">
          Sample data. These are made-up members for testing, not the real club.
        </p>
      )}

      <div className="stack">
        <div className="filters">
          <div>
            <label htmlFor="member-search" className="sr-only">
              Search by name
            </label>
            <input
              id="member-search"
              className="search"
              type="search"
              placeholder="Search by name"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="chips" role="group" aria-label="Member groups">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                aria-pressed={preset === p.id}
                title={p.hint}
                onClick={() => {
                  setPreset(p.id);
                  setPage(1);
                }}
              >
                {p.label}
                <span className="count num">{fmtInt(counts[p.id])}</span>
              </button>
            ))}
          </div>
          <p className="muted" aria-live="polite">
            {activePreset.hint}.
          </p>
        </div>

        <section aria-label="Member list">
          <div className="results-bar">
            <p className="num" role="status">
              {filtered.length === 0
                ? "No members match"
                : `Showing ${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(filtered.length)} members`}
            </p>
            <button type="button" className="link-button" onClick={download} disabled={filtered.length === 0}>
              Download list (CSV)
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="callout">
              <p>No members match these filters. Clear the search or choose another group.</p>
            </div>
          ) : (
            <div className="members-scroll card" style={{ padding: 0 }}>
              <table className="data-table num" aria-label="Members">
                <thead>
                  <tr>
                    {header("name", "Name")}
                    {header("band", "Visits")}
                    <th scope="col" className="right">
                      Per month
                    </th>
                    {header("lastVisit", "Last visit")}
                    {header("joined", "Joined", "hide-small")}
                    <th scope="col" className="hide-small">
                      Door fob
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((m) => (
                    <tr key={m.name}>
                      <td>{m.name}</td>
                      <td>
                        <span className="band-dot" style={{ background: BAND_COLORS[m.band] }} aria-hidden="true" />
                        {BAND_LABELS[m.band]}
                      </td>
                      <td className="right">{m.visitsPerMonth.toFixed(1)}</td>
                      <td>{formatDay(m.lastVisit)}</td>
                      <td className="hide-small">{formatDay(m.joined, true)}</td>
                      <td className="hide-small">{m.ownFob ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view.pages > 1 && (
            <nav className="pager num" aria-label="Pages">
              <button type="button" className="link-button" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
                Previous
              </button>
              <span>
                Page {view.page} of {view.pages}
              </span>
              <button
                type="button"
                className="link-button"
                disabled={view.page >= view.pages}
                onClick={() => setPage(view.page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      </div>
    </>
  );
}
