import {
  BAND_ORDER,
  type Band,
  type ClubTotal,
  type DashboardData,
  type DoorCell,
  type DoorMonth,
  type DoorPeriod,
  type Member,
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

async function fetchAll<T>(cfg: { url: string; key: string }, table: string, order: string): Promise<T[]> {
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

export function toMember(r: MemberRow): Member {
  const band = BAND_ORDER.includes(r.usage_band as Band) ? (r.usage_band as Band) : "0 visits";
  return {
    name: r.member_name,
    band,
    visitsPerMonth: Number(r.visits_per_month ?? 0),
    visitDays: r.visit_days ?? 0,
    doorEntries: r.door_entries ?? 0,
    bookingDays: r.icrew_booking_days_jul_sep ?? 0,
    lastVisit: r.last_visit,
    ownFob: r.own_brivo_fob,
    joined: r.joined,
    memberType: r.icrew_member_type,
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
  const [memberRows, totalRows, periodRows, cellRows, monthRows] = await Promise.all([
    fetchAll<MemberRow>(cfg, "members", "member_name.asc"),
    fetchAll<TotalRow>(cfg, "club_totals", "id.asc"),
    fetchAll<PeriodRow>(cfg, "door_periods", "year.asc"),
    fetchAll<CellRow>(cfg, "door_pattern", "year.asc,weekday.asc,hour.asc"),
    fetchAll<MonthRow>(cfg, "door_monthly", "year.asc,month.asc"),
  ]);
  return {
    source: "live",
    dataThrough: memberRows[0]?.data_through ?? "2026-09-27",
    members: memberRows.map(toMember),
    totals: totalRows.map(toTotal),
    door: {
      periods: periodRows.map(toPeriod),
      cells: cellRows.map(toCell),
      months: monthRows.map(toDoorMonth),
    },
  };
}
