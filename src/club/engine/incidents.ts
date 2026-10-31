import { ClubError } from "../errors";
import { nameMatches } from "../name-filter";
import type { ClubStore } from "../store/memory";
import { formatMoment } from "../time";
import type { Actor, ClubState, Incident, IncidentBoat, IncidentLogEntry, IncidentLogKind, IncidentPerson, IncidentRules, IncidentStatus } from "../types";
import { itemVisibleTo, PEOPLE_SEARCH_MIN_LETTERS, PEOPLE_SEARCH_MOST, type BoatPeopleSearch } from "./boat-access";
import { manyLines, oneLine, reportableItems, shorten } from "./damage";
import { blockReasonFor } from "./eligibility";
import type { Ctx } from "./households";
import { activeCoach } from "./practices";
import { fullName, householdOf } from "./queries";

/**
 * Incident reports.
 *
 * The building comparison: the incident log in the manager's office. Whoever was on the scene (club staff, or a coach) writes down
 * what happened, who was involved and who was hurt; the office adds what caused it and what will change, notes who is following
 * up, links the work order if a boat was damaged, and files it away. What the person on the scene wrote is never rewritten, a
 * filed-away report never changes, and every step is a line in the report's own log.
 *
 * Who: staff and coaches (members staff have marked as coaches) file. Only staff read every report and do everything after the
 * filing. A coach sees the reports they filed themselves, and can add a note to one while it is open. Nobody else sees any of it,
 * and nothing about an incident ever shows on a boat's page or on anyone's bookings.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const INCIDENT_STATUS_WORDS: Record<IncidentStatus, string> = { open: "Open", closed: "Closed" };

/** Thrown when a report cannot be filed. `message` is the first reason; `reasons` is all of them. */
export class IncidentRefused extends ClubError {
  constructor(public reasons: string[]) {
    super("refused", reasons[0] ?? "That cannot be done.");
  }
}

/* ---------- Who may file ---------- */

/** Club staff, and members staff have marked as coaches who are still active. Nobody else, and not the system. */
export function canFileIncident(state: ClubState, actor: Actor): boolean {
  if (actor.kind === "staff") return true;
  return actor.kind === "member" && activeCoach(state, actor.memberId) !== undefined;
}

/* ---------- Helpers ---------- */

function incidentOf(state: ClubState, id: string): Incident {
  const incident = state.incidents.find((i) => i.id === id);
  if (!incident) throw new ClubError("not_found", "That incident report no longer exists.");
  return incident;
}

function mustBeOpen(incident: Incident): void {
  if (incident.status !== "open") throw new ClubError("conflict", "That report is already closed, so it cannot change. If something has come back, file a new report.");
}

function staffOnly(ctx: Ctx, what: string): void {
  if (ctx.actor.kind !== "staff") throw new ClubError("forbidden", `Only club staff can ${what}.`);
}

function logLine(newId: () => string, ctx: Ctx, incidentId: string, kind: IncidentLogKind, text: string): IncidentLogEntry {
  return { id: newId(), incidentId, at: ctx.now.toISOString(), kind, by: ctx.actor, text };
}

const quoted = (text: string) => `"${shorten(text, 120)}"`;

/* ---------- Filing a report ---------- */

export interface IncidentPersonInput {
  /** A member picked from the list. Leave empty for someone who is not a member, and give a name instead. */
  memberId?: string;
  /** For someone who is not a member (a guest, someone from another club). */
  name?: string;
  injured: boolean;
  /** Whether a parent or guardian was told. */
  parentTold?: boolean;
}

export interface IncidentInput {
  /** The moment it happened. */
  occurredAt: Date;
  whatHappened: string;
  location?: string;
  onTheWater: boolean;
  /** Water and weather. */
  conditions?: string;
  boatIds?: string[];
  people?: IncidentPersonInput[];
  firstAidGiven: boolean;
  /** Who gave it and what was done. Only with firstAidGiven. */
  firstAidNotes?: string;
  emergencyCalled: boolean;
  /** Which services. Only with emergencyCalled. */
  emergencyNotes?: string;
}

/**
 * Staff or a coach files a report. Every problem is reported at once, in words, and nothing is saved until there are none. The
 * people are members picked from the list (so staff can see every incident a member has been in) or names typed in; each is marked
 * hurt or not, and whether a parent was told. The boats are optional. Nobody is told anything by email.
 */
export async function fileIncident(store: ClubStore, ctx: Ctx, rules: IncidentRules, input: IncidentInput): Promise<Incident> {
  const r = rules.defaults;
  return store.transaction(async (s, newId) => {
    if (!canFileIncident(s, ctx.actor)) throw new ClubError("forbidden", "Only club staff and coaches can file an incident report.");
    const reasons: string[] = [];
    const field = (value: unknown, label: string, max: number, options: { needed?: string; multiline?: boolean } = {}): string => {
      const text = options.multiline ? manyLines(value) : oneLine(value);
      if (text === "" && options.needed) reasons.push(options.needed);
      else if (text.length > max) reasons.push(`${label} must be ${max} characters or fewer. It is ${text.length}.`);
      return text;
    };

    const whatHappened = field(input.whatHappened, "What happened", r.whatHappenedMax, { needed: "Say what happened.", multiline: true });
    const location = field(input.location ?? "", "Where it happened", r.locationMax);
    const conditions = field(input.conditions ?? "", "The water and weather", r.conditionsMax);
    const firstAidNotes = field(input.firstAidNotes ?? "", "The first aid notes", r.firstAidMax);
    const emergencyNotes = field(input.emergencyNotes ?? "", "The emergency services notes", r.emergencyMax);
    if (typeof input.onTheWater !== "boolean") reasons.push("Say whether it happened on the water.");
    if (typeof input.firstAidGiven !== "boolean") reasons.push("Say whether first aid was given.");
    else if (!input.firstAidGiven && firstAidNotes !== "") reasons.push("Say that first aid was given, or clear the first aid notes.");
    if (typeof input.emergencyCalled !== "boolean") reasons.push("Say whether emergency services were called.");
    else if (!input.emergencyCalled && emergencyNotes !== "") reasons.push("Say that emergency services were called, or clear their notes.");

    const occurred = input.occurredAt instanceof Date ? input.occurredAt.getTime() : NaN;
    if (Number.isNaN(occurred)) reasons.push("Say when it happened.");
    else if (occurred > ctx.now.getTime()) reasons.push("That time is in the future. Say when it happened.");
    else if (occurred < ctx.now.getTime() - r.maxDaysBack * 86400000) reasons.push(`An incident can be dated up to ${plural(r.maxDaysBack, "day")} back.`);

    const people: Omit<IncidentPerson, "id" | "incidentId">[] = [];
    const rawPeople = input.people ?? [];
    if (rawPeople.length > r.maxPeople) reasons.push(`A report can name up to ${r.maxPeople} people.`);
    const seenMembers = new Set<string>();
    const seenNames = new Set<string>();
    for (const p of rawPeople.slice(0, r.maxPeople)) {
      const memberId = typeof p.memberId === "string" ? p.memberId.trim() : "";
      const typed = oneLine(p.name ?? "");
      const injured = p.injured === true;
      const parentTold = p.parentTold === true;
      if (memberId !== "" && typed !== "") {
        reasons.push("Pick a member or type a name for each person, not both.");
      } else if (memberId !== "") {
        const m = s.members.find((x) => x.id === memberId);
        if (!m) reasons.push("That member no longer exists.");
        else if (blockReasonFor(s, m.id) !== null) reasons.push(`${fullName(m)} is no longer an active member. Type their name instead.`);
        else if (seenMembers.has(m.id)) reasons.push(`${fullName(m)} is listed twice.`);
        else {
          seenMembers.add(m.id);
          people.push({ memberId: m.id, name: fullName(m), injured, parentTold });
        }
      } else if (typed === "") {
        reasons.push("Each person needs a name.");
      } else if (typed.length > r.personNameMax) {
        reasons.push(`A name must be ${r.personNameMax} characters or fewer. "${shorten(typed, 30)}" is ${typed.length}.`);
      } else if (seenNames.has(typed.toLowerCase())) {
        reasons.push(`${typed} is listed twice.`);
      } else {
        seenNames.add(typed.toLowerCase());
        people.push({ memberId: null, name: typed, injured, parentTold });
      }
    }

    const boatIds: string[] = [];
    const rawBoats = input.boatIds ?? [];
    if (rawBoats.length > r.maxBoats) reasons.push(`A report can name up to ${r.maxBoats} ${r.maxBoats === 1 ? "boat or space" : "boats or spaces"}.`);
    for (const id of rawBoats.slice(0, r.maxBoats)) {
      const item = s.items.find((i) => i.id === id);
      // A boat a coach is not allowed to see is not theirs to write about; it looks like a boat that does not exist.
      const visible = item && (ctx.actor.kind !== "member" || itemVisibleTo(s, item, { kind: "member", memberId: ctx.actor.memberId }));
      if (!visible) reasons.push("That boat or space no longer exists.");
      else if (boatIds.includes(item.id)) reasons.push(`${item.name} is listed twice.`);
      else boatIds.push(item.id);
    }

    if (reasons.length > 0) throw new IncidentRefused(reasons);

    const now = ctx.now.toISOString();
    const incident: Incident = {
      id: newId(),
      reportedBy: ctx.actor,
      reportedAt: now,
      occurredAt: new Date(occurred).toISOString(),
      whatHappened,
      location,
      onTheWater: input.onTheWater,
      conditions,
      firstAidGiven: input.firstAidGiven,
      firstAidNotes,
      emergencyCalled: input.emergencyCalled,
      emergencyNotes,
      status: "open",
      updatedAt: now,
      cause: null,
      whatWillChange: null,
      followUpBy: null,
      damageReportId: null,
      closedAt: null,
      closedNote: null,
    };
    s.incidents.push(incident);
    for (const p of people) s.incidentPeople.push({ id: newId(), incidentId: incident.id, ...p });
    for (const itemId of boatIds) s.incidentBoats.push({ id: newId(), incidentId: incident.id, itemId });
    const hurt = people.filter((p) => p.injured).length;
    s.incidentLog.push(
      logLine(
        newId,
        ctx,
        incident.id,
        "filed",
        `Reported by ${ctx.actor.label}. ${hurt === 0 ? "Nobody was hurt." : hurt === 1 ? "1 person was hurt." : `${hurt} people were hurt.`}${input.emergencyCalled ? " Emergency services were called." : ""}`,
      ),
    );
    return structuredClone(incident);
  });
}

/* ---------- Notes ---------- */

/** A note on a report. Staff can add one any time; the coach who filed it can add one while it is still open. */
export async function addIncidentNote(store: ClubStore, ctx: Ctx, rules: IncidentRules, input: { incidentId: string; text: string }): Promise<IncidentLogEntry> {
  if (ctx.actor.kind === "system") throw new ClubError("forbidden", "Only club staff, or the coach who filed the report, can add a note.");
  const text = manyLines(input.text);
  if (text === "") throw new ClubError("invalid", "Write the note first.");
  if (text.length > rules.defaults.noteMax) throw new ClubError("invalid", `A note must be ${rules.defaults.noteMax} characters or fewer. It is ${text.length}.`);
  return store.transaction(async (s, newId) => {
    const incident = incidentOf(s, input.incidentId);
    if (ctx.actor.kind === "member") {
      const memberId = ctx.actor.memberId;
      // Anyone but the filer is told the report does not exist: its words are for staff and the person who wrote it.
      if (incident.reportedBy.kind !== "member" || incident.reportedBy.memberId !== memberId) throw new ClubError("not_found", "That incident report no longer exists.");
      const blocked = blockReasonFor(s, memberId, "they can no longer add notes");
      if (blocked) throw new ClubError("forbidden", blocked);
      mustBeOpen(incident);
    }
    const line = logLine(newId, ctx, incident.id, "note", text);
    s.incidentLog.push(line);
    return structuredClone(line);
  });
}

/* ---------- Staff review ---------- */

export interface IncidentReviewInput {
  incidentId: string;
  /** What caused it. Empty clears it. Leave out to leave it as it is. */
  cause?: string;
  /** What will change so it does not happen again. Empty clears it. */
  whatWillChange?: string;
  /** Who is following up, in words. Empty clears it. */
  followUpBy?: string;
  /** A damage report this led to. null removes the link. */
  damageReportId?: string | null;
}

/**
 * Staff fill in what they found out: the cause, what will change, who is following up, and the damage report it led to. Only what
 * is given and different is changed, all in one step with one line in the log. Nothing changed is refused in words.
 */
export async function reviewIncident(store: ClubStore, ctx: Ctx, rules: IncidentRules, input: IncidentReviewInput): Promise<Incident> {
  staffOnly(ctx, "review an incident report");
  const r = rules.defaults;
  const limited = (value: string, label: string, max: number): string => {
    const text = manyLines(value);
    if (text.length > max) throw new ClubError("invalid", `${label} must be ${max} characters or fewer. It is ${text.length}.`);
    return text;
  };
  const cause = input.cause === undefined ? undefined : limited(input.cause, "The cause", r.causeMax);
  const change = input.whatWillChange === undefined ? undefined : limited(input.whatWillChange, "What will change", r.changeMax);
  const followUpRaw = input.followUpBy === undefined ? undefined : oneLine(input.followUpBy);
  if (followUpRaw !== undefined && followUpRaw.length > r.followUpByMax) throw new ClubError("invalid", `Who is following up must be ${r.followUpByMax} characters or fewer. It is ${followUpRaw.length}.`);
  return store.transaction(async (s, newId) => {
    const incident = incidentOf(s, input.incidentId);
    mustBeOpen(incident);
    const parts: string[] = [];
    const set = (label: string, was: string | null, next: string | undefined, apply: (v: string | null) => void) => {
      if (next === undefined || (was ?? "") === next) return;
      apply(next === "" ? null : next);
      parts.push(next === "" ? `${label} cleared.` : was === null ? `${label} recorded: ${quoted(next)}.` : `${label} changed to ${quoted(next)}.`);
    };
    set("Cause", incident.cause, cause, (v) => (incident.cause = v));
    set("What will change", incident.whatWillChange, change, (v) => (incident.whatWillChange = v));
    set("Follow-up by", incident.followUpBy, followUpRaw, (v) => (incident.followUpBy = v));
    if (input.damageReportId !== undefined && input.damageReportId !== incident.damageReportId) {
      if (input.damageReportId === null) {
        incident.damageReportId = null;
        parts.push("Link to the damage report removed.");
      } else {
        const damage = s.damageReports.find((d) => d.id === input.damageReportId);
        if (!damage) throw new ClubError("not_found", "That damage report no longer exists.");
        incident.damageReportId = damage.id;
        parts.push(`Linked to the damage report on ${s.items.find((i) => i.id === damage.itemId)?.name ?? "a boat"}: ${quoted(damage.description)}.`);
      }
    }
    if (parts.length === 0) throw new ClubError("unchanged", "Nothing was changed: what you gave is what the report already says.");
    incident.updatedAt = ctx.now.toISOString();
    s.incidentLog.push(logLine(newId, ctx, incident.id, "reviewed", `Reviewed by ${ctx.actor.label}. ${parts.join(" ")}`));
    return structuredClone(incident);
  });
}

/** Staff close a report with what was done, or why nothing more is needed. A closed report never changes. */
export async function closeIncident(store: ClubStore, ctx: Ctx, rules: IncidentRules, input: { incidentId: string; outcome: string }): Promise<Incident> {
  staffOnly(ctx, "close an incident report");
  const outcome = manyLines(input.outcome);
  if (outcome === "") throw new ClubError("invalid", "Say what was done, or why nothing more is needed.");
  if (outcome.length > rules.defaults.closingNoteMax) throw new ClubError("invalid", `What was done must be ${rules.defaults.closingNoteMax} characters or fewer. It is ${outcome.length}.`);
  return store.transaction(async (s, newId) => {
    const incident = incidentOf(s, input.incidentId);
    mustBeOpen(incident);
    const now = ctx.now.toISOString();
    incident.status = "closed";
    incident.updatedAt = now;
    incident.closedAt = now;
    incident.closedNote = outcome;
    s.incidentLog.push(logLine(newId, ctx, incident.id, "closed", `Closed by ${ctx.actor.label}: ${shorten(outcome, 300)}`));
    return structuredClone(incident);
  });
}

/* ---------- Finding the people involved ---------- */

/**
 * The search box on the form: active members by name, three letters at least, never more than six, and never anyone already on
 * the report. Names only (no email or phone); two people with one name are told apart by household.
 */
export function findIncidentPeople(state: ClubState, typed: string, alreadyNamed: string[]): BoatPeopleSearch {
  const wanted = typed.trim();
  const letters = wanted.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]/g, "");
  if (letters.length < PEOPLE_SEARCH_MIN_LETTERS) return { tooShort: true, people: [], more: false };
  const taken = new Set(alreadyNamed);
  const found = state.members
    .filter((m) => !taken.has(m.id) && blockReasonFor(state, m.id) === null && nameMatches(fullName(m), wanted))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id.localeCompare(b.id));
  const shown = found.slice(0, PEOPLE_SEARCH_MOST);
  const counts = new Map<string, number>();
  for (const m of shown) counts.set(fullName(m), (counts.get(fullName(m)) ?? 0) + 1);
  return {
    tooShort: false,
    people: shown.map((m) => ({ memberId: m.id, name: fullName(m), household: (counts.get(fullName(m)) ?? 0) > 1 ? householdOf(state, m.householdId)!.displayName : null })),
    more: found.length > shown.length,
  };
}

/** The boats and spaces this viewer may name on a report: everything for staff, and for a coach every item they are allowed to see. */
export const incidentBoatChoices = reportableItems;

/* ---------- What the person who filed it sees ---------- */

export interface IncidentPersonView {
  name: string;
  /** True for a member picked from the list. */
  member: boolean;
  injured: boolean;
  parentTold: boolean;
}

function peopleOf(state: ClubState, incidentId: string): IncidentPersonView[] {
  return state.incidentPeople
    .filter((p) => p.incidentId === incidentId)
    .map((p) => ({ name: p.name, member: p.memberId !== null, injured: p.injured, parentTold: p.parentTold }));
}

function boatsOf(state: ClubState, incidentId: string): { itemId: string; name: string }[] {
  return state.incidentBoats
    .filter((b: IncidentBoat) => b.incidentId === incidentId)
    .map((b) => ({ itemId: b.itemId, name: state.items.find((i) => i.id === b.itemId)?.name ?? "A boat or space" }));
}

export interface MyIncidentLine {
  incidentId: string;
  occurredAt: string;
  whatHappened: string;
  location: string;
  onTheWater: boolean;
  boats: string[];
  people: IncidentPersonView[];
  status: IncidentStatus;
  statusWords: string;
  closedAt: string | null;
  /** The notes this person added themselves, oldest first. */
  notes: { at: string; text: string }[];
}

/**
 * The reports one person filed, newest first. What staff did with them (the cause, what will change, who is following up, notes of
 * their own, what was done) is staff's and is never shown here.
 */
export function myIncidents(state: ClubState, memberId: string): MyIncidentLine[] {
  return state.incidents
    .filter((i) => i.reportedBy.kind === "member" && i.reportedBy.memberId === memberId)
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.id.localeCompare(a.id))
    .map((i) => ({
      incidentId: i.id,
      occurredAt: i.occurredAt,
      whatHappened: i.whatHappened,
      location: i.location,
      onTheWater: i.onTheWater,
      boats: boatsOf(state, i.id).map((b) => b.name),
      people: peopleOf(state, i.id),
      status: i.status,
      statusWords: INCIDENT_STATUS_WORDS[i.status],
      closedAt: i.closedAt,
      notes: state.incidentLog
        .filter((l) => l.incidentId === i.id && l.kind === "note" && l.by.kind === "member" && l.by.memberId === memberId)
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((l) => ({ at: l.at, text: l.text })),
    }));
}

/* ---------- What staff see ---------- */

export interface IncidentRow {
  incidentId: string;
  occurredAt: string;
  whatHappened: string;
  location: string;
  onTheWater: boolean;
  boats: string[];
  peopleCount: number;
  hurtCount: number;
  emergencyCalled: boolean;
  status: IncidentStatus;
  statusWords: string;
  reportedAt: string;
  reporter: string;
  followUpBy: string | null;
  /** Whole days the report has been open (or was open, once closed). */
  daysOpen: number;
  closedAt: string | null;
  /** True when a damage report is linked. */
  hasDamageLink: boolean;
}

function row(state: ClubState, i: Incident, now: Date): IncidentRow {
  const end = i.closedAt ? Date.parse(i.closedAt) : now.getTime();
  const people = state.incidentPeople.filter((p) => p.incidentId === i.id);
  return {
    incidentId: i.id,
    occurredAt: i.occurredAt,
    whatHappened: i.whatHappened,
    location: i.location,
    onTheWater: i.onTheWater,
    boats: boatsOf(state, i.id).map((b) => b.name),
    peopleCount: people.length,
    hurtCount: people.filter((p) => p.injured).length,
    emergencyCalled: i.emergencyCalled,
    status: i.status,
    statusWords: INCIDENT_STATUS_WORDS[i.status],
    reportedAt: i.reportedAt,
    reporter: i.reportedBy.label,
    followUpBy: i.followUpBy,
    daysOpen: Math.max(0, Math.floor((end - Date.parse(i.reportedAt)) / 86400000)),
    closedAt: i.closedAt,
    hasDamageLink: i.damageReportId !== null,
  };
}

/**
 * Staff's list. Open reports: anyone hurt first, then emergency services called, then the oldest. Closed reports: the most recently
 * closed first.
 */
export function incidentQueue(state: ClubState, now: Date, which: "open" | "closed"): IncidentRow[] {
  const wanted = state.incidents.filter((i) => (which === "open") === (i.status === "open"));
  const rows = wanted.map((i) => row(state, i, now));
  return which === "open"
    ? rows.sort(
        (a, b) =>
          Number(b.hurtCount > 0) - Number(a.hurtCount > 0) ||
          Number(b.emergencyCalled) - Number(a.emergencyCalled) ||
          a.reportedAt.localeCompare(b.reportedAt) ||
          a.incidentId.localeCompare(b.incidentId),
      )
    : rows.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "") || b.incidentId.localeCompare(a.incidentId));
}

export interface IncidentLogLine {
  at: string;
  kind: IncidentLogKind;
  by: string;
  text: string;
}

export interface IncidentDetail {
  incident: Incident;
  reporter: string;
  statusWords: string;
  occurredWords: string;
  boats: { itemId: string; name: string }[];
  people: IncidentPersonView[];
  /** Newest first. */
  log: IncidentLogLine[];
  /** The damage report this led to, if one is linked. */
  damage: { reportId: string; itemName: string; description: string; statusWords: string } | null;
  /** Damage reports staff can link, newest first: the one already linked is always among them. */
  damageChoices: { reportId: string; label: string }[];
}

const DAMAGE_STATUS_WORDS: Record<string, string> = { open: "open", in_progress: "being fixed", repaired: "repaired", dismissed: "dismissed" };
const DAMAGE_CHOICES = 40;

export function incidentDetail(state: ClubState, incidentId: string): IncidentDetail | null {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) return null;
  const damageLabel = (d: ClubState["damageReports"][number]) => `${state.items.find((i) => i.id === d.itemId)?.name ?? "A boat"}: ${shorten(d.description, 60)} (${DAMAGE_STATUS_WORDS[d.status] ?? d.status})`;
  const linked = incident.damageReportId ? state.damageReports.find((d) => d.id === incident.damageReportId) : undefined;
  const recent = [...state.damageReports].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.id.localeCompare(a.id)).slice(0, DAMAGE_CHOICES);
  const choices = linked && !recent.some((d) => d.id === linked.id) ? [linked, ...recent] : recent;
  return {
    incident: structuredClone(incident),
    reporter: incident.reportedBy.label,
    statusWords: INCIDENT_STATUS_WORDS[incident.status],
    occurredWords: formatMoment(incident.occurredAt),
    boats: boatsOf(state, incident.id),
    people: peopleOf(state, incident.id),
    log: state.incidentLog
      .map((l, written) => ({ l, written }))
      .filter(({ l }) => l.incidentId === incidentId)
      .sort((a, b) => b.l.at.localeCompare(a.l.at) || b.written - a.written)
      .map(({ l }) => ({ at: l.at, kind: l.kind, by: l.by.label, text: l.text })),
    damage: linked
      ? { reportId: linked.id, itemName: state.items.find((i) => i.id === linked.itemId)?.name ?? "A boat or space", description: linked.description, statusWords: DAMAGE_STATUS_WORDS[linked.status] ?? linked.status }
      : null,
    damageChoices: choices.map((d) => ({ reportId: d.id, label: damageLabel(d) })),
  };
}

export interface OfficeIncidents {
  /** Reports still open. */
  open: number;
  /** Of those, how many have someone hurt. */
  hurt: number;
  /** Of those, how many called emergency services. */
  emergency: number;
  /** The most pressing few. */
  top: IncidentRow[];
}

const OFFICE_TOP = 5;

/** The staff home page's incident board. */
export function officeIncidents(state: ClubState, now: Date): OfficeIncidents {
  const open = incidentQueue(state, now, "open");
  return {
    open: open.length,
    hurt: open.filter((r) => r.hurtCount > 0).length,
    emergency: open.filter((r) => r.emergencyCalled).length,
    top: open.slice(0, OFFICE_TOP),
  };
}
