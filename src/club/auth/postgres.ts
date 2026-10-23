import type { Pool } from "pg";
import type { SessionSubject } from "./identities";
import type { AuthStore } from "./store";

/**
 * The same `AuthStore` in Postgres (tables `club.login_tokens` and `club.sessions`). Times come from the caller, never from the
 * database clock, so the test clock works. Only fingerprints of secrets are stored. Nothing is deleted.
 */
export class PgAuthStore implements AuthStore {
  constructor(private pool: Pick<Pool, "query">) {}

  async addToken({ hash, email, now, expiresAt }: { hash: string; email: string; now: Date; expiresAt: Date }) {
    await this.pool.query(`insert into club.login_tokens (token_hash, email, created_at, expires_at) values ($1, $2, $3, $4)`, [hash, email, now, expiresAt]);
  }

  async countTokensSince(email: string, since: Date) {
    const { rows } = await this.pool.query(`select count(*)::int as n from club.login_tokens where email = $1 and created_at >= $2`, [email, since]);
    return rows[0].n as number;
  }

  async findToken(hash: string, now: Date) {
    const { rows } = await this.pool.query(`select email from club.login_tokens where token_hash = $1 and used_at is null and expires_at > $2`, [hash, now]);
    return rows[0] ? { email: rows[0].email as string } : null;
  }

  async consumeToken(hash: string, now: Date) {
    // One statement, so of many simultaneous attempts only one finds the link still unused.
    const { rows } = await this.pool.query(`update club.login_tokens set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2 returning email`, [hash, now]);
    return rows[0] ? { email: rows[0].email as string } : null;
  }

  async addSession({ hash, subject, now, expiresAt }: { hash: string; subject: SessionSubject; now: Date; expiresAt: Date }) {
    await this.pool.query(`insert into club.sessions (token_hash, subject_kind, member_id, staff_email, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)`, [
      hash,
      subject.kind,
      subject.kind === "member" ? subject.memberId : null,
      subject.kind === "staff" ? subject.email : null,
      now,
      expiresAt,
    ]);
  }

  async findSession(hash: string, now: Date) {
    const { rows } = await this.pool.query(`select subject_kind, member_id, staff_email from club.sessions where token_hash = $1 and revoked_at is null and expires_at > $2`, [hash, now]);
    const r = rows[0];
    if (!r) return null;
    return r.subject_kind === "member" ? { kind: "member" as const, memberId: r.member_id as string } : { kind: "staff" as const, email: r.staff_email as string };
  }

  async revokeSession(hash: string, now: Date) {
    await this.pool.query(`update club.sessions set revoked_at = $2 where token_hash = $1 and revoked_at is null`, [hash, now]);
  }

  async revokeSessionsFor(subject: SessionSubject, now: Date) {
    const { rowCount } =
      subject.kind === "member"
        ? await this.pool.query(`update club.sessions set revoked_at = $2 where member_id = $1 and revoked_at is null`, [subject.memberId, now])
        : await this.pool.query(`update club.sessions set revoked_at = $2 where staff_email = $1 and revoked_at is null`, [subject.email, now]);
    return rowCount ?? 0;
  }
}
