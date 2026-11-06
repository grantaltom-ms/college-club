import { describe, expect, it } from "vitest";
import type { ClubState, Household, Item, Member } from "../types";
import { createHousehold, endHousehold, setQuickbooksId } from "./households";
import { clubLedger } from "./ledger";
import { SAMPLE_ID_PREFIX, archiveFacts, switchOnReport, type CheckRow, type SwitchOnInput } from "./switch-on";
import { STORE_KINDS, makeStore, staffCtx } from "./testkit";

/**
 * The ready-to-switch-on checklist. The settings checks are pure and run on plain settings; the records checks run on both stores,
 * because the counts they read must come out the same from the in-memory copy and from Postgres.
 */

const PASSWORD = "s3cretDbPassw0rd";
const KEY = "re_abcdefghijklmnop";
const LINK_SECRET = "L".repeat(20);
const IPAD_SECRET = "I".repeat(20);

/** The settings of a server that is ready: the real site, a real database, two staff, the real email sender, both secrets. */
const READY_ENV: Record<string, string> = {
  VERCEL_ENV: "production",
  CLUB_DATABASE_URL: `postgresql://club_user:${PASSWORD}@db.example.org:5432/club`,
  CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer; sam.deskwell@example.org=Sam Deskwell",
  CLUB_SITE_URL: "https://club.example.org",
  RESEND_API_KEY: KEY,
  CLUB_MAIL_FROM: "College Club Seattle <no-reply@example.org>",
  CLUB_LINK_SECRET: LINK_SECRET,
  CLUB_IPAD_SECRET: IPAD_SECRET,
};

const NO_STATE: SwitchOnInput["state"] = { households: [], members: [], items: [] };
const SAMPLE = { itemNames: ["Cormorant", "Dock berths"], archiveFile: "sample.csv" };

function input(over: Partial<SwitchOnInput> = {}): SwitchOnInput {
  return { env: READY_ENV, state: NO_STATE, archive: { rows: 0, fileNames: [] }, sample: SAMPLE, placeholderRules: [], databaseTarget: "db.example.org:5432/club", ...over };
}
const rowOf = (report: { rows: CheckRow[] }, id: string): CheckRow => {
  const found = report.rows.find((r) => r.id === id);
  if (!found) throw new Error(`No row called ${id}`);
  return found;
};
const withEnv = (patch: Record<string, string | undefined>) => {
  const env: Record<string, string | undefined> = { ...READY_ENV, ...patch };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return input({ env });
};
const statusOf = (over: Partial<SwitchOnInput>, id: string) => rowOf(switchOnReport(input(over)), id).status;

describe("the switch-on checklist: settings", () => {
  it("passes every setting line for a server that is set up", () => {
    const report = switchOnReport(input());
    for (const id of ["database", "invented_data_off", "staff_list", "site_address", "email_sender", "link_secret", "ipad_secret", "demo_link_removed"]) {
      expect(rowOf(report, id).status, id).toBe("ready");
      expect(rowOf(report, id).fix, `${id} says what to fix when nothing is wrong`).toBe("");
    }
    expect(report.lookingAt).toBe("real_records");
  });

  describe("the database", () => {
    it("is not ready with no address, and says records are lost on a restart", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_DATABASE_URL: undefined })), "database");
      expect(r.status).toBe("not_ready");
      expect(r.detail).toMatch(/memory/);
      expect(r.detail).toMatch(/restarts/);
      expect(r.fix).toMatch(/CLUB_DATABASE_URL/);
    });
    it("treats an address of only spaces as none", () => {
      expect(rowOf(switchOnReport(withEnv({ CLUB_DATABASE_URL: "   " })), "database").status).toBe("not_ready");
    });
    it("is not ready while the throwaway set-up switch is on, even with an address", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_AUTO_MIGRATE: "1" })), "database");
      expect(r.status).toBe("not_ready");
      expect(r.detail).toMatch(/CLUB_AUTO_MIGRATE/);
      // Only the exact value 1 turns it on, the same as the set-up code reads it.
      expect(rowOf(switchOnReport(withEnv({ CLUB_AUTO_MIGRATE: "0" })), "database").status).toBe("ready");
    });
    it("is not ready for a hosted Supabase address, which the club's code refuses", () => {
      for (const target of ["abcd.supabase.co:5432/postgres", "db.abcd.supabase.com/postgres", "x.supabase.net/p"]) {
        expect(statusOf({ databaseTarget: target }, "database"), target).toBe("not_ready");
      }
      expect(statusOf({ databaseTarget: "supabase-lookalike.example.org/club" }, "database")).toBe("ready");
    });
    it("names the host and database but never the user or the password", () => {
      const r = rowOf(switchOnReport(input()), "database");
      expect(r.detail).toContain("db.example.org:5432/club");
      expect(r.detail).not.toContain(PASSWORD);
      expect(r.detail).not.toContain("club_user");
    });
  });

  describe("test tools", () => {
    it("are off where invented data is not allowed: the real site, or a production build with the sample switch off", () => {
      expect(rowOf(switchOnReport(withEnv({ VERCEL_ENV: "production" })), "invented_data_off").status).toBe("ready");
      expect(rowOf(switchOnReport(withEnv({ VERCEL_ENV: undefined, NODE_ENV: "production" })), "invented_data_off").status).toBe("ready");
    });
    it("are on, and not ready, on a preview, in development, and wherever the sample switch is set", () => {
      for (const patch of [
        { VERCEL_ENV: "preview", NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" },
        { VERCEL_ENV: undefined, NODE_ENV: "development" },
        { VERCEL_ENV: undefined, NODE_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" },
      ]) {
        const report = switchOnReport(withEnv(patch));
        expect(rowOf(report, "invented_data_off").status, JSON.stringify(patch)).toBe("not_ready");
        expect(report.lookingAt).toBe("test_build");
      }
    });
    it("stay off on the real site even if the sample switch is set there", () => {
      expect(rowOf(switchOnReport(withEnv({ VERCEL_ENV: "production", CCS_ALLOW_SAMPLE_DATA: "1" })), "invented_data_off").status).toBe("ready");
    });
  });

  describe("the staff list", () => {
    it("is not ready when empty or unset", () => {
      for (const value of [undefined, "", "  ;  \n "]) expect(rowOf(switchOnReport(withEnv({ CLUB_STAFF_LOGINS: value })), "staff_list").status, String(value)).toBe("not_ready");
    });
    it("is not ready, in the list's own words, when an entry has a mistake", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_STAFF_LOGINS: "alex.staffer@example.org" })), "staff_list");
      expect(r.status).toBe("not_ready");
      expect(r.detail).toMatch(/equals sign/);
      expect(rowOf(switchOnReport(withEnv({ CLUB_STAFF_LOGINS: "a@example.org=A; a@example.org=B" })), "staff_list").detail).toMatch(/listed twice/);
    });
    it("is ready with one person, and says how many there are", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_STAFF_LOGINS: "alex.staffer@example.org=Alex Staffer" })), "staff_list");
      expect(r.status).toBe("ready");
      expect(r.detail).toBe("1 person is on the staff list: Alex Staffer.");
    });
    it("names people but never their email addresses, and cuts a long list to five names", () => {
      const many = Array.from({ length: 7 }, (_, i) => `person${i}@example.org=Person Number${i}`).join("; ");
      const r = rowOf(switchOnReport(withEnv({ CLUB_STAFF_LOGINS: many })), "staff_list");
      expect(r.status).toBe("ready");
      expect(r.detail).toContain("7 people are on the staff list");
      expect(r.detail).toContain("Person Number0");
      expect(r.detail).toContain("Person Number4");
      expect(r.detail).not.toContain("Person Number5");
      expect(r.detail).toContain("and 2 more");
      expect(JSON.stringify(rowOf(switchOnReport(input()), "staff_list"))).not.toContain("@example.org");
    });
  });

  describe("the site address", () => {
    it("is not ready when unset or not a web address", () => {
      expect(rowOf(switchOnReport(withEnv({ CLUB_SITE_URL: undefined })), "site_address").status).toBe("not_ready");
      const bad = rowOf(switchOnReport(withEnv({ CLUB_SITE_URL: "not a web address" })), "site_address");
      expect(bad.status).toBe("not_ready");
      expect(bad.detail).toMatch(/not a web address/);
    });
    it("is not ready for a plain http address, which a sign-in link must not use", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_SITE_URL: "http://club.example.org" })), "site_address");
      expect(r.status).toBe("not_ready");
      expect(r.detail).toMatch(/https/);
    });
    it("is ready for https and shows only the address itself, without a path", () => {
      const r = rowOf(switchOnReport(withEnv({ CLUB_SITE_URL: "https://club.example.org/some/path?x=1" })), "site_address");
      expect(r.status).toBe("ready");
      expect(r.detail).toBe("Emails link to https://club.example.org.");
    });
  });

  describe("the real email sender", () => {
    it("is not ready with no key", () => {
      const r = rowOf(switchOnReport(withEnv({ RESEND_API_KEY: undefined })), "email_sender");
      expect(r.status).toBe("not_ready");
      expect(r.detail).toMatch(/No email key/);
    });
    it("is not ready, in the settings checker's own words, for a badly shaped key or a missing From address", () => {
      const shape = rowOf(switchOnReport(withEnv({ RESEND_API_KEY: "sk_not_resend_at_all" })), "email_sender");
      expect(shape.status).toBe("not_ready");
      expect(shape.detail).toMatch(/start with re_/);
      expect(shape.detail).not.toContain("sk_not_resend_at_all");
      const from = rowOf(switchOnReport(withEnv({ CLUB_MAIL_FROM: undefined })), "email_sender");
      expect(from.status).toBe("not_ready");
      expect(from.detail).toMatch(/CLUB_MAIL_FROM is missing/);
    });
    it("is ready with a good key and From, shows the From line and where replies go, and never shows the key", () => {
      const r = rowOf(switchOnReport(input()), "email_sender");
      expect(r.status).toBe("ready");
      expect(r.detail).toContain("College Club Seattle <no-reply@example.org>");
      expect(r.detail).toContain("Replies go to membership@collegeclubseattle.com.");
      expect(r.detail).not.toContain(KEY);
    });
    it("says replies are off when they are", () => {
      expect(rowOf(switchOnReport(withEnv({ CLUB_MAIL_REPLY_TO: "none" })), "email_sender").detail).toContain("Replies are switched off.");
      expect(rowOf(switchOnReport(withEnv({ CLUB_MAIL_REPLY_TO: "desk@example.org" })), "email_sender").detail).toContain("Replies go to desk@example.org.");
    });
    it("reminds a test build that its emails still go to the test outbox", () => {
      expect(rowOf(switchOnReport(withEnv({ VERCEL_ENV: undefined, NODE_ENV: "development" })), "email_sender").detail).toMatch(/test outbox/);
      expect(rowOf(switchOnReport(input()), "email_sender").detail).not.toMatch(/test outbox/);
    });
  });

  describe("the two private secrets", () => {
    for (const [setting, id] of [["CLUB_LINK_SECRET", "link_secret"], ["CLUB_IPAD_SECRET", "ipad_secret"]] as const) {
      it(`${setting}: unset and too short are not ready, exactly 16 characters is ready, and the value is never shown`, () => {
        expect(rowOf(switchOnReport(withEnv({ [setting]: undefined })), id).status).toBe("not_ready");
        expect(rowOf(switchOnReport(withEnv({ [setting]: "" })), id).status).toBe("not_ready");
        const short = rowOf(switchOnReport(withEnv({ [setting]: "s".repeat(15) })), id);
        expect(short.status).toBe("not_ready");
        expect(short.detail).toMatch(/shorter than 16/);
        const exact = rowOf(switchOnReport(withEnv({ [setting]: "e".repeat(16) })), id);
        expect(exact.status).toBe("ready");
        expect(JSON.stringify(exact)).not.toContain("e".repeat(16));
        expect(JSON.stringify(short)).not.toContain("s".repeat(15));
      });
    }
  });

  it("is not ready while the dashboard's menu still links to the demo", () => {
    expect(rowOf(switchOnReport(withEnv({ CCS_DEMO_URL: "https://ccs-club-demo.vercel.app" })), "demo_link_removed").status).toBe("not_ready");
    expect(rowOf(switchOnReport(withEnv({ CCS_DEMO_URL: "   " })), "demo_link_removed").status).toBe("ready");
  });
});

describe("the switch-on checklist: the rules files", () => {
  it("is ready when no file is a placeholder, and lists the files that still are, without the .json", () => {
    expect(rowOf(switchOnReport(input()), "rules_confirmed").status).toBe("ready");
    const r = rowOf(switchOnReport(input({ placeholderRules: ["billing-rules.json", "booking-rules.json"] })), "rules_confirmed");
    expect(r.status).toBe("not_ready");
    expect(r.detail).toBe("2 rules files still mark their numbers as placeholders: billing-rules, booking-rules.");
    expect(rowOf(switchOnReport(input({ placeholderRules: ["snack-rules.json"] })), "rules_confirmed").detail).toBe("1 rules file still marks its numbers as placeholders: snack-rules.");
  });
});

/** A household and one adult built by hand, for the cases the engine refuses to make. */
const hh = (id: string, over: Partial<Household> = {}): Household => ({ id, displayName: `The ${id} household`, membershipType: "Resident", status: "active", joinedOn: "2020-01-01", endedOn: null, quickbooksId: `QB-${id}`, notes: "", ...over });
const adult = (id: string, householdId: string, over: Partial<Member> = {}): Member => ({ id, householdId, firstName: id, lastName: "Test", email: `${id}@example.org`, phone: "", role: "primary", status: "active", brivoCredentialId: null, mailchimpContactId: null, loginId: null, ...over });
const boat = (name: string, over: Partial<Item> = {}): Item => ({ id: `item-${name}`, name, classCode: "shell-single", ruleOverrides: {}, ...over });
const stateOf = (parts: Partial<Pick<ClubState, "households" | "members" | "items">>): SwitchOnInput["state"] => ({ ...NO_STATE, ...parts });

describe("the switch-on checklist: records, from plain records", () => {
  it("with nothing loaded, says so on every records line instead of passing them for nothing", () => {
    const report = switchOnReport(input());
    expect(rowOf(report, "households_loaded").status).toBe("not_ready");
    for (const id of ["quickbooks_ids", "can_sign_in"]) {
      expect(rowOf(report, id).status, id).toBe("not_ready");
      expect(rowOf(report, id).detail).toMatch(/nothing to check yet/);
    }
    expect(rowOf(report, "equipment_loaded").status).toBe("not_ready");
    expect(rowOf(report, "archive_loaded").status).toBe("not_ready");
    // And the invented club is "gone" when nothing is there at all.
    expect(rowOf(report, "no_sample_data").status).toBe("ready");
  });

  it("counts only active households and their active adults", () => {
    const state = stateOf({
      households: [hh("a"), hh("b"), hh("gone", { status: "ended", endedOn: "2026-10-01", quickbooksId: null })],
      members: [adult("a1", "a"), adult("a2", "a", { role: "additional" }), adult("b1", "b"), adult("g1", "gone"), adult("a3", "a", { status: "removed" })],
    });
    const r = rowOf(switchOnReport(input({ state })), "households_loaded");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("2 active households with 3 adults.");
    // The ended household has no QuickBooks ID and is not asked for one.
    expect(rowOf(switchOnReport(input({ state })), "quickbooks_ids").status).toBe("ready");
  });

  it("names the active households that have no QuickBooks ID (a blank one counts), and cuts a long list to five", () => {
    const state = stateOf({
      households: [hh("a"), hh("b", { quickbooksId: null }), hh("c", { quickbooksId: "   " })],
      members: [adult("a1", "a"), adult("b1", "b"), adult("c1", "c")],
    });
    const r = rowOf(switchOnReport(input({ state })), "quickbooks_ids");
    expect(r.status).toBe("not_ready");
    expect(r.detail).toContain("2 households have no QuickBooks ID: The b household, The c household.");
    const seven = stateOf({ households: Array.from({ length: 7 }, (_, i) => hh(`x${i}`, { quickbooksId: null })), members: Array.from({ length: 7 }, (_, i) => adult(`m${i}`, `x${i}`)) });
    const long = rowOf(switchOnReport(input({ state: seven })), "quickbooks_ids");
    expect(long.detail).toContain("7 households have no QuickBooks ID");
    expect(long.detail).toContain("and 2 more");
    const one = stateOf({ households: [hh("solo", { quickbooksId: null })], members: [adult("s1", "solo")] });
    expect(rowOf(switchOnReport(input({ state: one })), "quickbooks_ids").detail).toContain("1 household has no QuickBooks ID");
  });

  it("names the households where nobody can sign in: no active adult, or an address the sign-in refuses", () => {
    const state = stateOf({
      households: [hh("ok"), hh("badmail"), hh("noadult"), hh("partner")],
      members: [
        adult("o1", "ok"),
        adult("b1", "badmail", { email: "ada..quill@example.org" }),
        adult("n1", "noadult", { status: "removed" }),
        // One partner with no usable address is fine while the other has one.
        adult("p1", "partner", { email: "" }),
        adult("p2", "partner", { role: "additional", email: "p2@example.org" }),
      ],
    });
    const r = rowOf(switchOnReport(input({ state })), "can_sign_in");
    expect(r.status).toBe("not_ready");
    expect(r.detail).toBe("2 households have no adult with a usable email address: The badmail household, The noadult household.");
    const fine = stateOf({ households: [hh("ok")], members: [adult("o1", "ok")] });
    expect(rowOf(switchOnReport(input({ state: fine })), "can_sign_in").status).toBe("ready");
  });

  it("recognises the invented club by its IDs and boat names, however the names are written, and by an archive of nothing else", () => {
    const withHousehold = stateOf({ households: [hh("a", { quickbooksId: `${SAMPLE_ID_PREFIX}1001` })], members: [adult("a1", "a")] });
    expect(rowOf(switchOnReport(input({ state: withHousehold })), "no_sample_data").detail).toContain("1 household with invented IDs");
    const withBoats = stateOf({ households: [hh("a")], members: [adult("a1", "a")], items: [boat("  cormorant "), boat("DOCK BERTHS"), boat("Real boat")] });
    expect(rowOf(switchOnReport(input({ state: withBoats })), "no_sample_data").detail).toContain("2 invented boats and spaces");
    expect(rowOf(switchOnReport(input({ state: stateOf({ items: [boat("Cormorant")] }) })), "no_sample_data").detail).toContain("1 invented boat or space");
    const onlySample = rowOf(switchOnReport(input({ archive: { rows: 9, fileNames: ["sample.csv"] } })), "no_sample_data");
    expect(onlySample.status).toBe("not_ready");
    expect(onlySample.detail).toContain("the invented old bookings");
    // The sample file only marks the archive as invented while it is the only file in it.
    expect(rowOf(switchOnReport(input({ archive: { rows: 9, fileNames: ["sample.csv", "real.csv"] } })), "no_sample_data").status).toBe("ready");
  });

  it("counts real boats and spaces, leaving out retired ones and the invented ones, and says how many are private and pools", () => {
    const state = stateOf({
      items: [
        boat("Real one"),
        boat("Real two", { isPrivate: true }),
        boat("Dock", { classCode: "dock-space", places: 60 }),
        boat("Single place", { classCode: "dock-space", places: 1 }),
        boat("Retired", { retired: { at: "2026-10-01T00:00:00Z", by: { kind: "staff", label: "Test staff" }, reason: "Sold" } }),
        boat("Cormorant"),
      ],
    });
    const r = rowOf(switchOnReport(input({ state })), "equipment_loaded");
    expect(r.status).toBe("ready");
    expect(r.detail).toBe("4 boats and spaces on the list, including 1 private boat and 1 pool.");
    // Only retired or invented items is the same as nothing loaded.
    const nothing = stateOf({ items: [boat("Retired", { retired: { at: "2026-10-01T00:00:00Z", by: { kind: "staff", label: "Test staff" }, reason: "Sold" } }), boat("Cormorant")] });
    expect(rowOf(switchOnReport(input({ state: nothing })), "equipment_loaded").status).toBe("not_ready");
    // The words say which it is: only invented boats, or none at all.
    expect(rowOf(switchOnReport(input({ state: nothing })), "equipment_loaded").detail).toBe("Only the invented boats and spaces are on the list.");
    expect(rowOf(switchOnReport(input({ state: stateOf({ items: [boat("Retired", { retired: { at: "2026-10-01T00:00:00Z", by: { kind: "staff", label: "Test staff" }, reason: "Sold" } })] }) })), "equipment_loaded").detail).toBe("No boats or spaces are on the list yet.");
  });

  it("wants real old bookings: none, or only the invented ones, is not ready", () => {
    expect(rowOf(switchOnReport(input({ archive: { rows: 0, fileNames: [] } })), "archive_loaded").detail).toMatch(/would be empty/);
    const sampleOnly = rowOf(switchOnReport(input({ archive: { rows: 9, fileNames: ["sample.csv"] } })), "archive_loaded");
    expect(sampleOnly.status).toBe("not_ready");
    expect(sampleOnly.detail).toMatch(/invented/);
    const real = rowOf(switchOnReport(input({ archive: { rows: 1, fileNames: ["iCrew-2026.csv"] } })), "archive_loaded");
    expect(real.status).toBe("ready");
    expect(real.detail).toBe("1 old booking stored.");
    expect(rowOf(switchOnReport(input({ archive: { rows: 26_695, fileNames: ["a.csv", "b.csv"] } })), "archive_loaded").detail).toBe("26695 old bookings stored.");
  });
});

describe("the archive facts the screen hands the checklist", () => {
  it("carries the count and the file names, newest first as the archive gives them, and nothing else", () => {
    expect(archiveFacts({ rows: 9, imports: [{ fileName: "b.csv" }, { fileName: "a.csv" }] })).toEqual({ rows: 9, fileNames: ["b.csv", "a.csv"] });
    expect(archiveFacts({ rows: 0, imports: [] })).toEqual({ rows: 0, fileNames: [] });
  });
  it("lets the checklist tell the invented archive from a real one", () => {
    const sampleOnly = archiveFacts({ rows: 9, imports: [{ fileName: SAMPLE.archiveFile }] });
    expect(rowOf(switchOnReport(input({ archive: sampleOnly })), "archive_loaded").status).toBe("not_ready");
    const withReal = archiveFacts({ rows: 20, imports: [{ fileName: "iCrew-2026.csv" }, { fileName: SAMPLE.archiveFile }] });
    expect(rowOf(switchOnReport(input({ archive: withReal })), "archive_loaded").status).toBe("ready");
  });
});

describe.each(STORE_KINDS)("the switch-on checklist: records, read from the %s store", (kind) => {
  const person = (first: string, last: string) => ({ firstName: first, lastName: last, email: `${first}@example.com`.toLowerCase() });

  it("reads an empty club, then a real one household by household, the same on both stores", async () => {
    const store = await makeStore(kind);
    const ctx = staffCtx();
    expect(rowOf(switchOnReport(input({ state: await store.read() })), "households_loaded").status).toBe("not_ready");

    const quill = await createHousehold(store, ctx, { displayName: "The Quill household", membershipType: "Resident", joinedOn: "2020-01-01", primary: person("Ada", "Quill"), additional: [person("Ben", "Quill")] });
    const reed = await createHousehold(store, ctx, { displayName: "The Reed household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: "QB-REED", primary: person("Dee", "Reed") });
    let report = switchOnReport(input({ state: await store.read() }));
    expect(rowOf(report, "households_loaded").detail).toBe("2 active households with 3 adults.");
    expect(rowOf(report, "quickbooks_ids").detail).toContain("1 household has no QuickBooks ID: The Quill household.");
    expect(rowOf(report, "can_sign_in").status).toBe("ready");
    expect(rowOf(report, "no_sample_data").status).toBe("ready");

    await setQuickbooksId(store, ctx, quill.household.id, "QB-QUILL");
    report = switchOnReport(input({ state: await store.read() }));
    expect(rowOf(report, "quickbooks_ids").status).toBe("ready");

    // A household that ends is no longer counted, and no longer needs anything.
    await endHousehold(store, clubLedger, ctx, reed.household.id);
    report = switchOnReport(input({ state: await store.read() }));
    expect(rowOf(report, "households_loaded").detail).toBe("1 active household with 2 adults.");
  });

  it("sees the invented club's marks and its boats, and counts only real items", async () => {
    const store = await makeStore(kind);
    const ctx = staffCtx();
    await createHousehold(store, ctx, { displayName: "The Sample household", membershipType: "Resident", joinedOn: "2020-01-01", quickbooksId: `${SAMPLE_ID_PREFIX}1001`, primary: person("Sam", "Sample") });
    await store.transaction(async (s, newId) => {
      s.items.push({ id: newId(), name: "Cormorant", classCode: "shell-single", ruleOverrides: {} });
      s.items.push({ id: newId(), name: "Albatross", classCode: "shell-quad", ruleOverrides: {} });
    });
    const report = switchOnReport(input({ state: await store.read() }));
    expect(rowOf(report, "no_sample_data").status).toBe("not_ready");
    expect(rowOf(report, "no_sample_data").detail).toContain("1 household with invented IDs");
    expect(rowOf(report, "no_sample_data").detail).toContain("1 invented boat or space");
    expect(rowOf(report, "equipment_loaded").detail).toBe("1 boat and space on the list, including 0 private boats and 0 pools.");
  });
});

describe("the switch-on checklist: the words and the counts", () => {
  it("lists the people's lines, never marks them ready, and says who does each", () => {
    const people = switchOnReport(input()).rows.filter((r) => r.group === "people");
    expect(people.map((r) => r.id)).toEqual(["domain_records", "tracking_off", "mail_test", "sales_tax", "quickbooks_names", "equipment_confirmed", "future_bookings", "icrew_freeze", "switch_date"]);
    for (const r of people) {
      expect(r.status).toBe("person");
      expect(r.fix.length, r.id).toBeGreaterThan(10);
      expect(r.detail.length, r.id).toBeGreaterThan(10);
    }
  });

  it("keeps every row's id unique and puts each in a group", () => {
    const ids = switchOnReport(input()).rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of switchOnReport(input()).rows) expect(["settings", "records", "people"]).toContain(r.group);
  });

  it("says what to do on every line that is not ready, and nothing on a line that is", () => {
    // A server with every setting wrong and nothing loaded, and one with every setting right and the club loaded: between them every line takes both forms.
    const bad = switchOnReport(input({ env: { CLUB_STAFF_LOGINS: "not an entry" }, placeholderRules: ["billing-rules.json"], databaseTarget: null }));
    const real = stateOf({ households: [hh("a")], members: [adult("a1", "a")], items: [boat("Real one")] });
    const good = switchOnReport(input({ state: real, archive: { rows: 5, fileNames: ["iCrew-2026.csv"] } }));
    for (const report of [bad, good]) {
      for (const r of report.rows) {
        if (r.status === "ready") expect(r.fix, `${r.id} is ready and says nothing to do`).toBe("");
        else expect(r.fix.length, `${r.id} says what to do`).toBeGreaterThan(10);
      }
    }
    expect(bad.counts.notReady).toBeGreaterThan(8);
    expect(good.counts.ready).toBeGreaterThan(12);
  });

  it("counts the three kinds, and the counts add up to every row", () => {
    const report = switchOnReport(input());
    expect(report.counts.ready + report.counts.notReady + report.counts.person).toBe(report.rows.length);
    expect(report.counts.person).toBe(9);
    // The settings of a ready server pass; nothing is loaded, so the records lines and the rules line are the ones to fix.
    expect(report.rows.filter((r) => r.status === "not_ready").map((r) => r.id)).toEqual(["households_loaded", "quickbooks_ids", "can_sign_in", "equipment_loaded", "archive_loaded"]);
  });

  it("says how many things are to fix, singular and plural, and never claims the switch-on is ready while people's lines remain", () => {
    expect(switchOnReport(input()).verdict).toBe("5 things to fix before switch-on, and 9 things only a person can confirm.");
    const real = stateOf({ households: [hh("a")], members: [adult("a1", "a")], items: [boat("Real one")] });
    const onlyArchive = switchOnReport(input({ state: real, archive: { rows: 0, fileNames: [] } }));
    expect(onlyArchive.counts.notReady).toBe(1);
    expect(onlyArchive.verdict).toBe("1 thing to fix before switch-on, and 9 things only a person can confirm.");
    const clean = switchOnReport(input({ state: real, archive: { rows: 5, fileNames: ["iCrew-2026.csv"] } }));
    expect(clean.counts.notReady).toBe(0);
    expect(clean.verdict).toBe("Every check the computer can make passes. 9 things still need a person to confirm.");
    expect(clean.verdict).not.toMatch(/ready to switch on/i);
  });

  it("reports on a test build as a test build, and a server where invented data is off as real records", () => {
    expect(switchOnReport(withEnv({ VERCEL_ENV: "preview", CCS_ALLOW_SAMPLE_DATA: "1" })).lookingAt).toBe("test_build");
    expect(switchOnReport(input()).lookingAt).toBe("real_records");
  });

  it("never puts a secret, a key, a password or a staff email address anywhere in the report", () => {
    const state = stateOf({ households: [hh("a")], members: [adult("a1", "a")], items: [boat("Real one")] });
    const everything = JSON.stringify(switchOnReport(input({ state, archive: { rows: 3, fileNames: ["iCrew-2026.csv"] } })));
    for (const secret of [KEY, LINK_SECRET, IPAD_SECRET, PASSWORD, "club_user", "alex.staffer@example.org", "sam.deskwell@example.org", "a1@example.org"]) {
      expect(everything, secret).not.toContain(secret);
    }
  });

  it("does not change the records or the settings it reads", () => {
    const state = stateOf({ households: [hh("a")], members: [adult("a1", "a")], items: [boat("Real one")] });
    const env = { ...READY_ENV };
    const before = JSON.stringify({ state, env });
    switchOnReport(input({ state, env }));
    switchOnReport(input({ state, env }));
    expect(JSON.stringify({ state, env })).toBe(before);
  });
});
