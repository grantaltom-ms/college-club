import { Pool, types as pgTypes, type PoolClient } from "pg";
import { assertNotHosted } from "../db/guard";
import { ClubError } from "../errors";
import type {
  BoatAccess,
  BoatAccessKind,
  Actor,
  AttendanceEntry,
  AttendanceKind,
  AttendanceOutcome,
  AttendanceVia,
  BillingKind,
  BillingLine,
  BillingRun,
  Booking,
  BookingStatus,
  Charge,
  ChargeStatus,
  ClassRules,
  ClassRuleValues,
  ClassSession,
  ClassTemplate,
  ClubState,
  DamageLogEntry,
  DamageLogKind,
  DamagePriority,
  DamageReport,
  DamageStatus,
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
  VisitorEntry,
  VisitStatus,
  VisitVia,
  ClubEvent,
  EventRules,
  Rsvp,
  RsvpStatus,
  RsvpVia,
} from "../types";
import { addDays, pacificDate, pacificDayStart } from "../time";
import type { ClubStore, Settler } from "./memory";

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

/** How many of the most recent closed months have their invoice lines loaded (so an old month's file can still be downloaded). */
const BILLING_MONTHS_LOADED = 24;

export interface PgStoreOptions {
  newId?: () => string;
  /** How many days of finished bookings to load. */
  historyDays?: number;
  /** The store's idea of "now", used only to decide how far back to load. */
  now?: () => Date;
  /** Applied to what readers see and, inside every change, to the working copy (see Settler). */
  settle?: Settler;
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
interface ItemRow { id: string; name: string; class_code: string; rule_overrides: Partial<RuleValues>; qualification_mode: "class" | "none" | "code"; required_qualification: string | null; is_private: boolean; places: number }
interface BoatAccessRow { id: string; item_id: string; member_id: string; kind: BoatAccessKind; added_at: Date; added_by_kind: string; added_by_id: string | null; added_by_label: string; ended_at: Date | null; ended_by_kind: string | null; ended_by_id: string | null; ended_by_label: string | null; ended_reason: string | null }
interface DamageReportRow { id: string; item_id: string; reported_by_kind: string; reported_by_id: string | null; reported_by_label: string; reported_at: Date; description: string; location: string; how_it_happened: string; major: boolean; priority: number; status: DamageStatus; updated_at: Date; assigned_to: string | null; closed_at: Date | null; repaired_on: string | null; repaired_by: string | null; repair_minutes: number | null; cost_cents: number | null; repair_notes: string | null; dismissed_reason: string | null }
interface DamageLogRow { id: string; report_id: string; at: Date; kind: DamageLogKind; by_kind: string; by_id: string | null; by_label: string; text: string }
interface OutOfServiceRow { id: string; item_id: string; from_at: Date; until_at: Date | null; reason: string; expected_return: string | null; created_by_kind: string; created_by_label: string; created_at: Date }
interface BookingRow { id: string; item_id: string; booker_id: string; starts_at: Date; ends_at: Date; status: BookingStatus; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; status_changed_at: Date; cancelled_by_kind: string | null; cancelled_by_id: string | null; cancelled_by_label: string | null; cancel_reason: string | null; override_reason: string | null; override_by_label: string | null; override_waived: string[] | null }
interface ClassRow { id: string; name: string; description: string; instructor: string; default_capacity: number; default_minutes: number; room_item_id: string | null; rules: Partial<ClassRuleValues> }
interface SessionRow { id: string; class_id: string; room_item_id: string | null; starts_at: Date; ends_at: Date; capacity: number; status: SessionStatus; created_at: Date; created_by_kind: string; created_by_label: string; status_changed_at: Date; cancelled_by_kind: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface SignUpRow { id: string; session_id: string; member_id: string; status: SignUpStatus; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; status_changed_at: Date; promoted_at: Date | null; cancelled_by_kind: string | null; cancelled_by_id: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface EventRow { id: string; title: string; description: string; location: string; starts_at: Date; ends_at: Date; capacity: number | null; price_cents: number | null; reply_by: Date | null; status: ClubEvent["status"]; created_at: Date; created_by_kind: string; created_by_label: string; status_changed_at: Date; cancelled_by_kind: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface RsvpRow { id: string; event_id: string; member_id: string; guests: number; status: RsvpStatus; price_cents: number | null; via: RsvpVia; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; status_changed_at: Date; promoted_at: Date | null; hold_until: Date | null; cancelled_by_kind: string | null; cancelled_by_id: string | null; cancelled_by_label: string | null; cancel_reason: string | null }
interface AttendanceRow { id: string; kind: AttendanceKind; booking_id: string | null; signup_id: string | null; rsvp_id: string | null; member_id: string; at: Date; outcome: AttendanceOutcome; previous_outcome: AttendanceOutcome | null; by_kind: string; by_id: string | null; by_label: string; via: AttendanceVia; note: string | null }
interface ChargeRow { id: string; household_id: string; member_id: string | null; day: string; category: BillingKind; adjustment: boolean; amount_cents: number; description: string; created_at: Date; created_by_label: string; status: ChargeStatus; voided_at: Date | null; voided_by_label: string | null; void_reason: string | null }
interface VisitorRow { id: string; member_id: string; day: string; visitors: number; created_at: Date; created_by_kind: string; created_by_id: string | null; created_by_label: string; via: VisitVia; status: VisitStatus; voided_at: Date | null; voided_by_label: string | null; void_reason: string | null }
interface RunRow { id: string; month: string; created_at: Date; created_by_label: string; invoice_count: number; total_cents: string | number }
interface LineRow { id: string; run_id: string; household_id: string; invoice_no: string; kind: BillingKind; description: string; quantity: number; unit_cents: number; amount_cents: number; taxable: boolean; adjustment: boolean }
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
  if (r.is_private) item.isPrivate = true;
  if (r.places > 1) item.places = r.places;
  return item;
}

const toBoatAccess = (r: BoatAccessRow): BoatAccess => ({
  id: r.id,
  itemId: r.item_id,
  memberId: r.member_id,
  kind: r.kind,
  addedAt: iso(r.added_at),
  addedBy: actorFrom(r.added_by_kind, r.added_by_id, r.added_by_label),
  endedAt: r.ended_at ? iso(r.ended_at) : null,
  endedBy: r.ended_by_kind ? actorFrom(r.ended_by_kind, r.ended_by_id, r.ended_by_label ?? "") : null,
  endedReason: r.ended_reason,
});

const toDamageReport = (r: DamageReportRow): DamageReport => ({
  id: r.id,
  itemId: r.item_id,
  reportedBy: actorFrom(r.reported_by_kind, r.reported_by_id, r.reported_by_label),
  reportedAt: iso(r.reported_at),
  description: r.description,
  location: r.location,
  howItHappened: r.how_it_happened,
  major: r.major,
  priority: r.priority as DamagePriority,
  status: r.status,
  updatedAt: iso(r.updated_at),
  assignedTo: r.assigned_to,
  closedAt: r.closed_at ? iso(r.closed_at) : null,
  repairedOn: r.repaired_on,
  repairedBy: r.repaired_by,
  repairMinutes: r.repair_minutes,
  costCents: r.cost_cents,
  repairNotes: r.repair_notes,
  dismissedReason: r.dismissed_reason,
});

const toDamageLog = (r: DamageLogRow): DamageLogEntry => ({ id: r.id, reportId: r.report_id, at: iso(r.at), kind: r.kind, by: actorFrom(r.by_kind, r.by_id, r.by_label), text: r.text });

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

const toEvent = (r: EventRow): ClubEvent => ({
  id: r.id,
  title: r.title,
  description: r.description,
  location: r.location,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  capacity: r.capacity,
  priceCents: r.price_cents,
  replyBy: r.reply_by ? iso(r.reply_by) : null,
  status: r.status,
  createdAt: iso(r.created_at),
  createdBy: actorFrom(r.created_by_kind, null, r.created_by_label),
  statusChangedAt: iso(r.status_changed_at),
  cancelledBy: r.cancelled_by_kind ? actorFrom(r.cancelled_by_kind, null, r.cancelled_by_label ?? "") : null,
  cancelReason: r.cancel_reason,
});

const toRsvp = (r: RsvpRow): Rsvp => ({
  id: r.id,
  eventId: r.event_id,
  memberId: r.member_id,
  guests: r.guests,
  status: r.status,
  priceCents: r.price_cents,
  via: r.via,
  createdAt: iso(r.created_at),
  createdBy: actorFrom(r.created_by_kind, r.created_by_id, r.created_by_label),
  statusChangedAt: iso(r.status_changed_at),
  promotedAt: r.promoted_at ? iso(r.promoted_at) : null,
  holdUntil: r.hold_until ? iso(r.hold_until) : null,
  cancelledBy: r.cancelled_by_kind ? actorFrom(r.cancelled_by_kind, r.cancelled_by_id, r.cancelled_by_label ?? "") : null,
  cancelReason: r.cancel_reason,
});

const toAttendance = (r: AttendanceRow): AttendanceEntry => ({
  id: r.id,
  kind: r.kind,
  recordId: (r.booking_id ?? r.signup_id ?? r.rsvp_id)!,
  memberId: r.member_id,
  at: iso(r.at),
  outcome: r.outcome,
  previous: r.previous_outcome,
  by: actorFrom(r.by_kind, r.by_id, r.by_label),
  via: r.via,
  note: r.note,
});

const toCharge = (r: ChargeRow): Charge => ({
  id: r.id,
  householdId: r.household_id,
  memberId: r.member_id,
  day: r.day,
  category: r.category,
  adjustment: r.adjustment,
  amountCents: r.amount_cents,
  description: r.description,
  createdAt: iso(r.created_at),
  createdBy: { kind: "staff", label: r.created_by_label },
  status: r.status,
  voidedAt: r.voided_at ? iso(r.voided_at) : null,
  voidedBy: r.voided_by_label ? { kind: "staff", label: r.voided_by_label } : null,
  voidReason: r.void_reason,
});

const toVisitor = (r: VisitorRow): VisitorEntry => ({
  id: r.id,
  memberId: r.member_id,
  day: r.day,
  visitors: r.visitors,
  createdAt: iso(r.created_at),
  createdBy: actorFrom(r.created_by_kind, r.created_by_id, r.created_by_label),
  via: r.via,
  status: r.status,
  voidedAt: r.voided_at ? iso(r.voided_at) : null,
  voidedBy: r.voided_by_label ? { kind: "staff", label: r.voided_by_label } : null,
  voidReason: r.void_reason,
});

const toRun = (r: RunRow): BillingRun => ({ id: r.id, month: r.month, createdAt: iso(r.created_at), createdBy: { kind: "staff", label: r.created_by_label }, invoiceCount: r.invoice_count, totalCents: Number(r.total_cents) });

const toLine = (r: LineRow): BillingLine => ({
  id: r.id,
  runId: r.run_id,
  householdId: r.household_id,
  invoiceNo: r.invoice_no,
  kind: r.kind,
  description: r.description,
  quantity: r.quantity,
  unitCents: r.unit_cents,
  amountCents: r.amount_cents,
  taxable: r.taxable,
  adjustment: r.adjustment,
});

/* ---------- Loading ---------- */

type Queryable = Pick<PoolClient, "query">;

async function rows<T>(c: Queryable, text: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(text, params)).rows as T[];
}

async function loadState(c: Queryable, historyStart: Date): Promise<ClubState> {
  // Months that have not been billed yet must always be fully loaded, however long ago they were, so a late billing run
  // never misses an old event ticket or charge. A month is "unbilled" if it comes after the last closed one.
  const [{ month: lastBilled }] = await rows<{ month: string | null }>(c, `select max(month) as month from club.billing_runs`);
  let since = historyStart;
  if (lastBilled) {
    const unbilledFrom = addDays(`${lastBilled}-01`, 32).slice(0, 7) + "-01";
    const floor = new Date(pacificDayStart(unbilledFrom).getTime() - 86400000);
    if (floor < since) since = floor;
  }
  const sinceDay = pacificDate(since);
  // One query at a time: a single connection runs them in order anyway.
  const households = await rows<HouseholdRow>(c, `select id, display_name, membership_type, status, joined_on, ended_on, quickbooks_id, notes from club.households order by seq`);
  const members = await rows<MemberRow>(c, `select id, household_id, first_name, last_name, email, phone, role, status, brivo_credential_id, mailchimp_contact_id, login_id from club.members order by seq`);
  const qualifications = await rows<Qualification>(c, `select code, name, track, rank from club.qualifications order by code`);
  const memberQualifications = await rows<MemberQualificationRow>(c, `select member_id, qualification_code, granted_by_label, granted_at from club.member_qualifications order by seq`);
  const history = await rows<HistoryRow>(c, `select id, household_id, at, kind, summary, actor_kind, actor_id, actor_label, details from club.household_history order by seq`);
  const items = await rows<ItemRow>(c, `select id, name, class_code, rule_overrides, qualification_mode, required_qualification, is_private, places from club.items order by seq`);
  const access = await rows<BoatAccessRow>(c, `select id, item_id, member_id, kind, added_at, added_by_kind, added_by_id, added_by_label, ended_at, ended_by_kind, ended_by_id, ended_by_label, ended_reason from club.item_access order by seq`);
  const damage = await rows<DamageReportRow>(
    c,
    `select id, item_id, reported_by_kind, reported_by_id, reported_by_label, reported_at, description, location, how_it_happened, major, priority, status, updated_at, assigned_to, closed_at,
            repaired_on, repaired_by, repair_minutes, cost_cents, repair_notes, dismissed_reason
       from club.damage_reports order by seq`,
  );
  const damageLog = await rows<DamageLogRow>(c, `select id, report_id, at, kind, by_kind, by_id, by_label, text from club.damage_log order by seq`);
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
  const eventRows = await rows<EventRow>(
    c,
    `select id, title, description, location, starts_at, ends_at, capacity, price_cents, reply_by, status, created_at, created_by_kind, created_by_label, status_changed_at, cancelled_by_kind, cancelled_by_label, cancel_reason
       from club.events where ends_at > $1 order by seq`,
    [since.toISOString()],
  );
  const rsvpRows =
    eventRows.length === 0
      ? []
      : await rows<RsvpRow>(
          c,
          `select id, event_id, member_id, guests, status, price_cents, via, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at, promoted_at, hold_until, cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason
             from club.event_rsvps where event_id = any($1) order by seq`,
          [eventRows.map((x) => x.id)],
        );
  const attendanceRows =
    bookingRows.length + signUpRows.length + rsvpRows.length === 0
      ? []
      : await rows<AttendanceRow>(
          c,
          `select id, kind, booking_id, signup_id, rsvp_id, member_id, at, outcome, previous_outcome, by_kind, by_id, by_label, via, note
             from club.attendance_log where booking_id = any($1) or signup_id = any($2) or rsvp_id = any($3) order by seq`,
          [bookingRows.map((x) => x.id), signUpRows.map((x) => x.id), rsvpRows.map((x) => x.id)],
        );
  const chargeRows = await rows<ChargeRow>(
    c,
    `select id, household_id, member_id, day, category, adjustment, amount_cents, description, created_at, created_by_label, status, voided_at, voided_by_label, void_reason
       from club.charges where day >= $1 order by seq`,
    [sinceDay],
  );
  const visitorRows = await rows<VisitorRow>(
    c,
    `select id, member_id, day, visitors, created_at, created_by_kind, created_by_id, created_by_label, via, status, voided_at, voided_by_label, void_reason
       from club.visitor_entries where day >= $1 order by seq`,
    [sinceDay],
  );
  const runRows = await rows<RunRow>(c, `select id, month, created_at, created_by_label, invoice_count, total_cents from club.billing_runs order by month`);
  const lineRows = await rows<LineRow>(
    c,
    `select id, run_id, household_id, invoice_no, kind, description, quantity, unit_cents, amount_cents, taxable, adjustment
       from club.billing_lines where run_id in (select id from club.billing_runs order by month desc limit $1) order by seq`,
    [BILLING_MONTHS_LOADED],
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
    boatAccess: access.map(toBoatAccess),
    damageReports: damage.map(toDamageReport),
    damageLog: damageLog.map(toDamageLog),
    bookings: bookingRows.map((b) => toBooking(b, crew)),
    classes: classes.map(toClass),
    sessions: sessionRows.map(toSession),
    signups: signUpRows.map(toSignUp),
    events: eventRows.map(toEvent),
    rsvps: rsvpRows.map(toRsvp),
    attendance: attendanceRows.map(toAttendance),
    charges: chargeRows.map(toCharge),
    visitors: visitorRows.map(toVisitor),
    billingRuns: runRows.map(toRun),
    billingLines: lineRows.map(toLine),
    dataSince: since.toISOString(),
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

  const itemSql = (i: Item) => [i.name, i.classCode, JSON.stringify(i.ruleOverrides), i.requiredQualification === undefined ? "class" : i.requiredQualification === null ? "none" : "code", i.requiredQualification ?? null, i.isPrivate === true, i.places ?? 1];
  const ii = compare("items", before.items, after.items);
  for (const i of ii.added) await run(`insert into club.items (id, name, class_code, rule_overrides, qualification_mode, required_qualification, is_private, places) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [i.id, ...itemSql(i)]);
  for (const i of ii.updated) await run(`update club.items set name=$2, class_code=$3, rule_overrides=$4, qualification_mode=$5, required_qualification=$6, is_private=$7, places=$8 where id=$1`, [i.id, ...itemSql(i)]);

  // Who may use each private boat. Lines are only added and ended, never removed. They go in before any booking that relies on them.
  const aa = compare("boat access lines", before.boatAccess, after.boatAccess);
  // Lines are ended before new ones go in, so someone made an owner in the same change that ends their invitation is never on the list twice.
  for (const a of aa.updated) {
    await run(`update club.item_access set ended_at=$2, ended_by_kind=$3, ended_by_id=$4, ended_by_label=$5, ended_reason=$6 where id=$1`, [a.id, a.endedAt, a.endedBy?.kind ?? null, a.endedBy ? actorId(a.endedBy) : null, a.endedBy?.label ?? null, a.endedReason]);
  }
  for (const a of aa.added) {
    await run(
      `insert into club.item_access (id, item_id, member_id, kind, added_at, added_by_kind, added_by_id, added_by_label, ended_at, ended_by_kind, ended_by_id, ended_by_label, ended_reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [a.id, a.itemId, a.memberId, a.kind, a.addedAt, a.addedBy.kind, actorId(a.addedBy), a.addedBy.label, a.endedAt, a.endedBy?.kind ?? null, a.endedBy ? actorId(a.endedBy) : null, a.endedBy?.label ?? null, a.endedReason],
    );
  }

  const oo = compare("out-of-service entries", before.outOfService, after.outOfService);
  for (const p of oo.added) {
    await run(`insert into club.out_of_service (id, item_id, from_at, until_at, reason, expected_return, created_by_kind, created_by_label, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.id, p.itemId, p.from, p.until, p.reason, p.expectedReturn, p.createdBy.kind, p.createdBy.label, p.createdAt]);
  }
  for (const p of oo.updated) await run(`update club.out_of_service set until_at=$2, reason=$3, expected_return=$4 where id=$1`, [p.id, p.until, p.reason, p.expectedReturn]);

  // Damage reports: filed once, then triaged and closed (never removed), and a log of everything that happened, only ever added to.
  // The log goes in after the reports, because each line points at a report; the database checks the pair at the end of the change.
  const dr = compare("damage reports", before.damageReports, after.damageReports);
  for (const x of dr.added) {
    await run(
      `insert into club.damage_reports (id, item_id, reported_by_kind, reported_by_id, reported_by_label, reported_at, description, location, how_it_happened, major, priority, status, updated_at, assigned_to, closed_at,
                                       repaired_on, repaired_by, repair_minutes, cost_cents, repair_notes, dismissed_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
      [x.id, x.itemId, x.reportedBy.kind, actorId(x.reportedBy), x.reportedBy.label, x.reportedAt, x.description, x.location, x.howItHappened, x.major, x.priority, x.status, x.updatedAt, x.assignedTo, x.closedAt, x.repairedOn, x.repairedBy, x.repairMinutes, x.costCents, x.repairNotes, x.dismissedReason],
    );
  }
  for (const x of dr.updated) {
    await run(
      `update club.damage_reports set priority=$2, status=$3, updated_at=$4, assigned_to=$5, closed_at=$6, repaired_on=$7, repaired_by=$8, repair_minutes=$9, cost_cents=$10, repair_notes=$11, dismissed_reason=$12 where id=$1`,
      [x.id, x.priority, x.status, x.updatedAt, x.assignedTo, x.closedAt, x.repairedOn, x.repairedBy, x.repairMinutes, x.costCents, x.repairNotes, x.dismissedReason],
    );
  }
  const dl = compare("damage report log lines", before.damageLog, after.damageLog);
  if (dl.updated.length > 0) throw new Error("A damage report's log can only be added to, never changed.");
  for (const l of dl.added) {
    await run(`insert into club.damage_log (id, report_id, at, kind, by_kind, by_id, by_label, text) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [l.id, l.reportId, l.at, l.kind, l.by.kind, actorId(l.by), l.by.label, l.text]);
  }

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

  // Events, then their RSVPs. A limit is raised before anyone moves in, and places are given up before they are taken.
  const ee = compare("events", before.events, after.events);
  for (const x of ee.added) {
    await run(
      `insert into club.events (id, title, description, location, starts_at, ends_at, capacity, price_cents, reply_by, status, created_at, created_by_kind, created_by_label, status_changed_at, cancelled_by_kind, cancelled_by_label, cancel_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [x.id, x.title, x.description, x.location, x.startsAt, x.endsAt, x.capacity, x.priceCents, x.replyBy, x.status, x.createdAt, x.createdBy.kind, x.createdBy.label, x.statusChangedAt, x.cancelledBy?.kind ?? null, x.cancelledBy?.label ?? null, x.cancelReason],
    );
  }
  for (const x of ee.updated) {
    await run(
      `update club.events set title=$2, description=$3, location=$4, starts_at=$5, ends_at=$6, capacity=$7, price_cents=$8, reply_by=$9, status=$10, status_changed_at=$11, cancelled_by_kind=$12, cancelled_by_label=$13, cancel_reason=$14 where id=$1`,
      [x.id, x.title, x.description, x.location, x.startsAt, x.endsAt, x.capacity, x.priceCents, x.replyBy, x.status, x.statusChangedAt, x.cancelledBy?.kind ?? null, x.cancelledBy?.label ?? null, x.cancelReason],
    );
  }

  const rr = compare("RSVPs", before.rsvps, after.rsvps);
  const earlier = new Map(before.rsvps.map((r) => [r.id, r]));
  const updateRsvp = (r: Rsvp) =>
    run(`update club.event_rsvps set guests=$2, status=$3, status_changed_at=$4, promoted_at=$5, hold_until=$6, cancelled_by_kind=$7, cancelled_by_id=$8, cancelled_by_label=$9, cancel_reason=$10 where id=$1`, [
      r.id, r.guests, r.status, r.statusChangedAt, r.promotedAt, r.holdUntil, r.cancelledBy?.kind ?? null, r.cancelledBy ? actorId(r.cancelledBy) : null, r.cancelledBy?.label ?? null, r.cancelReason,
    ]);
  const givesUpPlaces = (r: Rsvp) => r.status !== "going" || r.guests < (earlier.get(r.id)?.guests ?? r.guests);
  for (const r of rr.updated.filter(givesUpPlaces)) await updateRsvp(r);
  for (const r of rr.added) {
    await run(
      `insert into club.event_rsvps (id, event_id, member_id, guests, status, price_cents, via, created_at, created_by_kind, created_by_id, created_by_label, status_changed_at, promoted_at, hold_until, cancelled_by_kind, cancelled_by_id, cancelled_by_label, cancel_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [r.id, r.eventId, r.memberId, r.guests, r.status, r.priceCents, r.via, r.createdAt, r.createdBy.kind, actorId(r.createdBy), r.createdBy.label, r.statusChangedAt, r.promotedAt, r.holdUntil, r.cancelledBy?.kind ?? null, r.cancelledBy ? actorId(r.cancelledBy) : null, r.cancelledBy?.label ?? null, r.cancelReason],
    );
  }
  for (const r of rr.updated.filter((x) => !givesUpPlaces(x))) await updateRsvp(r);

  // The check-in record is only ever added to. It goes last, because each line points at a record saved above.
  const al = compare("check-in lines", before.attendance, after.attendance);
  if (al.updated.length > 0) throw new Error("The check-in record can only be added to, never changed.");
  for (const l of al.added) {
    await run(
      `insert into club.attendance_log (id, kind, booking_id, signup_id, rsvp_id, member_id, at, outcome, previous_outcome, by_kind, by_id, by_label, via, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [l.id, l.kind, l.kind === "booking" ? l.recordId : null, l.kind === "class" ? l.recordId : null, l.kind === "event" ? l.recordId : null, l.memberId, l.at, l.outcome, l.previous, l.by.kind, actorId(l.by), l.by.label, l.via, l.note],
    );
  }

  // Charges and visitor entries: new ones are added, and a wrong one is voided (never changed or removed).
  const ch = compare("charges", before.charges, after.charges);
  for (const x of ch.added) {
    await run(
      `insert into club.charges (id, household_id, member_id, day, category, adjustment, amount_cents, description, created_at, created_by_kind, created_by_label, status, voided_at, voided_by_label, void_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff',$10,$11,$12,$13,$14)`,
      [x.id, x.householdId, x.memberId, x.day, x.category, x.adjustment, x.amountCents, x.description, x.createdAt, x.createdBy.label, x.status, x.voidedAt, x.voidedBy?.label ?? null, x.voidReason],
    );
  }
  for (const x of ch.updated) await run(`update club.charges set status=$2, voided_at=$3, voided_by_label=$4, void_reason=$5 where id=$1`, [x.id, x.status, x.voidedAt, x.voidedBy?.label ?? null, x.voidReason]);

  const vv = compare("visitor entries", before.visitors, after.visitors);
  for (const x of vv.added) {
    await run(
      `insert into club.visitor_entries (id, member_id, day, visitors, created_at, created_by_kind, created_by_id, created_by_label, via, status, voided_at, voided_by_label, void_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [x.id, x.memberId, x.day, x.visitors, x.createdAt, x.createdBy.kind, actorId(x.createdBy), x.createdBy.label, x.via, x.status, x.voidedAt, x.voidedBy?.label ?? null, x.voidReason],
    );
  }
  for (const x of vv.updated) await run(`update club.visitor_entries set status=$2, voided_at=$3, voided_by_label=$4, void_reason=$5 where id=$1`, [x.id, x.status, x.voidedAt, x.voidedBy?.label ?? null, x.voidReason]);

  // A closed month and its invoice lines are only ever added, the run first.
  const runs = compare("closed months", before.billingRuns, after.billingRuns);
  if (runs.updated.length > 0) throw new Error("A closed month can only be added to, never changed.");
  for (const r of runs.added) {
    await run(`insert into club.billing_runs (id, month, created_at, created_by_kind, created_by_label, invoice_count, total_cents) values ($1,$2,$3,'staff',$4,$5,$6)`, [r.id, r.month, r.createdAt, r.createdBy.label, r.invoiceCount, r.totalCents]);
  }
  const lines = compare("invoice lines", before.billingLines, after.billingLines);
  if (lines.updated.length > 0) throw new Error("An invoice line can only be added, never changed.");
  for (const l of lines.added) {
    await run(
      `insert into club.billing_lines (id, run_id, household_id, invoice_no, kind, description, quantity, unit_cents, amount_cents, taxable, adjustment) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [l.id, l.runId, l.householdId, l.invoiceNo, l.kind, l.description, l.quantity, l.unitCents, l.amountCents, l.taxable, l.adjustment],
    );
  }
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
  if (code === "23514" && message && /^(That event is full|That event was cancelled|The limit cannot go below)/.test(message)) return new ClubError("conflict", message);
  if (code === "23505" && constraint === "event_rsvps_one_live") return new ClubError("conflict", "That person is already on this event's list.");
  if (code === "23505" && constraint === "class_signups_one_live") return new ClubError("conflict", "That person is already on this class's sign-up sheet.");
  return e;
}

/* ---------- The store ---------- */

export class PgClubStore implements ClubStore {
  private newId: () => string;
  private historyDays: number;
  private clock: () => Date;
  private settle: Settler | undefined;

  constructor(
    private pool: Pool,
    options: PgStoreOptions = {},
  ) {
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.historyDays = options.historyDays ?? DEFAULT_HISTORY_DAYS;
    this.clock = options.now ?? (() => new Date());
    this.settle = options.settle;
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
      // Readers see the settled club, but nothing is saved by looking.
      this.settle?.(state, () => crypto.randomUUID());
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
      this.settle?.(draft, this.newId);
      // What settling did is saved as a step of its own, before the change itself: a booking that ran out of time
      // (upcoming to no-show) and was then put right by staff (no-show to attended) is two steps with a line each,
      // and the database checks every step against its line.
      const settled = structuredClone(draft);
      const result = await fn(draft, this.newId);
      await save(c, before, settled);
      await save(c, settled, draft);
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
  async syncRules(book: RuleBook, classRules?: ClassRules, eventRules?: EventRules): Promise<void> {
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
      if (eventRules) {
        await c.query(`insert into club.event_rule_defaults (id, placeholder, rules) values (true, $1, $2) on conflict (id) do update set placeholder = excluded.placeholder, rules = excluded.rules`, [eventRules.placeholder, JSON.stringify(eventRules.defaults)]);
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
    return new PgClubStore(this.pool, { newId, historyDays: this.historyDays, now: this.clock, settle: this.settle });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
