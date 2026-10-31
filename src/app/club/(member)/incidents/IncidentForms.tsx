"use client";

import { useRef, useState, useTransition } from "react";
import type { BoatPeopleSearch } from "@/club/engine/boat-access";
import { ActionMessage } from "../admin/ActionMessage";
import { useStaffAction } from "../admin/useStaffAction";
import { addIncidentNoteAction, fileIncidentAction, searchIncidentPeople } from "./actions";

interface Row {
  key: number;
  /** Set for a member picked from the list; empty for a name typed in. */
  memberId: string;
  name: string;
}

interface Limits {
  what: number;
  location: number;
  conditions: number;
  firstAid: number;
  emergency: number;
  personName: number;
  people: number;
  boats: number;
}

const YesNo = ({ name, value, onChange, label }: { name: string; value: string; onChange: (v: string) => void; label: string }) => (
  <fieldset>
    <legend>{label}</legend>
    <p>
      <label className="club-check">
        <input type="radio" name={name} value="yes" checked={value === "yes"} onChange={() => onChange("yes")} required /> Yes
      </label>{" "}
      <label className="club-check">
        <input type="radio" name={name} value="no" checked={value === "no"} onChange={() => onChange("no")} required /> No
      </label>
    </p>
  </fieldset>
);

/**
 * The "Report an incident" form, for staff and coaches. A short form: what happened, when and where, who was involved and who was
 * hurt, first aid, emergency services, and the water and weather. Club staff add the cause and what will change when they review it,
 * so the person on the scene does not have to guess at those. Nothing here is sent to anyone.
 */
export function FileIncidentForm({ boats, limits, today }: { boats: { id: string; name: string }[]; limits: Limits; today: string }) {
  const { state, pending, run } = useStaffAction(fileIncidentAction);
  const [rows, setRows] = useState<Row[]>([]);
  const nextKey = useRef(1);
  const [boatSlots, setBoatSlots] = useState(1);
  const [water, setWater] = useState("");
  const [aid, setAid] = useState("");
  const [call, setCall] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<BoatPeopleSearch | null>(null);
  const [typed, setTyped] = useState("");
  const [, startSearch] = useTransition();
  const latest = useRef(0);

  const search = (text: string, shown: Row[] = rows) => {
    setQuery(text);
    const mine = ++latest.current;
    if (text.trim().length < 3) {
      setFound(null);
      return;
    }
    const named = shown.filter((r) => r.memberId !== "").map((r) => r.memberId);
    startSearch(async () => {
      const result = await searchIncidentPeople(text, named);
      // An answer to an older search, typed over since, is dropped.
      if (mine === latest.current) setFound(result);
    });
  };
  const addRow = (memberId: string, name: string) => {
    setRows((rs) => [...rs, { key: nextKey.current++, memberId, name }]);
    setQuery("");
    setFound(null);
    setTyped("");
    latest.current++;
  };
  // A name taken off the report is offered again, so the list under the search box is searched afresh.
  const removeRow = (key: number) => {
    const rest = rows.filter((x) => x.key !== key);
    setRows(rest);
    if (query.trim().length >= 3) search(query, rest);
  };
  const full = rows.length >= limits.people;

  return (
    <form
      className="club-form"
      data-testid="incident-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => {
          form.reset();
          setRows([]);
          setBoatSlots(1);
          setWater("");
          setAid("");
          setCall("");
          setQuery("");
          setFound(null);
          setTyped("");
        });
      }}
    >
      <p>
        <label htmlFor="incident-day">Day it happened</label>
        <input id="incident-day" name="day" type="date" defaultValue={today} max={today} required />{" "}
        <label htmlFor="incident-time">Time</label>
        <input id="incident-time" name="time" type="time" required />
      </p>
      <p>
        <label htmlFor="incident-what">What happened?</label>
        <textarea id="incident-what" name="what" rows={4} maxLength={limits.what} required />
      </p>
      <p>
        <label htmlFor="incident-location">Where? (optional)</label>
        <input id="incident-location" name="location" type="text" maxLength={limits.location} autoComplete="off" />
      </p>
      <YesNo name="water" value={water} onChange={setWater} label="Did it happen on the water?" />
      <p>
        <label htmlFor="incident-conditions">Water and weather (optional)</label>
        <input id="incident-conditions" name="conditions" type="text" maxLength={limits.conditions} autoComplete="off" />
      </p>

      <fieldset>
        <legend>Which boats or spaces were involved? (optional)</legend>
        {Array.from({ length: boatSlots }, (_, i) => (
          <p key={i}>
            <label htmlFor={`incident-boat-${i}`} className="club-meta">
              Boat or space {i + 1}
            </label>{" "}
            <select id={`incident-boat-${i}`} name="boat" defaultValue="">
              <option value="">None</option>
              {boats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </p>
        ))}
        {boatSlots < limits.boats && (
          <p>
            <button type="button" className="club-button club-button-quiet" onClick={() => setBoatSlots((n) => n + 1)} data-testid="incident-add-boat">
              Add another boat or space
            </button>
          </p>
        )}
      </fieldset>

      <fieldset data-testid="incident-people">
        <legend>Who was involved?</legend>
        <input type="hidden" name="people" value={rows.length} />
        {rows.length === 0 ? (
          <p className="club-meta">No one added yet. Add a member by name, or type a name for someone who is not a member.</p>
        ) : (
          <ul className="club-list">
            {rows.map((r, i) => (
              <li key={r.key} data-testid="incident-person" data-name={r.name}>
                <input type="hidden" name={`personMember${i}`} value={r.memberId} />
                {r.memberId === "" && <input type="hidden" name={`personName${i}`} value={r.name} />}
                <strong>{r.name}</strong> <span className="club-meta">{r.memberId === "" ? "not a member" : "member"}</span>{" "}
                <label className="club-check">
                  <input type="checkbox" name={`personHurt${i}`} data-testid="incident-hurt" /> Hurt
                </label>{" "}
                <label className="club-check">
                  <input type="checkbox" name={`personParent${i}`} /> A parent was told
                </label>{" "}
                <button type="button" className="club-button club-button-quiet" onClick={() => removeRow(r.key)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {!full && (
          <>
            <p>
              <label htmlFor="incident-person-search">Find a member by name</label>
              <input id="incident-person-search" type="search" value={query} onChange={(e) => search(e.target.value)} autoComplete="off" data-testid="incident-person-search" />
              <span className="club-meta"> Type at least three letters.</span>
            </p>
            {found && found.people.length === 0 && <p className="club-meta">No member found with that name.</p>}
            {found && found.people.length > 0 && (
              <ul className="club-list" data-testid="incident-person-results">
                {found.people.map((p) => (
                  <li key={p.memberId}>
                    <button type="button" className="club-button club-button-quiet" onClick={() => addRow(p.memberId, p.name)} data-testid="incident-person-result">
                      Add {p.name}
                      {p.household ? ` (${p.household})` : ""}
                    </button>
                  </li>
                ))}
                {found.more && <li className="club-meta">More members match. Type more of the name.</li>}
              </ul>
            )}
            <p>
              <label htmlFor="incident-typed-name">Someone who is not a member</label>
              <input id="incident-typed-name" type="text" value={typed} maxLength={limits.personName} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="incident-typed-name" />{" "}
              <button type="button" className="club-button club-button-quiet" disabled={typed.trim() === ""} onClick={() => addRow("", typed.trim())} data-testid="incident-add-typed">
                Add this name
              </button>
            </p>
          </>
        )}
        {full && <p className="club-meta">That is the most people one report can name. Say who else was there in what happened.</p>}
      </fieldset>

      <YesNo name="firstAid" value={aid} onChange={setAid} label="Was first aid given?" />
      {aid === "yes" && (
        <p>
          <label htmlFor="incident-first-aid-notes">Who gave it, and what was done? (optional)</label>
          <input id="incident-first-aid-notes" name="firstAidNotes" type="text" maxLength={limits.firstAid} autoComplete="off" />
        </p>
      )}
      <YesNo name="emergency" value={call} onChange={setCall} label="Were emergency services called?" />
      {call === "yes" && (
        <p>
          <label htmlFor="incident-emergency-notes">Which ones? (optional)</label>
          <input id="incident-emergency-notes" name="emergencyNotes" type="text" maxLength={limits.emergency} autoComplete="off" />
        </p>
      )}

      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button" disabled={pending} data-testid="incident-submit">
          File the report
        </button>
      </p>
    </form>
  );
}

/** A note on a report: the coach who filed it while it is open, and staff any time. */
export function IncidentNoteForm({ incidentId, label }: { incidentId: string; label: string }) {
  const { state, pending, run } = useStaffAction(addIncidentNoteAction);
  return (
    <form
      className="club-form"
      data-testid="incident-note-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        run(form, () => form.reset());
      }}
    >
      <input type="hidden" name="incident" value={incidentId} />
      <p>
        <label htmlFor={`incident-note-${incidentId}`}>{label}</label>
        <textarea id={`incident-note-${incidentId}`} name="text" rows={2} maxLength={1000} required />
      </p>
      <ActionMessage state={state} />
      <p>
        <button type="submit" className="club-button club-button-quiet" disabled={pending}>
          Add note
        </button>
      </p>
    </form>
  );
}
