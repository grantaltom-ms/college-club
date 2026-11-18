"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDay } from "@/lib/dates";
import { EMPTY_RULE, MEMBER_TYPES, RECENT_DAYS, type ListMemberType, type ListResult, type ListRule, type PoolInfo, type ResultPerson } from "@/lib/email-lists";
import type { SavedList } from "@/lib/email-lists-data";

type Status = { unlocked: true; connected: { claude: boolean; mailchimp: boolean }; lists: SavedList[]; listsError?: string };

interface Found {
  request: string;
  listName: string;
  notUnderstood: string[];
  rule: ListRule;
  words: string[];
  result: ListResult;
  info: PoolInfo;
}

interface Draft {
  subject: string;
  previewText: string;
  paragraphs: string[];
  signOff: string;
  editUrl: string;
}

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; data?: Partial<T> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error ?? "That did not work. Try again.", data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "The server could not be reached. Check your connection and try again." };
  }
}

const day = (d: string | null) => (d ? formatDay(d, true) : "—");
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/** The list builder: describe members, check who they are, save the group as a Mailchimp tag, and draft a campaign to it. */
export function EmailListsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/email-lists", { cache: "no-store" });
      const body = await res.json();
      if (!body.unlocked) {
        setLoadError("The list builder is locked on this device. Reload the page and type the password.");
        return;
      }
      setStatus(body as Status);
    } catch {
      setLoadError("The list builder could not be loaded. Check your connection and reload the page.");
    }
  }, []);
  useEffect(() => {
    // Loading the saved lists once when the panel opens; reload() sets state when the answer arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  if (loadError) return <p className="status-error" role="alert">{loadError}</p>;
  if (!status) return <p className="status" role="status">Loading the list builder</p>;
  return (
    <div className="lists-panel">
      {!status.connected.claude && (
        <p className="status-error" role="alert">
          Claude is not connected yet, so descriptions cannot be read. Add ANTHROPIC_API_KEY in Vercel, then redeploy. You can still set the filters by hand below.
        </p>
      )}
      {!status.connected.mailchimp && (
        <p className="status-error" role="alert">
          Mailchimp is not connected yet, so lists cannot be saved and drafts cannot be made. Add MAILCHIMP_API_KEY in Vercel, then redeploy.
        </p>
      )}
      <Finder onSaved={reload} />
      <SavedLists lists={status.lists} error={status.listsError} onChange={reload} />
    </div>
  );
}

function Finder({ onSaved }: { onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<null | "find" | "preview" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  // Filters set by hand before anything is found: works without Claude, and after a description could not be read.
  const [manual, setManual] = useState<PoolInfo | null>(null);

  async function startByHand() {
    setBusy("preview");
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/email-lists/preview", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error ?? "The filters could not be loaded. Try again.");
      else setManual(data.info as PoolInfo);
    } catch {
      setError("The server could not be reached. Check your connection and try again.");
    }
    setBusy(null);
  }

  async function find() {
    setBusy("find");
    setError(null);
    setSaved(null);
    const r = await post<{ reading: { rule: ListRule; listName: string; notUnderstood: string[] }; words: string[]; result: ListResult; info: PoolInfo }>(
      "/api/email-lists/find",
      { description },
    );
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      setFound(null);
      return;
    }
    const { reading, words, result, info } = r.data;
    setManual(null);
    setFound({ request: description, listName: reading.listName, notUnderstood: reading.notUnderstood, rule: reading.rule, words, result, info });
    setName(reading.listName);
  }

  async function preview(rule: ListRule) {
    if (!found && !manual) return;
    setBusy("preview");
    setError(null);
    const r = await post<{ words: string[]; result: ListResult; info: PoolInfo }>("/api/email-lists/preview", { rule });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const base = found ?? { request: "", listName: "", notUnderstood: [] };
    setFound({ ...base, rule, words: r.data.words, result: r.data.result, info: r.data.info });
    setManual(null);
  }

  async function save() {
    if (!found) return;
    setBusy("save");
    setError(null);
    const r = await post<{ list: SavedList }>("/api/email-lists/lists", { name, request: found.request, rule: found.rule });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved(`Saved. "${r.data.list.name}" is now a tag in Mailchimp called "${r.data.list.tagName}" with ${r.data.list.emails} ${r.data.list.emails === 1 ? "address" : "addresses"}. It refreshes every night. Draft an email to it below.`);
    setFound(null);
    setDescription("");
    onSaved();
  }

  return (
    <div className="lists-finder">
      <label htmlFor="lists-describe" className="lists-label">
        Describe the members you want
      </label>
      <textarea
        id="lists-describe"
        className="search lists-textarea"
        rows={3}
        maxLength={1000}
        placeholder="For example: members who joined in the last three months and said they are interested in rowing"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="lists-actions">
        <button type="button" className="link-button" disabled={busy !== null || description.trim().length < 3} onClick={find}>
          {busy === "find" ? "Finding members…" : "Find members"}
        </button>
        {!found && !manual && (
          <button type="button" className="link-button" disabled={busy !== null} onClick={startByHand}>
            Set the filters by hand instead
          </button>
        )}
      </div>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="lists-ok" role="status">
          {saved}
        </p>
      )}
      {manual && !found && (
        <div className="lists-found" aria-label="Filters set by hand">
          <RuleEditor rule={EMPTY_RULE} info={manual} busy={busy === "preview"} onApply={preview} open />
        </div>
      )}
      {found && (
        <div className="lists-found" aria-label="Members found">
          <h3 className="lists-h3">{found.request ? "How the description was read" : "The filters"}</h3>
          <ul className="lists-words" data-testid="lists-words">
            {found.words.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {found.notUnderstood.length > 0 && (
            <p className="lists-warn" role="note">
              Not used, because no filter covers it: {found.notUnderstood.join("; ")}.
            </p>
          )}
          <RuleEditor rule={found.rule} info={found.info} busy={busy === "preview"} onApply={preview} />
          <Result result={found.result} rule={found.rule} onToggleRecent={(on) => preview({ ...found.rule, leaveOutRecentlyEmailed: on })} busy={busy !== null} />
          <div className="lists-save">
            <label htmlFor="lists-name" className="lists-label">
              Name for this list
            </label>
            <input id="lists-name" className="search" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="link-button" disabled={busy !== null || name.trim().length < 2 || found.result.emails.length === 0} onClick={save}>
              {busy === "save" ? "Saving…" : "Save as a Mailchimp list"}
            </button>
            <p className="finance-lock-note">
              Saving makes a tag in Mailchimp and puts these {found.result.emails.length} addresses on it. Every night the filters are run again, so people who
              start to fit are added and people who stop fitting are taken off.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Result({ result, rule, onToggleRecent, busy }: { result: ListResult; rule: ListRule; onToggleRecent: (on: boolean) => void; busy: boolean }) {
  const recentCount = rule.leaveOutRecentlyEmailed ? result.leftOutRecent.length : result.recentAmongIncluded;
  return (
    <>
      <p className="lists-count" data-testid="lists-count">
        {result.matched} {result.matched === 1 ? "household matches" : "households match"}. {result.people.length} will get the email ({result.emails.length}{" "}
        {result.emails.length === 1 ? "address" : "addresses"}).
        {result.noEmail.length > 0 && ` ${result.noEmail.length} ${result.noEmail.length === 1 ? "has" : "have"} no subscribed email address in Mailchimp.`}
      </p>
      {recentCount > 0 && (
        <div className="lists-warn" role="note" data-testid="lists-recent">
          <p>
            {rule.leaveOutRecentlyEmailed
              ? `${recentCount} ${recentCount === 1 ? "household is" : "households are"} left out because they got a campaign in the last ${RECENT_DAYS} days.`
              : `${recentCount} of them got a campaign in the last ${RECENT_DAYS} days. The club's plan is one campaign a week at most.`}
          </p>
          <label className="lists-check">
            <input type="checkbox" checked={rule.leaveOutRecentlyEmailed} disabled={busy} onChange={(e) => onToggleRecent(e.target.checked)} /> Leave out anyone who got a
            campaign in the last {RECENT_DAYS} days
          </label>
        </div>
      )}
      {result.people.length > 0 && <PeopleTable people={result.people} label="Who will get the email" />}
      {result.leftOutRecent.length > 0 && (
        <details className="lists-more">
          <summary>Left out: emailed in the last {RECENT_DAYS} days ({result.leftOutRecent.length})</summary>
          <PeopleTable people={result.leftOutRecent} label="Left out because they were emailed recently" />
        </details>
      )}
      {result.noEmail.length > 0 && (
        <details className="lists-more">
          <summary>No email address in Mailchimp ({result.noEmail.length})</summary>
          <PeopleTable people={result.noEmail} label="Matching households with no email address" />
        </details>
      )}
    </>
  );
}

function PeopleTable({ people, label }: { people: ResultPerson[]; label: string }) {
  return (
    <div className="table-scroll">
      <table className="data-table lists-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Household</th>
            <th scope="col">Type</th>
            <th scope="col">Joined</th>
            <th scope="col" className="right">Visits a month</th>
            <th scope="col" className="right">Times rowed</th>
            <th scope="col">Interests</th>
            <th scope="col">Emailed in last {RECENT_DAYS} days</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={`${p.name}|${p.emails.join(",")}`}>
              <td>
                {p.name}
                {p.emails.length > 0 && <span className="lists-emails">{p.emails.join(", ")}</span>}
              </td>
              <td>{p.memberType || "—"}</td>
              <td>{p.joined === "2019-10-18" ? "2019 or earlier" : day(p.joined)}</td>
              <td className="right num">{p.visitsPerMonth}</td>
              <td className="right num">{p.shellOutings}</td>
              <td>{p.interests.join(", ") || "—"}</td>
              <td>{p.recent.length ? p.recent.map((r) => `${r.title} (${day(r.sentOn)})`).join("; ") : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function RuleEditor({ rule, info, busy, onApply, open = false }: { rule: ListRule; info: PoolInfo; busy: boolean; onApply: (rule: ListRule) => void; open?: boolean }) {
  const [draft, setDraft] = useState<ListRule>(rule);
  const [lastRule, setLastRule] = useState(rule);
  // A new reading from Claude replaces what was typed here (the React way to reset state from a prop).
  if (rule !== lastRule) {
    setLastRule(rule);
    setDraft(rule);
  }
  const set = (patch: Partial<ListRule>) => setDraft({ ...draft, ...patch });
  const numberBox = (id: keyof ListRule, label: string, step = "1") => (
    <label className="lists-field">
      <span>{label}</span>
      <input
        className="search"
        type="number"
        min="0"
        step={step}
        value={(draft[id] as number | null) ?? ""}
        onChange={(e) => set({ [id]: numOrNull(e.target.value) } as Partial<ListRule>)}
      />
    </label>
  );
  const interests = [...new Set([...info.interests, ...draft.interestsAny])];
  return (
    <details className="lists-more" open={open || undefined}>
      <summary>Change the filters by hand</summary>
      <div className="lists-editor">
        {numberBox("joinedWithinMonths", "Joined within the last (months)")}
        <label className="lists-field">
          <span>Joined on or after</span>
          <input className="search" type="date" value={draft.joinedOnOrAfter ?? ""} onChange={(e) => set({ joinedOnOrAfter: e.target.value || null })} />
        </label>
        <label className="lists-field">
          <span>Joined on or before</span>
          <input className="search" type="date" value={draft.joinedOnOrBefore ?? ""} onChange={(e) => set({ joinedOnOrBefore: e.target.value || null })} />
        </label>
        <fieldset className="lists-field">
          <legend>Membership type (none ticked means any)</legend>
          {MEMBER_TYPES.map((t) => (
            <label key={t} className="lists-check">
              <input
                type="checkbox"
                checked={draft.memberTypes.includes(t)}
                onChange={(e) => set({ memberTypes: e.target.checked ? [...draft.memberTypes, t] : draft.memberTypes.filter((x: ListMemberType) => x !== t) })}
              />{" "}
              {t}
            </label>
          ))}
        </fieldset>
        <fieldset className="lists-field">
          <legend>Interested in any of (none ticked means any)</legend>
          {interests.length === 0 && <p className="finance-lock-note">No interests are loaded yet.</p>}
          {interests.map((t) => (
            <label key={t} className="lists-check">
              <input
                type="checkbox"
                checked={draft.interestsAny.includes(t)}
                onChange={(e) => set({ interestsAny: e.target.checked ? [...draft.interestsAny, t] : draft.interestsAny.filter((x) => x !== t) })}
              />{" "}
              {t}
            </label>
          ))}
        </fieldset>
        {numberBox("minVisitsPerMonth", "At least this many visits a month", "0.5")}
        {numberBox("maxVisitsPerMonth", "At most this many visits a month", "0.5")}
        {numberBox("noVisitInDays", "Has not come in for at least (days)")}
        {numberBox("minShellOutings", "Rowed at least (times)")}
        {numberBox("maxShellOutings", "Rowed at most (times)")}
        <p className="finance-lock-note">
          Visits are counted through {day(info.visitsThrough)}.{" "}
          {info.rowing ? `Rowing is counted ${day(info.rowing.from)} to ${day(info.rowing.to)}.` : "No rowing figures are loaded yet."}{" "}
          {info.withApplicationAnswers} households have application answers loaded.
        </p>
        <div className="lists-actions">
          <button type="button" className="link-button" disabled={busy} onClick={() => onApply(draft)}>
            {busy ? "Showing…" : "Show members for these filters"}
          </button>
          <button type="button" className="link-button" disabled={busy} onClick={() => setDraft({ ...EMPTY_RULE, leaveOutRecentlyEmailed: draft.leaveOutRecentlyEmailed })}>
            Clear the filters
          </button>
        </div>
      </div>
    </details>
  );
}

function SavedLists({ lists, error, onChange }: { lists: SavedList[]; error?: string; onChange: () => void }) {
  return (
    <div className="lists-saved">
      <h3 className="lists-h3">Saved lists</h3>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      {!error && lists.length === 0 && <p className="finance-lock-note">No lists saved yet. Find some members above and save them.</p>}
      {lists.map((l) => (
        <SavedListCard key={l.id} list={l} onChange={onChange} />
      ))}
    </div>
  );
}

function SavedListCard({ list, onChange }: { list: SavedList; onChange: () => void }) {
  const [busy, setBusy] = useState<null | "refresh" | "draft">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState("");
  const [draft, setDraft] = useState<(Draft & { recentAmongIncluded: number; emails: number }) | null>(null);

  async function refresh() {
    setBusy("refresh");
    setError(null);
    const r = await post<{ list: SavedList; added: number; removed: number }>(`/api/email-lists/lists/${list.id}/refresh`, {});
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setNote(`Refreshed: ${r.data.added} added, ${r.data.removed} taken off.`);
    onChange();
  }

  async function makeDraft() {
    setBusy("draft");
    setError(null);
    setDraft(null);
    const r = await post<{ draft: Draft; recentAmongIncluded: number; emails: number }>(`/api/email-lists/lists/${list.id}/draft`, { request: ask });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDraft({ ...r.data.draft, recentAmongIncluded: r.data.recentAmongIncluded, emails: r.data.emails });
    onChange();
  }

  return (
    <article className="lists-saved-item" aria-label={`Saved list: ${list.name}`}>
      <h4 className="lists-h4">{list.name}</h4>
      <p className="finance-lock-note">
        {list.households} {list.households === 1 ? "household" : "households"}, {list.emails} {list.emails === 1 ? "address" : "addresses"}. Mailchimp tag “{list.tagName}”. Last
        refreshed {when(list.lastSyncedAt)}.{list.request ? ` Asked for: “${list.request}”.` : ""}
      </p>
      {list.lastDraftUrl && (
        <p className="finance-lock-note">
          Last draft made {when(list.lastDraftAt)}:{" "}
          <a href={list.lastDraftUrl} target="_blank" rel="noreferrer">
            open it in Mailchimp
          </a>
          .
        </p>
      )}
      <div className="lists-actions">
        <button type="button" className="link-button" disabled={busy !== null} onClick={refresh}>
          {busy === "refresh" ? "Refreshing…" : "Refresh now"}
        </button>
      </div>
      <label htmlFor={`draft-${list.id}`} className="lists-label">
        What should the email say?
      </label>
      <textarea
        id={`draft-${list.id}`}
        className="search lists-textarea"
        rows={3}
        maxLength={3000}
        placeholder="For example: we are putting together a member-organized erg workout class that meets once or twice a week. Ask who is interested."
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
      />
      <div className="lists-actions">
        <button type="button" className="link-button" disabled={busy !== null || ask.trim().length < 10} onClick={makeDraft}>
          {busy === "draft" ? "Writing the draft…" : "Draft the email in Mailchimp"}
        </button>
      </div>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      {note && !error && (
        <p className="lists-ok" role="status">
          {note}
        </p>
      )}
      {draft && (
        <div className="lists-draft" aria-label="Draft email">
          <p className="lists-ok" role="status">
            The draft is in Mailchimp, aimed at {draft.emails} {draft.emails === 1 ? "address" : "addresses"}. Nothing has been sent.{" "}
            <a href={draft.editUrl} target="_blank" rel="noreferrer">
              Open the draft in Mailchimp
            </a>{" "}
            to check it, fill in anything in [square brackets], and send it.
          </p>
          {draft.recentAmongIncluded > 0 && (
            <p className="lists-warn" role="note">
              {draft.recentAmongIncluded} of these households got a campaign in the last {RECENT_DAYS} days.
            </p>
          )}
          <p>
            <strong>Subject:</strong> {draft.subject}
          </p>
          <p>
            <strong>Preview line:</strong> {draft.previewText}
          </p>
          <div className="lists-draft-body">
            <p>Hi [first name],</p>
            {draft.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <p>
              {draft.signOff}
              <br />
              College Club Seattle
            </p>
          </div>
        </div>
      )}
    </article>
  );
}
