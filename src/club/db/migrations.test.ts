import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUALIFICATIONS } from "../qualifications";
import { createScratchDb, looksLikeHostedSupabase, type ScratchDb } from "./testdb";

/**
 * These run the real migration files against a real Postgres, so the rules the database enforces by
 * itself are tested for real. They need CLUB_TEST_DATABASE_URL, an address for a LOCAL or throwaway
 * Postgres (CI starts one for free). Without it they are skipped, and CI refuses to skip them.
 */
const ADMIN_URL = process.env.CLUB_TEST_DATABASE_URL;

describe("test database safety", () => {
  it("refuses anything that looks like a hosted Supabase project", async () => {
    for (const url of [
      "postgresql://postgres:x@db.hgjcnuwxhemynnvsnmou.supabase.co:5432/postgres",
      "postgresql://postgres.abc:x@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
      "postgres://u:p@something.supabase.net/db",
    ]) {
      expect(looksLikeHostedSupabase(url), url).toBe(true);
      await expect(createScratchDb(url), url).rejects.toThrow("looks like a hosted Supabase project");
    }
    expect(looksLikeHostedSupabase("postgresql://postgres@127.0.0.1:5432/postgres")).toBe(false);
    expect(looksLikeHostedSupabase("postgresql://postgres:postgres@localhost:54322/postgres")).toBe(false);
  });

  it("is not skipped in CI", () => {
    if (process.env.CI) expect(ADMIN_URL, "CI must provide CLUB_TEST_DATABASE_URL so the database tests really run").toBeTruthy();
  });
});

describe.skipIf(!ADMIN_URL)("the club database", () => {
  let db: ScratchDb;
  const q = (sql: string, params: unknown[] = []) => db.client.query(sql, params);

  beforeAll(async () => {
    db = await createScratchDb(ADMIN_URL!);
  });
  afterAll(async () => {
    await db?.drop();
  });

  let n = 0;
  async function household(extra: Partial<{ type: string; joined: string }> = {}): Promise<string> {
    n += 1;
    const { rows } = await q(`insert into club.households (display_name, membership_type, joined_on) values ($1, $2, $3) returning id`, [
      `The Test ${n} household`,
      extra.type ?? "Resident",
      extra.joined ?? "2020-01-01",
    ]);
    return rows[0].id;
  }
  async function member(householdId: string, role = "additional", first = "Pat", email = "pat@example.com"): Promise<string> {
    const { rows } = await q(`insert into club.members (household_id, first_name, last_name, email, role) values ($1, $2, 'Test', $3, $4) returning id`, [householdId, first, email, role]);
    return rows[0].id;
  }

  it("keeps everything in its own schema and nothing in public", async () => {
    const { rows } = await q(`select table_schema, table_name from information_schema.tables where table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`);
    expect(new Set(rows.map((r) => r.table_schema))).toEqual(new Set(["club"]));
    expect(rows.map((r) => r.table_name)).toEqual([
      "attendance_log",
      "billing_lines",
      "billing_runs",
      "booking_crew",
      "booking_rule_defaults",
      "bookings",
      "charges",
      "class_rule_defaults",
      "class_sessions",
      "class_signups",
      "classes",
      "damage_log",
      "damage_reports",
      "event_rsvps",
      "event_rule_defaults",
      "events",
      "history_imports",
      "household_history",
      "households",
      "incident_boats",
      "incident_log",
      "incident_people",
      "incidents",
      "item_access",
      "item_classes",
      "items",
      "legacy_reservation_people",
      "legacy_reservations",
      "login_tokens",
      "member_qualifications",
      "members",
      "out_of_service",
      "practice_boats",
      "practice_seats",
      "practices",
      "qualifications",
      "sessions",
      "tour_requests",
      "visitor_entries",
    ]);
  });

  it("locks every table to the owner: row level security on, no policies", async () => {
    const { rows } = await q(`select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'club' and c.relkind = 'r'`);
    expect(rows).toHaveLength(39);
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    expect((await q(`select count(*)::int as n from pg_policies where schemaname = 'club'`)).rows[0].n).toBe(0);
  });

  it("starts with the same placeholder qualifications as the app", async () => {
    const { rows } = await q(`select code, name, track, rank from club.qualifications order by code`);
    expect(rows).toEqual([...QUALIFICATIONS].sort((a, b) => a.code.localeCompare(b.code)));
  });

  describe("households", () => {
    it("gets a permanent ID, starts active, and has empty slots", async () => {
      const id = await household();
      const { rows } = await q(`select * from club.households where id = $1`, [id]);
      expect(rows[0]).toMatchObject({ status: "active", ended_on: null, quickbooks_id: null, notes: "" });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("refuses a bad type, an empty name, an end date without 'ended', 'ended' without a date, and an end before the join", async () => {
      const insert = (name: string, type: string, status: string, ended: string | null, joined = "2020-01-01") =>
        q(`insert into club.households (display_name, membership_type, status, ended_on, joined_on) values ($1, $2, $3, $4, $5)`, [name, type, status, ended, joined]);
      await expect(insert("X", "Gold", "active", null)).rejects.toThrow(/membership_type/);
      await expect(insert("", "Resident", "active", null)).rejects.toThrow(/display_name/);
      await expect(insert("X", "Resident", "active", "2024-01-01")).rejects.toThrow(/households_end_date_matches_status/);
      await expect(insert("X", "Resident", "ended", null)).rejects.toThrow(/households_end_date_matches_status/);
      await expect(insert("X", "Resident", "ended", "2019-12-31")).rejects.toThrow(/households_end_after_join/);
      await expect(insert("X", "Resident", "paused", null)).rejects.toThrow(/status/);
    });

    it("allows many households without a QuickBooks ID but never two with the same one", async () => {
      await household();
      await household();
      await household();
      const withId = (name: string) => q(`insert into club.households (display_name, membership_type, joined_on, quickbooks_id) values ($1, 'Resident', '2020-01-01', 'QB-1')`, [name]);
      await withId("First with the ID");
      await expect(withId("Second with the same ID")).rejects.toThrow(/quickbooks_id/);
    });

    it("cannot be deleted while it has people in it", async () => {
      const h = await household();
      await member(h, "primary");
      await expect(q(`delete from club.households where id = $1`, [h])).rejects.toThrow(/foreign key/);
    });
  });

  describe("members", () => {
    it("allows only one active primary adult per household, and a replacement once the old one has left", async () => {
      const h = await household();
      const first = await member(h, "primary", "Ann", "ann@example.com");
      await expect(member(h, "primary", "Bo", "bo@example.com")).rejects.toThrow(/members_one_active_primary/);
      await q(`update club.members set status = 'removed' where id = $1`, [first]);
      await member(h, "primary", "Bo", "bo@example.com");
      // Other households are unaffected.
      await member(await household(), "primary", "Cy", "cy@example.com");
    });

    it("lets partners share one email address", async () => {
      const h = await household();
      await member(h, "primary", "Ann", "shared@example.com");
      await member(h, "additional", "Bo", "shared@example.com");
    });

    it("gives each member a permanent ID with empty link slots, and lets each outside ID belong to one member only", async () => {
      const h = await household();
      const a = await member(h, "primary", "Ann", "a@example.com");
      const b = await member(h, "additional", "Bo", "b@example.com");
      const { rows } = await q(`select * from club.members where id = $1`, [a]);
      expect(rows[0]).toMatchObject({ brivo_credential_id: null, mailchimp_contact_id: null, login_id: null, status: "active" });
      await q(`update club.members set brivo_credential_id = 'BR-9', mailchimp_contact_id = 'MC-9', login_id = gen_random_uuid() where id = $1`, [a]);
      await expect(q(`update club.members set brivo_credential_id = 'BR-9' where id = $1`, [b])).rejects.toThrow(/brivo_credential_id/);
      await expect(q(`update club.members set mailchimp_contact_id = 'MC-9' where id = $1`, [b])).rejects.toThrow(/mailchimp_contact_id/);
    });

    it("cannot move to another household, and cannot come back once removed or ended", async () => {
      const h1 = await household();
      const h2 = await household();
      const m = await member(h1, "primary");
      await expect(q(`update club.members set household_id = $1 where id = $2`, [h2, m])).rejects.toThrow("cannot be moved");
      await q(`update club.members set status = 'removed' where id = $1`, [m]);
      await expect(q(`update club.members set status = 'active' where id = $1`, [m])).rejects.toThrow("cannot be made active again");
      await expect(q(`update club.members set status = 'household_ended' where id = $1`, [m])).rejects.toThrow("cannot be made active again");
    });

    it("refuses a bad role or status", async () => {
      const h = await household();
      await expect(member(h, "boss")).rejects.toThrow(/role/);
      await expect(q(`insert into club.members (household_id, first_name, last_name, email, role, status) values ($1, 'A', 'B', 'a@b.co', 'primary', 'gone')`, [h])).rejects.toThrow(/status/);
    });
  });

  describe("history", () => {
    async function entry(h: string, kind = "joined") {
      return q(`insert into club.household_history (household_id, kind, summary, actor_kind, actor_label) values ($1, $2, 'Something happened.', 'staff', 'Test staff') returning id`, [h, kind]);
    }

    it("can be added to, with a time and an actor", async () => {
      const h = await household();
      const { rows } = await entry(h);
      const saved = (await q(`select * from club.household_history where id = $1`, [rows[0].id])).rows[0];
      expect(saved).toMatchObject({ kind: "joined", actor_kind: "staff", actor_label: "Test staff", details: {} });
      expect(saved.at).toBeInstanceOf(Date);
    });

    it("can never be edited, deleted or emptied", async () => {
      const h = await household();
      const { rows } = await entry(h);
      await expect(q(`update club.household_history set summary = 'Changed.' where id = $1`, [rows[0].id])).rejects.toThrow("can only be added to");
      await expect(q(`delete from club.household_history where id = $1`, [rows[0].id])).rejects.toThrow("can only be added to");
      await expect(q(`truncate club.household_history`)).rejects.toThrow("can only be added to");
      expect((await q(`select count(*)::int as n from club.household_history where id = $1`, [rows[0].id])).rows[0].n).toBe(1);
    });

    it("refuses an unknown kind or actor", async () => {
      const h = await household();
      await expect(entry(h, "teleported")).rejects.toThrow(/kind/);
      await expect(q(`insert into club.household_history (household_id, kind, summary, actor_kind, actor_label) values ($1, 'joined', 'x', 'robot', 'R')`, [h])).rejects.toThrow(/actor_kind/);
    });
  });

  describe("qualifications", () => {
    const grant = (memberId: string, code: string, kind = "staff") =>
      q(`insert into club.member_qualifications (member_id, qualification_code, granted_by_kind, granted_by_label) values ($1, $2, $3, 'Test staff')`, [memberId, code, kind]);

    it("records the level, who granted it and when", async () => {
      const m = await member(await household(), "primary");
      await grant(m, "scull-2");
      const { rows } = await q(`select * from club.member_qualifications where member_id = $1`, [m]);
      expect(rows[0]).toMatchObject({ qualification_code: "scull-2", granted_by_kind: "staff", granted_by_label: "Test staff" });
      expect(rows[0].granted_at).toBeInstanceOf(Date);
    });

    it("can only be granted by staff, never by a member or the system", async () => {
      const m = await member(await household(), "primary");
      await expect(grant(m, "scull-1", "member")).rejects.toThrow(/granted_by_kind/);
      await expect(grant(m, "scull-1", "system")).rejects.toThrow(/granted_by_kind/);
    });

    it("refuses an unknown level, a repeat, and a member who has left", async () => {
      const h = await household();
      const m = await member(h, "primary");
      const gone = await member(h, "additional", "Gone", "gone@example.com");
      await expect(grant(m, "scull-9")).rejects.toThrow(/foreign key/);
      await grant(m, "scull-1");
      await expect(grant(m, "scull-1")).rejects.toThrow(/duplicate key/);
      await q(`update club.members set status = 'removed' where id = $1`, [gone]);
      await expect(grant(gone, "scull-1")).rejects.toThrow("only be granted to an active member");
    });
  });

  describe("ending a membership", () => {
    const end = (h: string, day = "2026-10-01") => q(`select club.end_household($1, $2, 'staff', null, 'Test staff') as blocked`, [h, day]);

    it("blocks every active adult, ends the household and writes one line in its file, as one step", async () => {
      const h = await household();
      await member(h, "primary", "Ann", "a@example.com");
      await member(h, "additional", "Bo", "b@example.com");
      const left = await member(h, "additional", "Cy", "c@example.com");
      await q(`update club.members set status = 'removed' where id = $1`, [left]);

      expect((await end(h)).rows[0].blocked).toBe(2);

      const state = (await q(`select first_name, status from club.members where household_id = $1 order by first_name`, [h])).rows;
      expect(state).toEqual([
        { first_name: "Ann", status: "household_ended" },
        { first_name: "Bo", status: "household_ended" },
        { first_name: "Cy", status: "removed" }, // already gone: left as it was
      ]);
      const ended = (await q(`select status, to_char(ended_on, 'YYYY-MM-DD') as ended_on from club.households where id = $1`, [h])).rows[0];
      expect(ended).toEqual({ status: "ended", ended_on: "2026-10-01" });
      const history = (await q(`select kind, summary, actor_kind, actor_label, details from club.household_history where household_id = $1`, [h])).rows;
      expect(history).toHaveLength(1);
      // Word for word what the app writes for the same event.
      expect(history[0]).toMatchObject({ kind: "membership_ended", summary: "Membership ended on Oct 1, 2026. 2 adults can no longer book.", actor_kind: "staff", actor_label: "Test staff" });
      expect(history[0].details).toEqual({ endedOn: "2026-10-01", adults: 2 });
    });

    it("says '1 adult' for one", async () => {
      const h = await household();
      await member(h, "primary");
      await end(h, "2026-11-01");
      expect((await q(`select summary from club.household_history where household_id = $1`, [h])).rows[0].summary).toBe("Membership ended on Nov 1, 2026. 1 adult can no longer book.");
    });

    it("leaves other households alone", async () => {
      const a = await household();
      const b = await household();
      await member(a, "primary", "A", "a@example.com");
      const other = await member(b, "primary", "B", "b@example.com");
      await end(a);
      expect((await q(`select status from club.members where id = $1`, [other])).rows[0].status).toBe("active");
      expect((await q(`select status from club.households where id = $1`, [b])).rows[0].status).toBe("active");
    });

    it("is all or nothing: a refused ending changes nothing", async () => {
      const h = await household({ joined: "2020-06-01" });
      const m = await member(h, "primary");
      await expect(end(h, "2020-05-31")).rejects.toThrow("cannot end before it began");
      expect((await q(`select status from club.members where id = $1`, [m])).rows[0].status).toBe("active");
      expect((await q(`select status, ended_on from club.households where id = $1`, [h])).rows[0]).toEqual({ status: "active", ended_on: null });
      expect((await q(`select count(*)::int as n from club.household_history where household_id = $1`, [h])).rows[0].n).toBe(0);
    });

    it("cannot be done twice or for a household that does not exist", async () => {
      const h = await household();
      await end(h);
      await expect(end(h, "2026-10-05")).rejects.toThrow("already ended on Oct 1, 2026");
      await expect(end("00000000-0000-4000-8000-00000000dead")).rejects.toThrow("no longer exists");
    });

    it("cannot be sidestepped: the household cannot be marked ended while an adult is still active", async () => {
      const h = await household();
      await member(h, "primary");
      await expect(q(`update club.households set status = 'ended', ended_on = '2026-10-01' where id = $1`, [h])).rejects.toThrow("Every adult must be taken off");
      expect((await q(`select status from club.households where id = $1`, [h])).rows[0].status).toBe("active");
    });

    it("locks the household afterwards: no new active adults, no changes to what was recorded", async () => {
      const h = await household();
      await member(h, "primary");
      await end(h);
      await expect(member(h, "additional", "New", "new@example.com")).rejects.toThrow("cannot have active members");
      await expect(q(`update club.households set membership_type = 'Non-Resident' where id = $1`, [h])).rejects.toThrow("can no longer be changed");
      await expect(q(`update club.households set status = 'active', ended_on = null where id = $1`, [h])).rejects.toThrow("can no longer be changed");
      await expect(q(`update club.households set ended_on = '2026-12-01' where id = $1`, [h])).rejects.toThrow("can no longer be changed");
    });

    it("keeps everything that came before: earlier history lines and qualifications are untouched", async () => {
      const h = await household();
      const m = await member(h, "primary");
      await q(`insert into club.member_qualifications (member_id, qualification_code, granted_by_kind, granted_by_label) values ($1, 'scull-3', 'staff', 'Test staff')`, [m]);
      await q(`insert into club.household_history (household_id, kind, summary, actor_kind, actor_label) values ($1, 'joined', 'Joined.', 'staff', 'Test staff')`, [h]);
      const before = (await q(`select id, at, summary from club.household_history where household_id = $1`, [h])).rows;
      await end(h);
      const after = (await q(`select id, at, summary from club.household_history where household_id = $1 order by at`, [h])).rows;
      for (const row of before) expect(after).toContainEqual(row);
      expect(after).toHaveLength(before.length + 1);
      expect((await q(`select count(*)::int as n from club.member_qualifications where member_id = $1`, [m])).rows[0].n).toBe(1);
    });

    it("holds up when two people try to end the same household at the same moment: one wins, one is told", async () => {
      const h = await household();
      await member(h, "primary");
      const results = await Promise.allSettled(
        [1, 2].map(async () => {
          const c = new Client({ connectionString: db.url });
          await c.connect();
          try {
            return await c.query(`select club.end_household($1, '2026-10-01', 'staff', null, 'Test staff')`, [h]);
          } finally {
            await c.end();
          }
        }),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await q(`select count(*)::int as n from club.household_history where household_id = $1 and kind = 'membership_ended'`, [h])).rows[0].n).toBe(1);
    });
  });
});
