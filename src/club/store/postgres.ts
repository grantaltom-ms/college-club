import { Pool, types as pgTypes, type PoolClient } from "pg";
import { assertNotHosted } from "../db/guard";
import { ClubError } from "../errors";
import type {
  Actor,
  Booking,
  BookingStatus,
  ClassRules,
  ClassRuleValues,
  ClassSession,
  ClassTemplate,
  ClubState,
  HistoryEntry,
  HistoryKind,
  Household,
  HouseholdStatus,
  Item,
  Member,
  MemberQualification,
  MemberRole,
  MemberStatus,
  MembershipType,
  OutOfServicePeriod,
  Qualification,
  RuleBook,
  RuleValues,
  SessionStatus,
  SignUp,
  SignUpStatus,
} from "../types";
import type { ClubStore } from "./memory";

/**
 * The club's records in Postgres, behind the same `ClubStore` the in-memory copy uses, so the rules engine does
 * not change at all.
 *
 * How a change works: take the one "writers" lock (so changes happen strictly one after another, whichever app
 * server they arrive at), load the current records, let the engine change a working copy, then write back exactly
 * what changed, all inside one database transaction. Because writers take turns and each starts from fresh data,
 * a member's limits and "nobody in two boats at once" are checked against the truth even when many requests
 * arrive together. The database's own overlap rule stays underneath as a second line of defence.
 *
 * Phase 1: this only ever talks to a local or throwaway Postgres; it refuses hosted Supabase addresses.
 */

const WRITERS_LOCK = "club:writes";
const SEED_LOCK = "club:seed";

/** How far back the screens and the rules look at bookings. Older ones stay in the database. */
const DEFAULT_HISTORY_DAYS = 90;

export interface PgStoreOptions {
  newId?: () => string;
  /** How many days of finished bookings to load. */
  historyDays?: number;
  /** The store's idea of "now", used only to decide how far back to load. */
  now?: () => Date;
}

/** A connection pool for the club database. Refuses hosted Supabase addresses. Dates come back as plain YYYY-MM-DD text. */
export function createClubPool(url: string, max = 4): Pool {
  assertNotHosted(url);
  const pool = new Pool({
    connectionString: url,
    max,
    types: {
      getTypeParser: ((oid: number, format?: "text" | "binary") => (oid === 1082 ? (v: string) => v : pgTypes.getTypeParser(oid, format as "text"))) as typeof pgTypes.getTypeParser,
    },
  });
  pool.on("error", (e) => console.error("Club database connection problem:", e.message));
  return pool;
}

/* ---------- Rows <-> records ---------- */

interface HouseholdRow { id: string; display_name: string; membership_type: MembershipType; status: HouseholdStatus; joined_on: string; ended_on: string | null; quickbooks_id: string | null; notes: string }
interface MemberRow { id: string; household_id: string; first_name: string; last_name: string; email: string; phone: string; role: MemberRole; status: MemberStatus; brivo_credential_id: string | null; mailchimp_contact_id: string | null; login_id: string | null }
interface MemberQualificationRow { member_id: string; qualification_code: string; granted_by_label: string; granted_at: Date }
interface HistoryRow { id: string; household_id: string; at: Date; kind: HistoryKind; summary: string; actor_kind: string; actor_id: string | null; actor_label: string; details: HistoryEntry["details"] }
interface ItemRow { id: string; name: string; class_code: string; rule_overrides: Partial<RuleValues>; qualification_mode: "class" | "none" | "code"; required_qualification: string | null }
interface OutOfServiceRow { id: string; item_id: string; from_at: Date; until_at: Date | null; reason: string; expected_return: string | null; created_by_kind: string; created_by_label: string; created_at: Date }
interface BookingRow { id: string; item_id: string; booker_id: string; starts_at: Date; ends_at: Date; status: BookingStatus; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; status_changed_at: Date; cancelled_by_kind: string | null; cancelled_by_id: string | null; cancelled_by_label: string | null; cancel_reason: string | null; override_reason: string | null; override_by_label: string | null; override_waived: string[] | null }
interface ClassRow { id: string; name: string; description: string; instructor: string; default_capacity: number; default_minutes: number; room_item_id: string | null; rules: Partial<ClassRuleValues> }
interface SessionRow { id: string; class_id: string; room_item_id: string | null; starts_at: Date; ends_at: Date; capacity: number; status: SessionStatus; created_at: Date; created_by_kind: string; created_by_label: string; status_changed_at: Date; cancelled_by_kind: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface SignUpRow { id: string; session_id: string; member_id: string; status: SignUpStatus; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; status_changed_at: Date; promoted_at: Date | null; cancelled_by_kind: string | null; cancelled_by_id: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface CrewRow { booking_id: string; member_id: string; position: number; removed_at: Date | null; removed_reason: string | null }

const iso = (d: Date | string) => new Date(d).toISOString();

function actorFrom(kind: string, id: string | null, label: string): Actor {
  if (kind === "member") return { kind: "member", memberId: id ?? "", label };
  if (kind === "staff") return { kind: "staff", label };
  return { kind: "system", label };
}
const actorId = (a: Actor) => (a.kind === "member" ? a.memberId : null);

const toHousehold = (r: HouseholdRow): Household => ({
  id: r.id,
  displayName: r.display_name,
  membershipType: r.membership_type,
  status: r.status,
  joinedOn: r.joined_on,
  endedOn: r.ended_on,
  quickbooksId: r.quickbooks_id,
  notes: r.notes,
});

const toMember = (r: MemberRow): Member => ({
  id: r.id,
  householdId: r.household_id,
  firstName: r.first_name,
  lastName: r.last_name,
  email: r.email,
  phone: r.phone,
  role: r.role,
  status: r.status,
  brivoCredentialId: r.brivo_credential_id,
  mailchimpContactId: r.mailchimp_contact_id,
  loginId: r.login_id,
});

const toHistory = (r: HistoryRow): HistoryEntry => ({
  id: r.id,
  householdId: r.household_id,
  at: iso(r.at),
  kind: r.kind,
  summary: r.summary,
  actor: actorFrom(r.actor_kind, r.actor_id, r.actor_label),
  details: r.details,
});

function toItem(r: ItemRow): Item {
  const item: Item = { id: r.id, name: r.name, classCode: r.class_code, ruleOverrides: r.rule_overrides };
  if (r.qualification_mode === "none") item.requiredQualification = null;
  else if (r.qualification_mode === "code") item.requiredQualification = r.required_qualification;
  return item;
}

const toOutOfService = (r: OutOfServiceRow): OutOfServicePeriod => ({
  id: r.id,
  itemId: r.item_id,
  from: iso(r.from_at),
  until: r.until_at ? iso(r.until_at) : null,
  reason: r.reason,
  expectedReturn: r.expected_return,
  createdBy: actorFrom(r.created_by_kind, null, r.created_by_label),
  createdAt: iso(r.created_at),
});

function toBooking(r: BookingRow, crew: CrewRow[]): Booking {
  const seats = crew.filter((c) => c.booking_id === r.id).sort((a, b) => a.position - b.position);
  return {
    id: r.id,
    itemId: r.item_id,
    bookerId: r.booker_id,
    crew: seats.filter((c) => !c.removed_at).map((c) => c.member_id),
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    status: r.status,
    createdAt: iso(r.created_at),
    createdBy: actorFrom(r.created_by_kind, r.created_by_id, r.created_by_label),
    statusChangedAt: iso(r.status_changed_at),
    cancelledBy: r.cancelled_by_kind ? actorFrom(r.cancelled_by_kind, r.cancelled_by_id, r.cancelled_by_label ?? "") : null,
    cancelReason: r.cancel_reason,
    override: r.override_reason ? { reason: r.override_reason, actor: { kind: "staff", label: r.override_by_label ?? "" }, waived: r.override_waived ?? [] } : null,
    removedCrew: seats
      .filter((c) => c.removed_at)
      .sort((a, b) => iso(a.removed_at!).localeCompare(iso(b.removed_at!)) || a.position - b.position)
      .map((c) => ({ memberId: c.member_id, at: iso(c.removed_at!), reason: c.removed_reason ?? "" })),
  };
}

const toClass = (r: ClassRow): ClassTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description,
  instructor: r.instructor,
  defaultCapacity: r.default_capacity,
  defaultMinutes: r.default_minutes,
  roomItemId: r.room_item_id,
  rules: r.rules,
});

const toSession = (r: SessionRow): ClassSession => ({
  id: r.id,
  classId: r.class_id,
  roomItemId: r.room_item_id,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  capacity: r.capacity,
  status: r.status,
  createdAt: iso(r.created_at),
  createdBy: actorFrom(r.created_by_kind, null, r.created_by_label),
  statusChangedAt: iso(r.status_changed_at),
  cancelledBy: r.cancelled_by_kind ? actorFrom(r.cancelled_by_kind, null, r.cancelled_by_label ?? "") : null,
  cancelReason: r.cancel_reason,
});

const toSignUp = (r: SignUpRow): SignUp => ({
  id: r.id,
  sessionId: r.session_id,
  memberId: r.member_id,
  status: r.status,
  createdAt: iso(r.created_at),
  createdBy: actorFrom(r.created_by_kind, r.created_by_id, r.created_by_label),
  statusChangedAt: iso(r.status_changed_at),
  promotedAt: r.promoted_at ? iso(r.promoted_at) : null,
  cancelledBy: r.cancelled_by_kind ? actorFrom(r.cancelled_by_kind, r.cancelled_by_id, r.cancelled_by_label ?? "") : null,
  cancelReason: r.cancel_reason,
});

/* ---------- Loading ---------- */

type Queryable = Pick<PoolClient, "query">;

async function rows<T>(c: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(text, params)).rows as T[];
}

async function loadState(c: Queryable, since: Date): Promise<ClubState> {
  // One query at a time: a single connection runs them in order anyway.
  const households = await rows<HouseholdRow>(c, `select id, display_name, membership_type, status, joined_on, ended_on, quickbooks_id, notes from club.households order by seq`);
  const members = await rows<MemberRow>(c, `select id, household_id, first_name, last_name, email, phone, role, status, brivo_credential_id, mailchimp_contact_id, login_id from club.members order by seq`);
  const qualifications = await rows<Qualification>(c, `select code, name, track, rank from club.qualifications order by code`);
  const memberQualifications = await rows<MemberQualificationRow>(c, `select member_id, qualification_code, granted_by_label, granted_at from club.member_qualifications order by seq`);
  const history = await rows<HistoryRow>(c, `select id, household_id, at, kind, summary, actor_kind, actor_id, actor_label, details from club.household_history order by seq`);
  const items = await rows<ItemRow>(c, `select id, name, class_code, rule_overrides, qualification_mode, required_qualification from club.items order by seq`);
  const oos = await rows<OutOfServiceRow>(c, `select id, item_id, from_at, until_at, reason, expected_return, created_by_kind, created_by_label, created_at from club.out_of_service order by seq`);
  const bookingRows = await rows<BookingRow>(
    c,
    `select id, item_id, booker_id, starts_at, ends_at, status, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at,
            cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason, override_reason, override_by_label, override_waived
       from club.bookings where ends_at > $1 order by seq`,
    [since.toISOString()],
  );
  const classes = await rows<ClassRow>(c, `select id, name, description, instructor, default_capacity, default_minutes, room_item_id, rules from club.classes order by seq`);
  const sessionRows = await rows<SessionRow>(
    c,
    `select id, class_id, room_item_id, starts_at, ends_at, capacity, status, created_at, created_by_kind, created_by_label, status_changed_at, cancelled_by_kind, cancelled_by_label, cancel_reason
       from club.class_sessions where ends_at > $1 order by seq`,
    [since.toISOString()],
  );
  const signUpRows =
    sessionRows.length === 0
      ? []
      : await rows<SignUpRow>(
          c,
          `select id, session_id, member_id, status, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at, promoted_at, cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason
             from club.class_signups where session_id = any($1) order by seq`,
          [sessionRows.map((x) => x.id)],
        );
  const crew = bookingRows.length === 0 ? [] : await rows<CrewRow>(c, `select booking_id, member_id, position, removed_at, removed_reason from club.booking_crew where booking_id = any($1)`, [bookingRows.map((b) => b.id)]);
  return {
    households: households.map(toHousehold),
    members: members.map(toMember),
    qualifications,
    memberQualifications: memberQualifications.map((q): MemberQualification => ({ memberId: q.member_id, code: q.qualification_code, grantedBy: { kind: "staff", label: q.granted_by_label }, grantedAt: iso(q.granted_at) })),
    history: history.map(toHistory),
    items: items.map(toItem),
    outOfService: oos.map(toOutOfService),
    bookings: bookingRows.map((b) => toBooking(b, crew)),
    classes: classes.map(toClass),
    sessions: sessionRows.map(toSession),
    signups: signUpRows.map(toSignUp),
  };
}

/* ---------- Saving ---------- */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What is new and what changed between two copies of one kind of record. */
function compare<T extends { id: string }>(label: string, before: T[], after: T[]): { added: T[]; updated: T[] } {
  const old = new Map(before.map((x) => [x.id, x]));
  const now = new Set(after.map((x) => x.id));
  for (const id of old.keys()) if (!now.has(id)) throw new Error(`The club database store never deletes ${label}.`);
  return { added: after.filter((x) => !old.has(x.id)), updated: after.filter((x) => old.has(x.id) && !same(old.get(x.id), x)) };
}

async function save(c: PoolClient, before: ClubState, after: ClubState): Promise<void> {
  const run = (text: string, params: unknown[]) => c.query(text, params);

  const hh = compare("households", before.households, after.households);
  for (const h of hh.added) {
    await run(`insert into club.households (id, display_name, membership_type, status, joined_on, ended_on, quickbooks_id, notes) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [h.id, h.displayName, h.membershipType, h.status, h.joinedOn, h.endedOn, h.quickbooksId, h.notes]);
  }

  const mm = compare("members", before.members, after.members);
  for (const m of mm.added) {
    await run(
      `insert into club.members (id, household_id, first_name, last_name, email, phone, role, status, brivo_credential_id, mailchimp_contact_id, login_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [m.id, m.householdId, m.firstName, m.lastName, m.email, m.phone, m.role, m.status, m.brivoCredentialId, m.mailchimpContactId, m.loginId],
    );
  }
  // Adults who stop being active go first, so a replacement primary never briefly makes two.
  for (const m of [...mm.updated.filter((x) => x.status !== "active"), ...mm.updated.filter((x) => x.status === "active")]) {
    await run(
      `update club.members set first_name=$2, last_name=$3, email=$4, phone=$5, role=$6, status=$7, brivo_credential_id=$8, mailchimp_contact_id=$9, login_id=$10 where id=$1`,
      [m.id, m.firstName, m.lastName, m.email, m.phone, m.role, m.status, m.brivoCredentialId, m.mailchimpContactId, m.loginId],
    );
  }
  // A household is only marked ended once none of its adults are active, so it is saved after them.
  for (const h of hh.updated) {
    await run(`update club.households set display_name=$2, membership_type=$3, status=$4, joined_on=$5, ended_on=$6, quickbooks_id=$7, notes=$8 where id=$1`, [h.id, h.displayName, h.membershipType, h.status, h.joinedOn, h.endedOn, h.quickbooksId, h.notes]);
  }

  const knownQualifications = new Set(before.memberQualifications.map((q) => `${q.memberId}:${q.code}`));
  const afterQualifications = new Set(after.memberQualifications.map((q) => `${q.memberId}:${q.code}`));
  for (const k of knownQualifications) if (!afterQualifications.has(k)) throw new Error("The club database store never deletes qualifications.");
  for (const q of after.memberQualifications) {
    if (knownQualifications.has(`${q.memberId}:${q.code}`)) continue;
    await run(`insert into club.member_qualifications (member_id, qualification_code, granted_by_kind, granted_by_label, granted_at) values ($1,$2,'staff',$3,$4)`, [q.memberId, q.code, q.grantedBy.label, q.grantedAt]);
  }

  const hist = compare("history lines", before.history, after.history);
  if (hist.updated.length > 0) throw new Error("A household's history can only be added to, never changed.");
  for (const e of hist.added) {
    await run(`insert into club.household_history (id, household_id, at, kind, summary, actor_kind, actor_id, actor_label, details) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [e.id, e.householdId, e.at, e.kind, e.summary, e.actor.kind, actorId(e.actor), e.actor.label, JSON.stringify(e.details)]);
  }

  const itemSql = (i: Item) => [i.name, i.classCode, JSON.stringify(i.ruleOverrides), i.requiredQualification === undefined ? "class" : i.requiredQualification === null ? "none" : "code", i.requiredQualification ?? null];
  const ii = compare("items", before.items, after.items);
  for (const i of ii.added) await run(`insert into club.items (id, name, class_code, rule_overrides, qualification_mode, required_qualification) values ($1,$2,$3,$4,$5,$6)`, [i.id, ...itemSql(i)]);
  for (const i of ii.updated) await run(`update club.items set name=$2, class_code=$3, rule_overrides=$4, qualification_mode=$5, required_qualification=$6 where id=$1`, [i.id, ...itemSql(i)]);

  const oo = compare("out-of-service entries", before.outOfService, after.outOfService);
  for (const p of oo.added) {
    await run(`insert into club.out_of_service (id, item_id, from_at, until_at, reason, expected_return, created_by_kind, created_by_label, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.id, p.itemId, p.from, p.until, p.reason, p.expectedReturn, p.createdBy.kind, p.createdBy.label, p.createdAt]);
  }
  for (const p of oo.updated) await run(`update club.out_of_service set until_at=$2, reason=$3, expected_return=$4 where id=$1`, [p.id, p.until, p.reason, p.expectedReturn]);

  const bb = compare("bookings", before.bookings, after.bookings);
  for (const b of bb.added) {
    await run(
      `insert into club.bookings (id, item_id, booker_id, starts_at, ends_at, status, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at,
                                  cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason, override_reason, override_by_label, override_waived)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        b.id, b.itemId, b.bookerId, b.startsAt, b.endsAt, b.status, b.createdAt, b.createdBy.kind, actorId(b.createdBy), b.createdBy.label, b.statusChangedAt,
        b.cancelledBy?.kind ?? null, b.cancelledBy ? actorId(b.cancelledBy) : null, b.cancelledBy?.label ?? null, b.cancelReason,
        b.override?.reason ?? null, b.override?.actor.label ?? null, b.override?.waived ?? null,
      ],
    );
  }
  for (const b of bb.updated) {
    await run(`update club.bookings set status=$2, status_changed_at=$3, cancelled_by_kind=$4, cancelled_by_id=$5, cancelled_by_label=$6, cancel_reason=$7 where id=$1`, [b.id, b.status, b.statusChangedAt, b.cancelledBy?.kind ?? null, b.cancelledBy ? actorId(b.cancelledBy) : null, b.cancelledBy?.label ?? null, b.cancelReason]);
  }

  // Crew seats: new seats are added; a seat given up is marked removed (never deleted), keeping the record.
  const before_ = new Map(before.bookings.map((b) => [b.id, b]));
  for (const b of [...bb.added, ...bb.updated]) {
    const old = before_.get(b.id);
    const hadActive = new Set(old?.crew ?? []);
    const hadRemoved = new Set((old?.removedCrew ?? []).map((r) => r.memberId));
    for (const [position, memberId] of b.crew.entries()) {
      if (!hadActive.has(memberId) && !hadRemoved.has(memberId)) await run(`insert into club.booking_crew (booking_id, member_id, position) values ($1,$2,$3)`, [b.id, memberId, position]);
    }
    for (const r of b.removedCrew) {
      if (hadRemoved.has(r.memberId)) continue;
      if (hadActive.has(r.memberId)) await run(`update club.booking_crew set removed_at=$3, removed_reason=$4 where booking_id=$1 and member_id=$2`, [b.id, r.memberId, r.at, r.reason]);
      else await run(`insert into club.booking_crew (booking_id, member_id, position, removed_at, removed_reason) values ($1,$2,$3,$4,$5)`, [b.id, r.memberId, b.crew.length, r.at, r.reason]);
    }
  }

  // Classes, their dated sessions, and the sign-up sheets.
  const cc = compare("classes", before.classes, after.classes);
  const classSql = (k: ClassTemplate) => [k.name, k.description, k.instructor, k.defaultCapacity, k.defaultMinutes, k.roomItemId, JSON.stringify(k.rules)];
  for (const k of cc.added) await run(`insert into club.classes (id, name, description, instructor, default_capacity, default_minutes, room_item_id, rules) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [k.id, ...classSql(k)]);
  for (const k of cc.updated) await run(`update club.classes set name=$2, description=$3, instructor=$4, default_capacity=$5, default_minutes=$6, room_item_id=$7, rules=$8 where id=$1`, [k.id, ...classSql(k)]);

  const ss = compare("class sessions", before.sessions, after.sessions);
  for (const x of ss.added) {
    await run(
      `insert into club.class_sessions (id, class_id, room_item_id, starts_at, ends_at, capacity, status, created_at, created_by_kind, created_by_label, status_changed_at, cancelled_by_kind, cancelled_by_label, cancel_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [x.id, x.classId, x.roomItemId, x.startsAt, x.endsAt, x.capacity, x.status, x.createdAt, x.createdBy.kind, x.createdBy.label, x.statusChangedAt, x.cancelledBy?.kind ?? null, x.cancelledBy?.label ?? null, x.cancelReason],
    );
  }
  for (const x of ss.updated) {
    await run(`update club.class_sessions set capacity=$2, status=$3, status_changed_at=$4, cancelled_by_kind=$5, cancelled_by_label=$6, cancel_reason=$7 where id=$1`, [x.id, x.capacity, x.status, x.statusChangedAt, x.cancelledBy?.kind ?? null, x.cancelledBy?.label ?? null, x.cancelReason]);
  }

  // Sign-ups. Anyone leaving a chair is saved before anyone moving into one, so a class is never briefly over-full.
  const gg = compare("class sign-ups", before.signups, after.signups);
  const updateSignUp = (g: SignUp) =>
    run(`update club.class_signups set status=$2, status_changed_at=$3, promoted_at=$4, cancelled_by_kind=$5, cancelled_by_id=$6, cancelled_by_label=$7, cancel_reason=$8 where id=$1`, [
      g.id, g.status, g.statusChangedAt, g.promotedAt, g.cancelledBy?.kind ?? null, g.cancelledBy ? actorId(g.cancelledBy) : null, g.cancelledBy?.label ?? null, g.cancelReason,
    ]);
  for (const g of gg.updated.filter((x) => x.status !== "enrolled")) await updateSignUp(g);
  for (const g of gg.added) {
    await run(
      `insert into club.class_signups (id, session_id, member_id, status, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at, promoted_at, cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [g.id, g.sessionId, g.memberId, g.status, g.createdAt, g.createdBy.kind, actorId(g.createdBy), g.createdBy.label, g.statusChangedAt, g.promotedAt, g.cancelledBy?.kind ?? null, g.cancelledBy ? actorId(g.cancelledBy) : null, g.cancelledBy?.label ?? null, g.cancelReason],
    );
  }
  for (const g of gg.updated.filter((x) => x.status === "enrolled")) await updateSignUp(g);
}

/** A database refusal turned into the plain sentence a member can act on. Anything else passes through. */
export function translateDatabaseError(e: unknown): unknown {
  if (e instanceof ClubError) return e;
  const code = (e as { code?: string } | null)?.code;
  if (code === "23P01") return new ClubError("conflict", "That time was just taken by someone else. Pick another.");
  if (code === "40001" || code === "40P01") return new ClubError("conflict", "A lot of changes arrived at once. Please try again.");
  // The class guards in the database are worded for members already; only those sentences are passed on.
  const { message, constraint } = (e ?? {}) as { message?: string; constraint?: string };
  if (code === "23514" && message && /^(That class is full|That class was cancelled|Chairs cannot go below)/.test(message)) return new ClubError("conflict", message);
  if (code === "23505" && constraint === "class_signups_one_live") return new ClubError("conflict", "That person is already on this class's sign-up sheet.");
  return e;
}

/* ---------- The store ---------- */

export class PgClubStore implements ClubStore {
  private newId: () => string;
  private historyDays: number;
  private clock: () => Date;

  constructor(
    private pool: Pool,
    options: PgStoreOptions = {},
  ) {
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.historyDays = options.historyDays ?? DEFAULT_HISTORY_DAYS;
    this.clock = options.now ?? (() => new Date());
  }

  private since(): Date {
    return new Date(this.clock().getTime() - this.historyDays * 86400000);
  }

  /** A consistent snapshot: every table is read as of the same instant. */
  async read(): Promise<ClubState> {
    const c = await this.pool.connect();
    try {
      await c.query("begin isolation level repeatable read read only");
      const state = await loadState(c, this.since());
      await c.query("commit");
      return state;
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async transaction<T>(fn: (state: ClubState, newId: () => string) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      // Changes take turns. This lock is held until the transaction ends and is shared by every app server.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [WRITERS_LOCK]);
      const before = await loadState(c, this.since());
      const draft = structuredClone(before);
      const result = await fn(draft, this.newId);
      await save(c, before, draft);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw translateDatabaseError(e);
    } finally {
      c.release();
    }
  }

  /**
   * Makes the rule tables match the rules file (booking-rules.json), which is the source of truth until the staff
   * screen in step 5 edits them directly. Items point at these classes, so they must exist first.
   */
  async syncRules(book: RuleBook, classRules?: ClassRules): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [WRITERS_LOCK]);
      await c.query(`insert into club.booking_rule_defaults (id, placeholder, rules) values (true, $1, $2) on conflict (id) do update set placeholder = excluded.placeholder, rules = excluded.rules`, [book.placeholder, JSON.stringify(book.defaults)]);
      for (const k of book.classes) {
        await c.query(
          `insert into club.item_classes (code, booking_type, name, seats, required_qualification, rules) values ($1,$2,$3,$4,$5,$6)
           on conflict (code) do update set booking_type = excluded.booking_type, name = excluded.name, seats = excluded.seats, required_qualification = excluded.required_qualification, rules = excluded.rules`,
          [k.code, k.type, k.name, k.seats, k.requiredQualification, JSON.stringify(k.rules)],
        );
      }
      if (classRules) {
        await c.query(`insert into club.class_rule_defaults (id, placeholder, rules) values (true, $1, $2) on conflict (id) do update set placeholder = excluded.placeholder, rules = excluded.rules`, [classRules.placeholder, JSON.stringify(classRules.defaults)]);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /**
   * Runs `seed` against this database only if it holds no households at all, and only one app server at a time.
   * For the invented sample club in development and tests; it never touches a database that already has members.
   */
  async seedIfEmpty(seed: (store: PgClubStore) => Promise<void>): Promise<boolean> {
    const c = await this.pool.connect();
    try {
      await c.query("select pg_advisory_lock(hashtextextended($1, 0))", [SEED_LOCK]);
      try {
        const { rows } = await c.query("select exists (select 1 from club.households) as any");
        if (rows[0].any) return false;
        await seed(this);
        return true;
      } finally {
        await c.query("select pg_advisory_unlock(hashtextextended($1, 0))", [SEED_LOCK]);
      }
    } finally {
      c.release();
    }
  }

  /** A second view of the same database with its own ID source (the sample club wants fixed IDs while it is seeded). */
  withIds(newId: () => string): PgClubStore {
    return new PgClubStore(this.pool, { newId, historyDays: this.historyDays, now: this.clock });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
