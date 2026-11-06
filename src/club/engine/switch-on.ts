import { normalizeEmail } from "../auth/email";
import { MailSettingsError, parseMailSettings } from "../auth/mail-settings";
import { StaffListError, parseStaffLogins, type StaffListProblem } from "../auth/staff-list";
import { sampleDataAllowed } from "../enabled";
import { configuredSiteOrigin } from "../site-url";
import type { ClubState } from "../types";

/**
 * The ready-to-switch-on checklist (Grant, Nov 6, 2026). The building comparison: the walk-through before opening day. Someone goes
 * round every door, light and lock and writes down which work and which do not, in words the owner can read, and says who has to fix
 * each. It changes nothing and opens nothing: it only reads.
 *
 * It reads two things: the private settings of the server that is showing it, and a few counts from the club's records. It can
 * therefore only speak for the server in front of it. On the demo it reports on the demo's settings, which is why several lines read
 * "not ready" there on purpose; the same screen on the real server is the go or no-go.
 *
 * Nothing secret is ever written into a row: a secret is only ever "set" or "not set", the email key is never shown, and staff are named
 * but their addresses are not.
 */

type Env = Partial<Record<string, string | undefined>>;

export type CheckStatus = "ready" | "not_ready" | "person";
export type CheckGroup = "settings" | "records" | "people";

export interface CheckRow {
  /** A short fixed name, used by the screen's test ids and by the tests. */
  id: string;
  group: CheckGroup;
  title: string;
  status: CheckStatus;
  /** What was found, in plain words. For a line only a person can confirm, why it matters. */
  detail: string;
  /** What to do and who does it. Empty for a line that is ready. */
  fix: string;
}

export interface SwitchOnInput {
  /** The private settings of the server showing the list. */
  env: Env;
  state: Pick<ClubState, "households" | "members" | "items">;
  /** What the archive of old iCrew bookings holds: how many bookings, and the names of the files added. */
  archive: { rows: number; fileNames: string[] };
  /** Where the invented sample club leaves its marks, so it can be told apart from real records. */
  sample: { itemNames: readonly string[]; archiveFile: string };
  /** The rules files whose numbers are still placeholders. */
  placeholderRules: readonly string[];
  /** The host, port and database name of the club's database (never the user or password), or null when there is none. */
  databaseTarget: string | null;
}

export interface SwitchOnReport {
  rows: CheckRow[];
  counts: { ready: number; notReady: number; person: number };
  /** One sentence that says where things stand. It never says "ready to switch on": the people's lines are never all done by a computer. */
  verdict: string;
  /** Whether this server allows invented data (a test build) or not (where real records would live). */
  lookingAt: "test_build" | "real_records";
}

/** The invented households carry IDs like SAMPLE-1001 where a real roster carries QuickBooks's. */
export const SAMPLE_ID_PREFIX = "SAMPLE-";
/** The shortest a private secret may be (the same as the secrets' own checks). */
const SECRET_MIN_LENGTH = 16;
/** At most this many names are written out in a line before it says "and N more". */
const MOST_NAMES = 5;

const plural = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function names(list: string[]): string {
  if (list.length <= MOST_NAMES) return list.join(", ");
  return `${list.slice(0, MOST_NAMES).join(", ")}, and ${list.length - MOST_NAMES} more`;
}

function row(id: string, group: CheckGroup, title: string, status: CheckStatus, detail: string, fix = ""): CheckRow {
  return { id, group, title, status, detail, fix };
}

function secretRow(env: Env, setting: string, id: string, title: string, whatItMeans: string): CheckRow {
  const value = env[setting] ?? "";
  if (value === "") return row(id, "settings", title, "not_ready", `${setting} is not set, so ${whatItMeans}.`, `Set ${setting} to at least ${SECRET_MIN_LENGTH} random characters in the site's private settings (Vercel).`);
  if (value.length < SECRET_MIN_LENGTH) return row(id, "settings", title, "not_ready", `${setting} is set but shorter than ${SECRET_MIN_LENGTH} characters, so it is refused.`, `Replace it with at least ${SECRET_MIN_LENGTH} random characters in the site's private settings (Vercel).`);
  return row(id, "settings", title, "ready", `${setting} is set.`);
}

function databaseRow(env: Env, target: string | null): CheckRow {
  const title = "A real database holds the records";
  const url = env.CLUB_DATABASE_URL?.trim() ?? "";
  if (url === "") {
    return row("database", "settings", title, "not_ready", "No database is connected, so records are kept in this server's memory and are lost whenever it restarts.", "Decide where the club's real database lives (this is a question of money and of the club's safety rules), then set CLUB_DATABASE_URL in the site's private settings.");
  }
  if (env.CLUB_AUTO_MIGRATE === "1") {
    return row("database", "settings", title, "not_ready", "The throwaway set-up switch (CLUB_AUTO_MIGRATE) is on. It builds a database by itself and loads the invented club, and is only meant for test versions.", "Remove CLUB_AUTO_MIGRATE from the settings where the real records live.");
  }
  if (/supabase\.(co|com|net)\b/i.test(target ?? "")) {
    return row("database", "settings", title, "not_ready", "The database address looks like a hosted Supabase project, which the club's code refuses on purpose (the dashboard's real data lives there).", "Point CLUB_DATABASE_URL at a database made just for the club.");
  }
  return row("database", "settings", title, "ready", `Records are kept in the database at ${target ?? "the address that is set"}.`);
}

/** What was wrong with the staff list, in words that never quote an entry (an entry holds a private email address). */
const STAFF_PROBLEM_WORDS: Record<StaffListProblem, string> = {
  too_many: "The list has more people than it allows.",
  no_equals: "An entry has no equals sign between the email address and the name.",
  bad_email: "An entry does not begin with a usable email address.",
  no_name: "An entry has no name after the equals sign.",
  name_too_long: "A name is longer than the limit.",
  name_has_equals: "A name contains an equals sign.",
  duplicate: "The same email address is listed twice.",
};

function staffRow(env: Env): CheckRow {
  const title = "Staff can sign in";
  try {
    const staff = parseStaffLogins(env.CLUB_STAFF_LOGINS);
    if (staff.length === 0) {
      return row("staff_list", "settings", title, "not_ready", "Nobody is on the staff list, so nobody could sign in to the staff office.", "Set CLUB_STAFF_LOGINS in the site's private settings: each person's email address, an equals sign and their name, separated by semicolons.");
    }
    return row("staff_list", "settings", title, "ready", `${plural(staff.length, "person is", "people are")} on the staff list: ${names(staff.map((s) => s.name))}.`);
  } catch (e) {
    if (!(e instanceof StaffListError)) throw e;
    return row("staff_list", "settings", title, "not_ready", `The staff list has a mistake. ${STAFF_PROBLEM_WORDS[e.problem]} The entry itself is not shown here, because it holds a private address.`, "Fix CLUB_STAFF_LOGINS in the site's private settings.");
  }
}

function siteRow(env: Env): CheckRow {
  const title = "Emails point at the right website";
  const origin = configuredSiteOrigin(env);
  if (origin === undefined) {
    return row("site_address", "settings", title, "not_ready", "CLUB_SITE_URL is not set, so a sign-in link has no safe address to point at and emails carry no links.", "Set CLUB_SITE_URL to the address members will use, starting with https://, in the site's private settings.");
  }
  if (origin === null) {
    return row("site_address", "settings", title, "not_ready", "CLUB_SITE_URL is set but is not a web address.", "Set CLUB_SITE_URL to the address members will use, starting with https://.");
  }
  if (!origin.startsWith("https://")) {
    return row("site_address", "settings", title, "not_ready", `CLUB_SITE_URL is ${origin}, which is not a secure (https) address. A sign-in link must be on one.`, "Set CLUB_SITE_URL to an address that starts with https://.");
  }
  return row("site_address", "settings", title, "ready", `Emails link to ${origin}.`);
}

function mailRow(env: Env): CheckRow {
  const title = "The real email sender is set up";
  const testBuild = sampleDataAllowed(env) ? " (On a test build the emails still go to the test outbox, so this only counts on the real server.)" : "";
  try {
    const settings = parseMailSettings(env);
    if (!settings) {
      return row("email_sender", "settings", title, "not_ready", "No email key is set, so no real sign-in link or notice could be sent.", "Create the Resend account under the club's shared email, then set RESEND_API_KEY and CLUB_MAIL_FROM in the site's private settings.");
    }
    const replies = settings.replyTo === null ? "Replies are switched off." : `Replies go to ${settings.replyTo}.`;
    return row("email_sender", "settings", title, "ready", `Emails come from ${settings.from}. ${replies}${testBuild}`);
  } catch (e) {
    if (!(e instanceof MailSettingsError)) throw e;
    return row("email_sender", "settings", title, "not_ready", `The email settings have a mistake: ${e.message}`, "Fix the email settings in the site's private settings, then try npm run mail:test.");
  }
}

function recordRows(input: SwitchOnInput): CheckRow[] {
  const { state, archive, sample } = input;
  const sampleItems = new Set(sample.itemNames.map((n) => n.trim().toLowerCase()));
  const sampleHouseholds = state.households.filter((h) => h.quickbooksId?.startsWith(SAMPLE_ID_PREFIX));
  const sampleBoats = state.items.filter((i) => sampleItems.has(i.name.trim().toLowerCase()));
  const sampleArchive = archive.rows > 0 && archive.fileNames.length > 0 && archive.fileNames.every((f) => f === sample.archiveFile);

  const rows: CheckRow[] = [];
  const leftovers = [
    sampleHouseholds.length > 0 ? `${plural(sampleHouseholds.length, "household")} with invented IDs` : "",
    sampleBoats.length > 0 ? plural(sampleBoats.length, "invented boat or space", "invented boats and spaces") : "",
    sampleArchive ? "the invented old bookings" : "",
  ].filter((part) => part !== "");
  rows.push(
    leftovers.length > 0
      ? row(
          "no_sample_data",
          "records",
          "The invented sample club is gone",
          "not_ready",
          `The invented club is still here: ${leftovers.join("; ")}. Real records need a database that never held it.`,
          "Use a fresh database for the real club, and load the real roster, equipment list and old bookings into it.",
        )
      : row("no_sample_data", "records", "The invented sample club is gone", "ready", "No invented households, boats or old bookings are here."),
  );

  const active = state.households.filter((h) => h.status === "active");
  if (active.length === 0) {
    const none = "No households are loaded yet.";
    rows.push(row("households_loaded", "records", "Real households are loaded", "not_ready", none, "Use Import households with the real roster file (staff assemble it from the QuickBooks customer list)."));
    rows.push(row("quickbooks_ids", "records", "Every household has a QuickBooks ID", "not_ready", `${none} There is nothing to check yet.`, "Load the households first."));
    rows.push(row("can_sign_in", "records", "Every household has someone who can sign in", "not_ready", `${none} There is nothing to check yet.`, "Load the households first."));
  } else {
    const adults = state.members.filter((m) => m.status === "active" && active.some((h) => h.id === m.householdId));
    rows.push(row("households_loaded", "records", "Real households are loaded", "ready", `${plural(active.length, "active household")} with ${plural(adults.length, "adult")}.`));

    const noId = active.filter((h) => !h.quickbooksId || h.quickbooksId.trim() === "");
    rows.push(
      noId.length === 0
        ? row("quickbooks_ids", "records", "Every household has a QuickBooks ID", "ready", "Every active household can be billed.")
        : row(
            "quickbooks_ids",
            "records",
            "Every household has a QuickBooks ID",
            "not_ready",
            `${plural(noId.length, "household")} ${noId.length === 1 ? "has" : "have"} no QuickBooks ID: ${names(noId.map((h) => h.displayName))}. A month cannot be closed while one of them has something to pay.`,
            "Add each ID on the household's page, or in the roster file before it is loaded.",
          ),
    );

    const cannot = active.filter((h) => !adults.some((m) => m.householdId === h.id && normalizeEmail(m.email) !== null));
    rows.push(
      cannot.length === 0
        ? row("can_sign_in", "records", "Every household has someone who can sign in", "ready", "Every active household has an adult with an email address the sign-in can use.")
        : row(
            "can_sign_in",
            "records",
            "Every household has someone who can sign in",
            "not_ready",
            `${plural(cannot.length, "household")} ${cannot.length === 1 ? "has" : "have"} no adult with a usable email address: ${names(cannot.map((h) => h.displayName))}.`,
            "Correct the address on the household's page (Change name, email or phone).",
          ),
    );
  }

  const real = state.items.filter((i) => !i.retired && !sampleItems.has(i.name.trim().toLowerCase()));
  if (real.length === 0) {
    const detail = sampleBoats.length > 0 ? "Only the invented boats and spaces are on the list." : "No boats or spaces are on the list yet.";
    rows.push(row("equipment_loaded", "records", "The real boats and spaces are loaded", "not_ready", detail, "Fill in the equipment sheet and use Load the equipment list."));
  } else {
    const privateBoats = real.filter((i) => i.isPrivate).length;
    const pools = real.filter((i) => (i.places ?? 1) > 1).length;
    rows.push(row("equipment_loaded", "records", "The real boats and spaces are loaded", "ready", `${plural(real.length, "boat and space", "boats and spaces")} on the list, including ${plural(privateBoats, "private boat")} and ${plural(pools, "pool")}.`));
  }

  const realArchive = archive.rows > 0 && !sampleArchive;
  rows.push(
    realArchive
      ? row("archive_loaded", "records", "Old iCrew bookings are loaded", "ready", `${plural(archive.rows, "old booking")} stored.`)
      : row(
          "archive_loaded",
          "records",
          "Old iCrew bookings are loaded",
          "not_ready",
          archive.rows === 0 ? "No old bookings are stored, so every member's My old bookings page would be empty." : "Only the invented sample bookings are stored.",
          "Use Old bookings to add iCrew's Reservations report (2026 for now, in pieces if it is over 4 MB).",
        ),
  );
  return rows;
}

/** Things only a person can confirm. A computer cannot tell whether a DNS record was added, so these are listed and never ticked. */
const PEOPLE: { id: string; title: string; detail: string; fix: string }[] = [
  {
    id: "domain_records",
    title: "The email domain is verified",
    detail: "Resend only sends from a domain it has verified, and the records that prove it go into the domain's settings. Nothing here can see those records; Resend says so at the moment of sending.",
    fix: "Whoever holds collegeclubseattle.com's settings adds the records Resend gives.",
  },
  {
    id: "tracking_off",
    title: "Resend's link and open tracking is switched off",
    detail: "A tracked link goes through Resend's servers first, and a sign-in link's one-time secret is in the address it rewrites.",
    fix: "Whoever opens the Resend account switches both off for the domain.",
  },
  {
    id: "mail_test",
    title: "A test email arrived in a staff inbox, not in spam",
    detail: "npm run mail:test sends exactly one test email through the real sender.",
    fix: "Claude runs it with a staff address Grant names; a staff member checks the inbox and the spam folder.",
  },
  {
    id: "sales_tax",
    title: "The bookkeeper has said whether QuickBooks Online's automated sales tax is on",
    detail: "QuickBooks Online's invoice import is unavailable while it is on, which would leave the plain charges file as the only way in.",
    fix: "The bookkeeper checks the QuickBooks account.",
  },
  {
    id: "quickbooks_names",
    title: "QuickBooks product and customer names match what the files use",
    detail: "QuickBooks matches product and service names exactly, and each household's name must be the same in QuickBooks.",
    fix: "Staff and the bookkeeper compare the names in the billing rules with QuickBooks.",
  },
  {
    id: "equipment_confirmed",
    title: "Staff have checked the equipment sheet",
    detail: "Seat counts, skill levels, who owns each private boat and the pool sizes (dock, club room, gym) come from people, not from the booking history.",
    fix: "Staff fill in and check the sheet before it is loaded.",
  },
  {
    id: "future_bookings",
    title: "Boats already booked in iCrew for after the switch come over",
    detail: "Grant's choice (Nov 6): bring them over as real bookings after staff check the list. The tool for this is not built yet, and it needs an iCrew report of future reservations.",
    fix: "Claude builds it when Grant asks; Grant sends the report.",
  },
  {
    id: "icrew_freeze",
    title: "iCrew stops taking boat bookings at the moment of the switch",
    detail: "Boats move all at once. If both systems took boat bookings, the same boat could be promised twice.",
    fix: "Grant decides the moment and tells members.",
  },
  {
    id: "switch_date",
    title: "The switch-on date, who approves it, and where the dashboard goes",
    detail: "The public site needs the home address, so the dashboard has to move. Switching on is one deliberate change to the code, made only on Grant's say-so.",
    fix: "Grant and the board decide; then Claude prepares the change.",
  },
];

/** What the checklist needs to know about the archive of old iCrew bookings, from the archive's own summary: how many bookings, and the names of the files added. */
export function archiveFacts(summary: { rows: number; imports: { fileName: string }[] }): SwitchOnInput["archive"] {
  return { rows: summary.rows, fileNames: summary.imports.map((i) => i.fileName) };
}

/** Builds the checklist. Reads only; nothing is changed. */
export function switchOnReport(input: SwitchOnInput): SwitchOnReport {
  const { env } = input;
  const invented = sampleDataAllowed(env);
  const rows: CheckRow[] = [
    databaseRow(env, input.databaseTarget),
    invented
      ? row("invented_data_off", "settings", "Test tools are switched off", "not_ready", "Invented data is allowed on this server, so the test-member picker, the test outbox and the sample club are available. That is right for a test version and wrong for the real one.", "Nothing to change on a test version. On the real server these switch themselves off.")
      : row("invented_data_off", "settings", "Test tools are switched off", "ready", "Invented data is not allowed on this server."),
    staffRow(env),
    siteRow(env),
    mailRow(env),
    secretRow(env, "CLUB_LINK_SECRET", "link_secret", "Personal event links will work", "personal RSVP links in emails would not work (a deployed server with no secret has no links)"),
    secretRow(env, "CLUB_IPAD_SECRET", "ipad_secret", "The front-desk iPad has an address", "there is no front-desk iPad and no snack bar iPad (a deployed server with no secret has none)"),
    (env.CCS_DEMO_URL?.trim() ?? "") === ""
      ? row("demo_link_removed", "settings", "The demo link is off the live menu", "ready", "The live dashboard's menu carries no link to the demo.")
      : row("demo_link_removed", "settings", "The demo link is off the live menu", "not_ready", "CCS_DEMO_URL is set, so the dashboard's menu still links to the demo.", "Remove CCS_DEMO_URL from the Production settings when the system is switched on."),
    ...recordRows(input),
    input.placeholderRules.length === 0
      ? row("rules_confirmed", "records", "The house-rule numbers are confirmed", "ready", "No rules file still marks its numbers as placeholders.")
      : row(
          "rules_confirmed",
          "records",
          "The house-rule numbers are confirmed",
          "not_ready",
          `${plural(input.placeholderRules.length, "rules file")} still ${input.placeholderRules.length === 1 ? "marks its numbers" : "mark their numbers"} as placeholders: ${names(input.placeholderRules.map((f) => f.replace(/\.json$/, "")))}.`,
          "Staff and the bookkeeper confirm each number (the numbers sheet); then the file's placeholder mark is turned off through Claude Code.",
        ),
    ...PEOPLE.map((p) => row(p.id, "people", p.title, "person", p.detail, p.fix)),
  ];

  const counts = {
    ready: rows.filter((r) => r.status === "ready").length,
    notReady: rows.filter((r) => r.status === "not_ready").length,
    person: rows.filter((r) => r.status === "person").length,
  };
  const verdict =
    counts.notReady > 0
      ? `${plural(counts.notReady, "thing")} to fix before switch-on, and ${plural(counts.person, "thing")} only a person can confirm.`
      : `Every check the computer can make passes. ${plural(counts.person, "thing")} still need${counts.person === 1 ? "s" : ""} a person to confirm.`;
  return { rows, counts, verdict, lookingAt: invented ? "test_build" : "real_records" };
}
