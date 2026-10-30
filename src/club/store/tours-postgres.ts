import type { Pool } from "pg";
import { ClubError } from "../errors";
import { DAY_MS, HOUR_MS, type NewTourRequest, type TourAddResult, type TourLimits, type TourRequest, type TourStore } from "./tours";

/**
 * The tour request cards in Postgres, behind the same `TourStore` the in-memory copy implements. Saving takes one database-wide
 * lock of its own, so two requests arriving at once (at any app server) are counted against the limits one after the other.
 */

const TOURS_LOCK = "club:tours";

interface Row {
  id: string;
  created_at: Date;
  name: string;
  email: string;
  phone: string;
  note: string;
  status: "new" | "followed_up";
  followed_up_at: Date | null;
  followed_up_by: string | null;
}

const COLUMNS = "id, created_at, name, email, phone, note, status, followed_up_at, followed_up_by";
const iso = (d: Date | string) => new Date(d).toISOString();
const toRequest = (r: Row): TourRequest => ({
  id: r.id,
  createdAt: iso(r.created_at),
  name: r.name,
  email: r.email,
  phone: r.phone,
  note: r.note,
  status: r.status,
  followedUpAt: r.followed_up_at ? iso(r.followed_up_at) : null,
  followedUpBy: r.followed_up_by,
});

export class PgTourStore implements TourStore {
  constructor(
    private pool: Pool,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  async add(input: NewTourRequest, at: Date, limits: TourLimits): Promise<TourAddResult> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [TOURS_LOCK]);
      const mine = await c.query<{ n: number }>(`select count(*)::int as n from club.tour_requests where email = $1 and created_at > $2`, [input.email, new Date(at.getTime() - DAY_MS)]);
      if (mine.rows[0].n >= limits.maxPerEmailPerDay) {
        await c.query("rollback");
        return { saved: false, reason: "already" };
      }
      const all = await c.query<{ n: number }>(`select count(*)::int as n from club.tour_requests where created_at > $1`, [new Date(at.getTime() - HOUR_MS)]);
      if (all.rows[0].n >= limits.maxPerHour) {
        await c.query("rollback");
        return { saved: false, reason: "busy" };
      }
      const { rows } = await c.query<Row>(`insert into club.tour_requests (id, created_at, name, email, phone, note) values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`, [this.newId(), at, input.name, input.email, input.phone, input.note]);
      await c.query("commit");
      return { saved: true, request: toRequest(rows[0]) };
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  async list(limit: number) {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from club.tour_requests order by created_at desc, seq desc limit $1`, [limit]);
    const counts = await this.pool.query<{ total: number; new_count: number }>(`select count(*)::int as total, (count(*) filter (where status = 'new'))::int as new_count from club.tour_requests`);
    return { items: rows.map(toRequest), total: counts.rows[0].total, newCount: counts.rows[0].new_count };
  }

  async markFollowedUp(id: string, by: string, at: Date): Promise<TourRequest> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [TOURS_LOCK]);
      const found = await c.query<Row>(`select ${COLUMNS} from club.tour_requests where id = $1`, [id]);
      if (found.rows.length === 0) throw new ClubError("not_found", "That tour request could not be found.");
      if (found.rows[0].status === "followed_up") throw new ClubError("conflict", "That request was already marked as followed up.");
      const { rows } = await c.query<Row>(`update club.tour_requests set status = 'followed_up', followed_up_at = $2, followed_up_by = $3 where id = $1 returning ${COLUMNS}`, [id, at, by]);
      await c.query("commit");
      return toRequest(rows[0]);
    } catch (e) {
      await c.query("rollback").catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}
