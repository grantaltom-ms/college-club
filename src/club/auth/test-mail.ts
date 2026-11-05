import type { Pool } from "pg";
import type { OutboxEntry } from "./mail";

/**
 * The test outbox in Postgres (Nov 5, 2026), for a preview or a local server that has a shared test database. Several servers
 * then show one list of "emails" instead of each its own. Rows are only ever added (the database refuses anything else) and the
 * page reads the newest first. TEST BUILDS ONLY: the real sender never writes here and the page that reads it is hidden on the
 * live site.
 */
export class PgTestMail {
  constructor(private pool: Pool) {}

  async add(entry: OutboxEntry): Promise<void> {
    await this.pool.query(`insert into club.test_mail (sent_at, to_email, subject, body) values ($1, $2, $3, $4)`, [entry.at, entry.to, entry.subject, entry.text]);
  }

  /** The newest first. */
  async recent(limit: number): Promise<OutboxEntry[]> {
    const { rows } = await this.pool.query<{ sent_at: Date; to_email: string; subject: string; body: string }>(`select sent_at, to_email, subject, body from club.test_mail order by seq desc limit $1`, [limit]);
    return rows.map((r) => ({ at: new Date(r.sent_at).toISOString(), to: r.to_email, subject: r.subject, text: r.body }));
  }
}
