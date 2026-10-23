import type { SessionSubject } from "./identities";

/**
 * Where sign-in links and signed-in browsers are kept. Kept apart from the club's records on purpose: the club's truth is
 * about households and bookings, this is about doors and keys. Nothing here is ever deleted (a used link and a signed-out
 * browser are marked, not removed), and only fingerprints of secrets are held, never the secrets.
 */
export interface AuthStore {
  /** Records a sign-in link for an address (already lower case). */
  addToken(token: { hash: string; email: string; now: Date; expiresAt: Date }): Promise<void>;
  /** How many links were made for this address since a moment, used or not. */
  countTokensSince(email: string, since: Date): Promise<number>;
  /** The address a link is for, if the link exists, has not been used and has not run out. Changes nothing. */
  findToken(hash: string, now: Date): Promise<{ email: string } | null>;
  /** Uses a link up. Of any number of simultaneous attempts exactly one gets the address; the rest get null. */
  consumeToken(hash: string, now: Date): Promise<{ email: string } | null>;
  /** Records a signed-in browser. */
  addSession(session: { hash: string; subject: SessionSubject; now: Date; expiresAt: Date }): Promise<void>;
  /** Who a browser is signed in as, if it has not been signed out and has not run out. */
  findSession(hash: string, now: Date): Promise<SessionSubject | null>;
  /** Signs one browser out. Signing out twice is fine. */
  revokeSession(hash: string, now: Date): Promise<void>;
  /** Signs a person out everywhere. Returns how many browsers were signed out. */
  revokeSessionsFor(subject: SessionSubject, now: Date): Promise<number>;
}

interface TokenRow {
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

interface SessionRow {
  subject: SessionSubject;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

const sameSubject = (a: SessionSubject, b: SessionSubject) => (a.kind === "member" ? b.kind === "member" && a.memberId === b.memberId : b.kind === "staff" && a.email === b.email);

/** The in-memory copy: used by the sample club and by tests. Everything is forgotten when the server restarts. */
export class MemoryAuthStore implements AuthStore {
  private tokens = new Map<string, TokenRow>();
  private sessions = new Map<string, SessionRow>();

  async addToken({ hash, email, now, expiresAt }: { hash: string; email: string; now: Date; expiresAt: Date }) {
    if (this.tokens.has(hash)) throw new Error("That sign-in link already exists.");
    this.tokens.set(hash, { email, createdAt: now.getTime(), expiresAt: expiresAt.getTime(), usedAt: null });
  }

  async countTokensSince(email: string, since: Date) {
    return [...this.tokens.values()].filter((t) => t.email === email && t.createdAt >= since.getTime()).length;
  }

  async findToken(hash: string, now: Date) {
    const t = this.tokens.get(hash);
    return t && t.usedAt === null && t.expiresAt > now.getTime() ? { email: t.email } : null;
  }

  async consumeToken(hash: string, now: Date) {
    const t = this.tokens.get(hash);
    if (!t || t.usedAt !== null || t.expiresAt <= now.getTime()) return null;
    t.usedAt = now.getTime();
    return { email: t.email };
  }

  async addSession({ hash, subject, now, expiresAt }: { hash: string; subject: SessionSubject; now: Date; expiresAt: Date }) {
    if (this.sessions.has(hash)) throw new Error("That session already exists.");
    this.sessions.set(hash, { subject: structuredClone(subject), createdAt: now.getTime(), expiresAt: expiresAt.getTime(), revokedAt: null });
  }

  async findSession(hash: string, now: Date) {
    const s = this.sessions.get(hash);
    return s && s.revokedAt === null && s.expiresAt > now.getTime() ? structuredClone(s.subject) : null;
  }

  async revokeSession(hash: string, now: Date) {
    const s = this.sessions.get(hash);
    if (s && s.revokedAt === null) s.revokedAt = now.getTime();
  }

  async revokeSessionsFor(subject: SessionSubject, now: Date) {
    let count = 0;
    for (const s of this.sessions.values()) {
      if (s.revokedAt === null && sameSubject(s.subject, subject)) {
        s.revokedAt = now.getTime();
        count += 1;
      }
    }
    return count;
  }
}
