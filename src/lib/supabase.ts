import { buildRoster, ROSTER_SOURCE, type QbRow } from "./roster";
import { sameDateCutoff, type Outing, type RowerCount, type ShellData } from "./shells";
import {
  BAND_ORDER,
  type Band,
  type ClubTotal,
  type DashboardData,
  type DoorCell,
  type DoorMonth,
  type DoorPeriod,
  type FinanceData,
  type FinanceMonth,
  type Member,
  type MembershipData,
  type MembershipMonth,
  type Measure,
} from "./types";

const PAGE = 1000;

interface MemberRow {
  member_name: string;
  usage_band: string;
  visits_per_month: number | string | null;
  visit_days: number | null;
  door_entries: number | null;
  icrew_booking_days_jul_sep: number | null;
  icrew_bookings_jul_sep?: number | null;
  door_share_early_4to8am?: number | string | null;
  door_share_weekend?: number | string | null;
  last_visit: string | null;
  own_brivo_fob: boolean;
  joined: string | null;
  icrew_member_type: string | null;
  data_through: string;
  visit_days_2026_01: number | null;
  visit_days_2026_02: number | null;
  visit_days_2026_03: number | null;
  visit_days_2026_04: number | null;
  visit_days_2026_05: number | null;
  visit_days_2026_06: number | null;
  visit_days_2026_07: number | null;
  visit_days_2026_08: number | null;
  visit_days_2026_09: number | null;
}

interface TotalRow {
  measure: string;
  period_key: string;
  all_entries: number | null;
  member_entries: number | null;
}

interface PeriodRow {
  year: number;
  first_day: string;
  last_day: string;
}

interface CellRow {
  year: number;
  weekday: number;
  hour: number;
  all_entries: number;
  member_entries: number;
}

interface MonthRow {
  year: number;
  month: number;
  all_entries: number;
  member_entries: number;
  people: number;
}

export function liveConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

export async function fetchAll<T>(cfg: { url: string; key: string }, table: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${cfg.url}/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase returned ${res.status} for ${table}`);
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function share(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Names like "Trevor & Tia Dyer", "Chris/Bridget Backschies" or "Eva and John Dougherty". */
export function isHouseholdName(name: string): boolean {
  return /[&/]|\band\b/i.test(name);
}

export function toMember(r: MemberRow): Member {
  const band = BAND_ORDER.includes(r.usage_band as Band) ? (r.usage_band as Band) : "0 visits";
  return {
    name: r.member_name,
    band,
    visitsPerMonth: Number(r.visits_per_month ?? 0),
    visitDays: r.visit_days ?? 0,
    doorEntries: r.door_entries ?? 0,
    bookingDays: r.icrew_booking_days_jul_sep ?? 0,
    bookings: r.icrew_bookings_jul_sep ?? r.icrew_booking_days_jul_sep ?? 0,
    earlyShare: share(r.door_share_early_4to8am),
    weekendShare: share(r.door_share_weekend),
    household: isHouseholdName(r.member_name),
    lastVisit: r.last_visit,
    ownFob: r.own_brivo_fob,
    joined: r.joined,
    memberType: r.icrew_member_type,
    qbCreatedOn: null,
    notStarted: false,
    monthly: [
      r.visit_days_2026_01,
      r.visit_days_2026_02,
      r.visit_days_2026_03,
      r.visit_days_2026_04,
      r.visit_days_2026_05,
      r.visit_days_2026_06,
      r.visit_days_2026_07,
      r.visit_days_2026_08,
      r.visit_days_2026_09,
    ].map((v) => v ?? 0),
  };
}

export function toTotal(r: TotalRow): ClubTotal {
  return {
    measure: r.measure as Measure,
    key: r.period_key,
    allEntries: r.all_entries ?? 0,
    memberEntries: r.member_entries,
  };
}

export function toPeriod(r: PeriodRow): DoorPeriod {
  return { year: r.year, firstDay: r.first_day, lastDay: r.last_day };
}

export function toCell(r: CellRow): DoorCell {
  return {
    year: r.year,
    weekday: r.weekday,
    hour: r.hour,
    allEntries: r.all_entries,
    memberEntries: r.member_entries,
  };
}

export function toDoorMonth(r: MonthRow): DoorMonth {
  return {
    year: r.year,
    month: r.month,
    allEntries: r.all_entries,
    memberEntries: r.member_entries,
    people: r.people,
  };
}

export async function loadLiveData(cfg: { url: string; key: string }): Promise<DashboardData> {
  const [memberRows, qbRows, totalRows, periodRows, cellRows, monthRows] = await Promise.all([
    fetchAll<MemberRow>(cfg, "members", "member_name.asc"),
    fetchAll<QbRow>(cfg, "qb_members", "qb_name.asc"),
    fetchAll<TotalRow>(cfg, "club_totals", "id.asc"),
    fetchAll<PeriodRow>(cfg, "door_periods", "year.asc"),
    fetchAll<CellRow>(cfg, "door_pattern", "year.asc,weekday.asc,hour.asc"),
    fetchAll<MonthRow>(cfg, "door_monthly", "year.asc,month.asc"),
  ]);
  // The QuickBooks list is the roster. With none loaded there is nothing honest to show, so fail loudly
  // rather than quietly falling back to the iCrew list.
  if (qbRows.length === 0) throw new Error("qb_members is empty: load the QuickBooks member list first");
  const dataThrough = memberRows[0]?.data_through ?? "2026-09-27";
  const roster = buildRoster(qbRows, memberRows.map(toMember), dataThrough);
  if (roster.missing.length > 0) {
    console.warn(`${roster.missing.length} QuickBooks members link to a usage record that is not in the database`);
  }
  return {
    source: "live",
    dataThrough,
    members: roster.members,
    roster: { source: ROSTER_SOURCE, asOf: roster.asOf },
    totals: totalRows.map(toTotal),
    door: {
      periods: periodRows.map(toPeriod),
      cells: cellRows.map(toCell),
      months: monthRows.map(toDoorMonth),
    },
  };
}

/* ---------- Membership counts ---------- */

export interface MembershipRow {
  year: number;
  month: number;
  previous_total: number | null;
  resignations: number | null;
  applicants_for_approval: number | null;
  transferred: number | null;
  with_months_approvals: number | null;
  waitlist: number | null;
  note: string | null;
}

/** A membership_monthly row as the browser sees it: counts only, no names. */
export function toMembershipMonth(r: MembershipRow): MembershipMonth {
  return {
    year: r.year,
    month: r.month,
    previousTotal: r.previous_total ?? 0,
    resignations: r.resignations ?? 0,
    applicants: r.applicants_for_approval ?? 0,
    transferred: r.transferred,
    withApprovals: r.with_months_approvals ?? 0,
    waitlist: r.waitlist,
    note: r.note,
  };
}

export async function loadMembership(cfg: { url: string; key: string }): Promise<MembershipData> {
  const rows = await fetchAll<MembershipRow>(cfg, "membership_monthly", "year.asc,month.asc");
  return { source: "live", months: rows.map(toMembershipMonth) };
}

/* ---------- Financials ---------- */

export interface FinanceRow {
  year: number;
  month: number;
  income: number | null;
  cogs: number | null;
  gross_profit: number | null;
  expenses: number | null;
  net_operating_income: number | null;
  other_income: number | null;
  other_expenses: number | null;
  net_other_income: number | null;
  net_income: number | null;
  depreciation: number | null;
  labeled_ytd_income: number | null;
  labeled_ytd_net_income: number | null;
  source_file: string | null;
  note: string | null;
}

/** A finance_monthly row as the browser sees it: organizational aggregates only, no names. */
export function toFinanceMonth(r: FinanceRow): FinanceMonth {
  return {
    year: r.year,
    month: r.month,
    income: r.income ?? 0,
    cogs: r.cogs ?? 0,
    grossProfit: r.gross_profit ?? 0,
    expenses: r.expenses ?? 0,
    netOperatingIncome: r.net_operating_income ?? 0,
    otherIncome: r.other_income ?? 0,
    otherExpenses: r.other_expenses ?? 0,
    netOtherIncome: r.net_other_income ?? 0,
    netIncome: r.net_income ?? 0,
    depreciation: r.depreciation ?? 0,
    labeledYtdIncome: r.labeled_ytd_income ?? 0,
    labeledYtdNetIncome: r.labeled_ytd_net_income ?? 0,
    sourceFile: r.source_file ?? "",
    note: r.note,
  };
}

export async function loadFinancials(cfg: { url: string; key: string }): Promise<FinanceData> {
  const rows = await fetchAll<FinanceRow>(cfg, "finance_monthly", "year.asc,month.asc");
  return { source: "live", months: rows.map(toFinanceMonth) };
}

/* ---------- Shell outings ---------- */

export interface ShellRow {
  boat: string;
  seats: number | null;
  day: string;
  /** "member" for a member's own row, "team" for camps and team sessions. */
  kind: string;
  minutes: number | null;
  /** "07:00:00" or "07:00". */
  start_time: string | null;
  /** Scrambled code for the rower (never their name). Only used here, on the server, to count people. */
  rower_key: string | null;
}

/** The browser gets the boat, day and time only: no rower code, so no way back to a person. */
export function toOuting(r: ShellRow): Outing {
  const hour = r.start_time ? Number(r.start_time.slice(0, 2)) : NaN;
  return {
    boat: r.boat,
    seats: r.seats ?? 1,
    day: r.day,
    team: r.kind === "team",
    minutes: r.minutes ?? 0,
    startHour: Number.isInteger(hour) && hour >= 0 && hour < 24 ? hour : null,
  };
}

/** Different rowers per year, whole year and Jan 1 to the same day as `through`. */
export function countRowers(rows: ShellRow[], through: string): RowerCount[] {
  const years = [...new Set(rows.map((r) => Number(r.day.slice(0, 4))))].sort((a, b) => a - b);
  return years.map((year) => {
    const inYear = rows.filter((r) => r.rower_key && r.day.startsWith(`${year}-`));
    const cutoff = sameDateCutoff(year, through);
    return {
      year,
      rowers: new Set(inYear.map((r) => r.rower_key)).size,
      sameDates: new Set(inYear.filter((r) => r.day <= cutoff).map((r) => r.rower_key)).size,
    };
  });
}

/** Outings up to today (later bookings are left out until they happen). */
export function toShellData(rows: ShellRow[], today: string): ShellData {
  const kept = rows.filter((r) => r.day <= today);
  const through = kept.reduce((max, r) => (r.day > max ? r.day : max), "");
  return {
    source: "live",
    through,
    outings: kept.map(toOuting),
    rowers: countRowers(kept, through),
  };
}

export async function loadShells(cfg: { url: string; key: string }, today = new Date().toISOString().slice(0, 10)): Promise<ShellData> {
  const rows = await fetchAll<ShellRow>(cfg, "shell_outings", "day.asc,id.asc");
  return toShellData(rows, today);
}
