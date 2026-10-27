import type { Pool, PoolClient } from "pg";
import { ClubError } from "../errors";
import {
  CHANGED_SINCE_CHECK,
  NOTHING_TO_ADD,
  type FoundReservation,
  type HistoryAddInput,
  type HistoryImportRecord,
  type HistoryStore,
  type HistorySummary,
  type LegacyPerson,
  type LegacyReservation,
  type NameSummary,
  type NewReservation,
  type PersonHistoryItem,
  type PersonRole,
} from "./history";

/**
 * The archive of old bookings in Postgres, behind the same `HistoryStore` the in-memory copy implements. Adding takes one
 * database-wide lock of its own (so two imports of the same file can never both add it) and inserts in big chunks, because a
 * year of bookings is about 27,000 rows.
 */

const HISTORY_LOCK = "club:history";
const CHUNK = 2000;
const KEY_CHUNK = 5000;

interface ReservationRow {
  id: string;
  import_id: string;
  source_id: string;
  day: string;
  starts_at: Date;
  ends_at: Date;
  booked_at: Date | null;
  item_type: string;
  item_name: string;
  oars: string;
  booked_by: string;
  rowers: string;
  out_text: string;
  in_text: string;
}
interface ImportRow {
  id: string;
  file_name: string;
  file_fingerprint: string;
  imported_at: Date;
  imported_by: string;
  rows_in_file: number;
  rows_added: number;
  rows_skipped: number;
  first_day: string;
  last_day: string;
}

const COLUMNS = "r.id, r.import_id, r.source_id, r.day, r.starts_at, r.ends_at, r.booked_at, r.item_type, r.item_name, r.oars, r.booked_by, r.rowers, r.out_text, r.in_text";
const iso = (d: Date | string) => new Date(d).toISOString();

const toReservation = (r: ReservationRow): LegacyReservation => ({
  id: r.id,
  importId: r.import_id,
  sourceId: r.source_id,
  day: r.day,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  bookedAt: r.booked_at ? iso(r.booked_at) : null,
  itemType: r.item_type,
  itemName: r.item_name,
  oars: r.oars,
  bookedBy: r.booked_by,
  rowers: r.rowers,
  outText: r.out_text,
  inText: r.in_text,
});

const toImport = (r: ImportRow): HistoryImportRecord => ({
  id: r.id,
  fileName: r.file_name,
  fingerprint: r.file_fingerprint,
  importedAt: iso(r.imported_at),
  importedBy: r.imported_by,
  rowsInFile: r.rows_in_file,
  rowsAdded: r.rows_added,
  rowsSkipped: r.rows_skipped,
  firstDay: r.first_day,
  lastDay: r.last_day,
});

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function existing(c: Pick<PoolClient, "query">, keys: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for (const part of chunks(keys, KEY_CHUNK)) {
    const { rows } = await c.query<{ row_key: string }>(`select row_key from club.legacy_reservations where row_key = any($1::text[])`, [part]);
    for (const r of rows) have.add(r.row_key);
  }
  return have;
}

export class PgHistoryStore implements HistoryStore {
  constructor(
    private pool: Pool,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  async existingKeys(keys: string[]): Promise<Set<string>> {
    return existing(this.pool, keys);
  }

  async add(input: HistoryAddInput, expectAdded: number | null): Promise<{ added: number; skipped: number }> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      // Imports take turns, whichever app server they arrive at.
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [HISTORY_LOCK]);
      const have = await existing(c, input.rows.map((r) => r.key));
      const fresh: NewReservation[] = [];
      for (const r of input.rows) {
        if (have.has(r.key)) continue;
        have.add(r.key);
        fresh.push(r);
      }
      if (expectAdded !== null && fresh.length !== expectAdded) throw new ClubError("conflict", CHANGED_SINCE_CHECK);
      if (fresh.length === 0) throw new ClubError("conflict", NOTHING_TO_ADD);

      const importId = this.newId();
      const firstDay = fresh.reduce((a, r) => (r.day < a ? r.day : a), fresh[0].day);
      const lastDay = fresh.reduce((a, r) => (r.day > a ? r.day : a), fresh[0].day);
      await c.query(
        `insert into club.history_imports (id, file_name, file_fingerprint, imported_at, imported_by, rows_in_file, rows_added, rows_skipped, first_day, last_day) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [importId, input.fileName, input.fingerprint, input.at.toISOString(), input.by, input.rowsInFile, fresh.length, input.rowsInFile - fresh.length, firstDay, lastDay],
      );
      for (const part of chunks(fresh, CHUNK)) {
        const ids = part.map(() => this.newId());
        await c.query(
          `insert into club.legacy_reservations (id, import_id, row_key, source_id, day, starts_at, ends_at, booked_at, item_type, item_name, oars, booked_by, rowers, out_text, in_text)
           select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::date[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[], $15::text[])`,
          [
            ids,
            part.map(() => importId),
            part.map((r) => r.key),
            part.map((r) => r.sourceId),
            part.map((r) => r.day),
            part.map((r) => r.startsAt),
            part.map((r) => r.endsAt),
            part.map((r) => r.bookedAt),
            part.map((r) => r.itemType),
            part.map((r) => r.itemName),
            part.map((r) => r.oars),
            part.map((r) => r.bookedBy),
            part.map((r) => r.rowers),
            part.map((r) => r.outText),
            part.map((r) => r.inText),
          ],
        );
        const people = part.flatMap((r, i) => r.people.map((p) => ({ reservation: ids[i], ...p })));
        for (const some of chunks(people, CHUNK * 2)) {
          await c.query(`insert into club.legacy_reservation_people (reservation_id, name_key, name, role) select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[])`, [
            some.map((p) => p.reservation),
            some.map((p) => p.key),
            some.map((p) => p.name),
            some.map((p) => p.role),
          ]);
        }
      }
      await c.query("commit");
      return { added: fresh.length, skipped: input.rowsInFile - fresh.length };
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      if ((e as { code?: string }).code === "23505" && (e as { constraint?: string }).constraint === "history_imports_file_fingerprint_key") throw new ClubError("conflict", "That exact file was already added.");
      throw e;
    } finally {
      c.release();
    }
  }

  async summary(): Promise<HistorySummary> {
    const { rows } = await this.pool.query<{ rows: number; first_day: string | null; last_day: string | null }>(`select count(*)::int as rows, min(day) as first_day, max(day) as last_day from club.legacy_reservations`);
    const imports = await this.pool.query<ImportRow>(
      `select id, file_name, file_fingerprint, imported_at, imported_by, rows_in_file, rows_added, rows_skipped, first_day, last_day from club.history_imports order by seq desc limit 20`,
    );
    return { rows: rows[0].rows, firstDay: rows[0].first_day, lastDay: rows[0].last_day, imports: imports.rows.map(toImport) };
  }

  async forName(key: string, limit: number, offset: number): Promise<{ total: number; items: PersonHistoryItem[] }> {
    const total = await this.pool.query<{ n: number }>(`select count(distinct reservation_id)::int as n from club.legacy_reservation_people where name_key = $1`, [key]);
    const { rows } = await this.pool.query<ReservationRow & { roles: PersonRole[]; others: number }>(
      `select ${COLUMNS},
              (select array_agg(p.role order by p.role) from club.legacy_reservation_people p where p.reservation_id = r.id and p.name_key = $1) as roles,
              (select count(distinct p.name_key)::int from club.legacy_reservation_people p where p.reservation_id = r.id and p.name_key <> $1) as others
         from club.legacy_reservations r
        where r.id in (select reservation_id from club.legacy_reservation_people where name_key = $1)
        order by r.day desc, r.seq desc
        limit $2 offset $3`,
      [key, limit, offset],
    );
    return { total: total.rows[0].n, items: rows.map((r) => ({ reservation: toReservation(r), roles: r.roles, others: r.others })) };
  }

  async search(prefix: string, limit: number): Promise<FoundReservation[]> {
    const like = `${prefix.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const { rows } = await this.pool.query<ReservationRow>(
      `select ${COLUMNS} from club.legacy_reservations r
        where exists (select 1 from club.legacy_reservation_people p where p.reservation_id = r.id and p.name_key like $1 escape '\\')
        order by r.day desc, r.seq desc limit $2`,
      [like, limit],
    );
    if (rows.length === 0) return [];
    const people = await this.pool.query<{ reservation_id: string; name_key: string; name: string; role: PersonRole }>(
      `select reservation_id, name_key, name, role from club.legacy_reservation_people where reservation_id = any($1::uuid[]) order by role, name_key`,
      [rows.map((r) => r.id)],
    );
    const byReservation = new Map<string, LegacyPerson[]>();
    for (const p of people.rows) byReservation.set(p.reservation_id, [...(byReservation.get(p.reservation_id) ?? []), { key: p.name_key, name: p.name, role: p.role }]);
    return rows.map((r) => ({ reservation: toReservation(r), people: byReservation.get(r.id) ?? [] }));
  }

  async names(): Promise<NameSummary[]> {
    const { rows } = await this.pool.query<{ key: string; name: string; rows: number }>(
      `select name_key as key, min(name collate "C") as name, count(distinct reservation_id)::int as rows
         from club.legacy_reservation_people group by name_key order by rows desc, name_key collate "C"`,
    );
    return rows;
  }
}
