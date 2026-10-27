import { ClubError } from "../errors";

/**
 * The club's archive of bookings from the old reservation system (iCrew). Think of the old filing cabinet: it is kept, and
 * members and staff can look things up in it, but it is not part of today's calendar. It never touches the booking rules, the
 * check-in record or billing, so an old reservation can never become a no-show, count against a limit or appear on an invoice.
 *
 * It is a store of its own, beside the club's `ClubStore`, because it is large (a year of bookings is about 27,000 rows) and
 * every screen reads the club's records on every visit. Rows are only ever added.
 */

export const PERSON_ROLES = ["booker", "rower"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export interface LegacyPerson {
  /** The name as staff see it. */
  name: string;
  /** The matching key (see people-names.ts). */
  key: string;
  role: PersonRole;
}

export interface NewReservation {
  /** Identifies the booking so it is only ever stored once. */
  key: string;
  sourceId: string;
  /** The Pacific day, YYYY-MM-DD. */
  day: string;
  startsAt: string;
  endsAt: string;
  bookedAt: string | null;
  itemType: string;
  itemName: string;
  oars: string;
  bookedBy: string;
  rowers: string;
  outText: string;
  inText: string;
  people: LegacyPerson[];
}

export interface LegacyReservation extends Omit<NewReservation, "key" | "people"> {
  id: string;
  importId: string;
}

export interface HistoryImportRecord {
  id: string;
  fileName: string;
  fingerprint: string;
  importedAt: string;
  importedBy: string;
  rowsInFile: number;
  rowsAdded: number;
  rowsSkipped: number;
  firstDay: string | null;
  lastDay: string | null;
}

export interface HistorySummary {
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
  /** The most recent imports, newest first. */
  imports: HistoryImportRecord[];
}

export interface NameSummary {
  key: string;
  /** One way the name is written in the archive. */
  name: string;
  rows: number;
}

export interface PersonHistoryItem {
  reservation: LegacyReservation;
  /** How the person is on this booking: the one who reserved it, a rower, or both. */
  roles: PersonRole[];
  /** How many other people are named on the same booking. */
  others: number;
}

export interface FoundReservation {
  reservation: LegacyReservation;
  people: LegacyPerson[];
}

export interface HistoryAddInput {
  fileName: string;
  fingerprint: string;
  /** Who did it, as a name for the record. */
  by: string;
  at: Date;
  /** Rows in the file with something in them: those added, plus those skipped for any reason. */
  rowsInFile: number;
  rows: NewReservation[];
}

export interface HistoryStore {
  /** Which of these booking keys are already stored. */
  existingKeys(keys: string[]): Promise<Set<string>>;
  /**
   * Adds every row not already stored, all or nothing, one import at a time. If `expectAdded` is given and the number of
   * new rows is different (the file or the archive changed since it was checked), nothing is added.
   */
  add(input: HistoryAddInput, expectAdded: number | null): Promise<{ added: number; skipped: number }>;
  summary(): Promise<HistorySummary>;
  /** One person's bookings, newest first. */
  forName(key: string, limit: number, offset: number): Promise<{ total: number; items: PersonHistoryItem[] }>;
  /** Staff search: bookings naming anyone whose key starts with `prefix`, newest first. */
  search(prefix: string, limit: number): Promise<FoundReservation[]>;
  /** Every name key in the archive with how many bookings it is on. */
  names(): Promise<NameSummary[]>;
}

export const NOTHING_TO_ADD = "Every row in the file is already stored, so there is nothing to add.";
export const CHANGED_SINCE_CHECK = "The file, or what is already stored, changed since you checked it, so nothing was added. Check the file again.";

export class MemoryHistoryStore implements HistoryStore {
  private reservations: (LegacyReservation & { key: string; people: LegacyPerson[] })[] = [];
  private imports: HistoryImportRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private newId: () => string = () => crypto.randomUUID()) {}

  async existingKeys(keys: string[]): Promise<Set<string>> {
    await this.queue;
    const have = new Set(this.reservations.map((r) => r.key));
    return new Set(keys.filter((k) => have.has(k)));
  }

  add(input: HistoryAddInput, expectAdded: number | null): Promise<{ added: number; skipped: number }> {
    const run = this.queue.then(async () => {
      const have = new Set(this.reservations.map((r) => r.key));
      // A booking listed twice is added once.
      const fresh = input.rows.filter((r) => !have.has(r.key) && have.add(r.key));
      if (expectAdded !== null && fresh.length !== expectAdded) throw new ClubError("conflict", CHANGED_SINCE_CHECK);
      if (fresh.length === 0) throw new ClubError("conflict", NOTHING_TO_ADD);
      if (this.imports.some((i) => i.fingerprint === input.fingerprint)) throw new ClubError("conflict", "That exact file was already added.");
      const record: HistoryImportRecord = {
        id: this.newId(),
        fileName: input.fileName,
        fingerprint: input.fingerprint,
        importedAt: input.at.toISOString(),
        importedBy: input.by,
        rowsInFile: input.rowsInFile,
        rowsAdded: fresh.length,
        rowsSkipped: input.rowsInFile - fresh.length,
        firstDay: fresh.reduce((a, r) => (a === null || r.day < a ? r.day : a), null as string | null),
        lastDay: fresh.reduce((a, r) => (a === null || r.day > a ? r.day : a), null as string | null),
      };
      this.imports.push(record);
      for (const r of fresh) {
        const { key, people, ...rest } = r;
        this.reservations.push({ ...structuredClone(rest), id: this.newId(), importId: record.id, key, people: structuredClone(people) });
      }
      return { added: record.rowsAdded, skipped: record.rowsSkipped };
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async summary(): Promise<HistorySummary> {
    await this.queue;
    const days = this.reservations.map((r) => r.day);
    return {
      rows: this.reservations.length,
      firstDay: days.length ? days.reduce((a, b) => (a < b ? a : b)) : null,
      lastDay: days.length ? days.reduce((a, b) => (a > b ? a : b)) : null,
      imports: structuredClone(this.imports).reverse().slice(0, 20),
    };
  }

  private plain(r: LegacyReservation & { key?: string; people?: LegacyPerson[] }): LegacyReservation {
    const { key: _key, people: _people, ...rest } = r;
    void _key;
    void _people;
    return structuredClone(rest);
  }

  /** Newest day first; within a day, the one added last first. */
  private newestFirst() {
    return this.reservations.map((r, i) => ({ r, i })).sort((a, b) => (a.r.day === b.r.day ? b.i - a.i : a.r.day < b.r.day ? 1 : -1));
  }

  async forName(key: string, limit: number, offset: number): Promise<{ total: number; items: PersonHistoryItem[] }> {
    await this.queue;
    const mine = this.newestFirst().filter(({ r }) => r.people.some((p) => p.key === key));
    return {
      total: mine.length,
      items: mine.slice(offset, offset + limit).map(({ r }) => ({
        reservation: this.plain(r),
        roles: PERSON_ROLES.filter((role) => r.people.some((p) => p.key === key && p.role === role)),
        others: new Set(r.people.filter((p) => p.key !== key).map((p) => p.key)).size,
      })),
    };
  }

  async search(prefix: string, limit: number): Promise<FoundReservation[]> {
    await this.queue;
    return this.newestFirst()
      .filter(({ r }) => r.people.some((p) => p.key.startsWith(prefix)))
      .slice(0, limit)
      .map(({ r }) => ({
        reservation: this.plain(r),
        people: structuredClone(r.people).sort((a, b) => (a.role === b.role ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.role < b.role ? -1 : 1)),
      }));
  }

  async names(): Promise<NameSummary[]> {
    await this.queue;
    const byKey = new Map<string, { name: string; reservations: Set<string> }>();
    for (const r of this.reservations) {
      for (const p of r.people) {
        const entry = byKey.get(p.key) ?? { name: p.name, reservations: new Set<string>() };
        if (p.name < entry.name) entry.name = p.name;
        entry.reservations.add(r.id);
        byKey.set(p.key, entry);
      }
    }
    return [...byKey.entries()].map(([key, v]) => ({ key, name: v.name, rows: v.reservations.size })).sort((a, b) => b.rows - a.rows || (a.key < b.key ? -1 : 1));
  }
}
