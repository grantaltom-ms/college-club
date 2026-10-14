/**
 * The starting content of the roadmap, from the October 2026 meeting with Caitlin Sogn.
 * One list feeds both the in-memory copy (development and tests) and db/roadmap_seed.sql,
 * so they cannot drift apart. Self-contained on purpose: scripts/roadmap-seed-sql.mjs loads it directly.
 */

export type SeedStatus = "Not started" | "In progress" | "Waiting" | "Done";

export interface SeedSubitem {
  title: string;
  status?: SeedStatus;
  due?: string;
  notes?: string[];
}

export interface SeedItem extends SeedSubitem {
  subitems?: SeedSubitem[];
}

export interface SeedGroup {
  group: string;
  items: SeedItem[];
}

export const SEED: SeedGroup[] = [
  {
    group: "Member engagement",
    items: [
      {
        title: "Goal: the club is at roughly 50% of its potential for programs, communication and engagement",
        status: "In progress",
      },
      {
        title: "Pick 2-3 engagement tracks and configure Mailchimp triggers",
        due: "2026-10-30",
        notes: [
          "Grant owns messaging and tone; Caitlin or another party can write the sequences and build the app layer.",
        ],
        subitems: [
          { title: "Rowing re-engagement: said rower on the application but no rowing reservations" },
          { title: "Happy hour outreach to light-use non-rowers" },
          {
            title:
              "Win-back: no activity for about 2 months, drip email every 3 weeks for 4 months, member removed from the drip automatically on a door swipe",
          },
        ],
      },
      {
        title: "Draft a personal new-member email from Grant, sent about 15 days after joining",
        due: "2026-10-23",
        notes: [
          "Not a Water Cooler blast; tailor to the interest on the application (e.g. rowing). Pairs with a behavior-triggered email: a rower joins, has no reservations after one month, and an email goes out from Grant's address.",
        ],
      },
      {
        title: "Analyze join month against long-term retention and engagement",
        notes: ["Open question from the Caitlin meeting."],
      },
      { title: "Brief Andrew (new board member) on the member engagement work", due: "2026-11-06" },
      {
        title: "Clarify membership committee vs. social committee scope on engagement",
        due: "2026-12-02",
        notes: [
          "Membership scope is unclear (new members vs. existing members); the social committee may see engagement as theirs but has no data or goals.",
        ],
      },
    ],
  },
  {
    group: "Usage data and dashboard",
    items: [
      {
        title: "Export Brivo door-entry and iCrew data on a regular schedule",
        due: "2026-11-06",
        status: "In progress",
        notes: ["Repeats the first Friday of each month; the dashboard is only useful with fresh exports."],
      },
      {
        title: "Usage dashboard: built and live (Overview, Timing, Members, Email)",
        status: "Done",
        notes: ["Members is password protected; bookings are loaded for Jan 2025 to Sep 2026."],
      },
      {
        title: "Connect Mailchimp to the dashboard",
        status: "Waiting",
        notes: [
          "The Email page is built; it shows real numbers once MAILCHIMP_API_KEY is added in Vercel (Grant adds it himself) and the site is redeployed.",
        ],
      },
      {
        title: "Shell usage by month",
        status: "Waiting",
        notes: [
          "The iCrew shell usage report has no dates; re-export it with a date or month column, then add a monthly view.",
        ],
      },
      {
        title: "Refresh member usage groups to the latest month",
        notes: ["Member bands are still through Sep 27, 2026."],
      },
    ],
  },
  {
    group: "Offseason usage and revenue",
    items: [
      {
        title: "Bring the room rental program to the board with usage data",
        due: "2026-10-20",
        status: "In progress",
        notes: [
          "Board meeting, Tuesday 5:30 PM. Rentals currently run Sat-Tue, $500 for 5 hours, unadvertised and booked only on request; demand is clear and price has never been an issue.",
        ],
        subitems: [
          { title: "Recommend room rentals be marketed on the lowest-use days and hours (weekends in non-summer months)" },
          { title: "No specific pricing in the proposal (pricing is a staff decision)" },
          {
            title:
              "Idea: holiday-party rentals in ~4-hour blocks on low-use weekend days; keep rentals Sat-Tue so they don't compete with weekday member traffic",
          },
        ],
      },
      {
        title: "Get gym-only and rowing-only members to social events in slow months",
        notes: [
          "Fixed costs are mostly set, so extra visits mainly add food and beverage revenue; offseason happy hours did well last summer.",
        ],
      },
    ],
  },
  {
    group: "Systems (iCrew and website)",
    items: [
      {
        title: "Decide whether to replace iCrew with a custom reservation and events system",
        notes: ["iCrew and Wix are both month-to-month, so there is no lock-in; iCrew onboarding was only a Zoom demo."],
        subitems: [
          { title: "Boat reservations with reservation-window rules" },
          { title: "Events with Mailchimp links going straight to RSVPs" },
          { title: "Better fitness class reservations" },
          { title: "Reconcile the dual login (iCrew and the website) into one" },
        ],
      },
      {
        title: "Change the door code shown in the old member portal",
        status: "Not started",
        notes: ["Low priority."],
      },
    ],
  },
];

/** Every item and subitem in the seed, counted. */
export function seedCounts(): { items: number; subitems: number; notes: number } {
  let items = 0;
  let subitems = 0;
  let notes = 0;
  for (const g of SEED) {
    for (const item of g.items) {
      items += 1;
      notes += item.notes?.length ?? 0;
      for (const sub of item.subitems ?? []) {
        subitems += 1;
        notes += sub.notes?.length ?? 0;
      }
    }
  }
  return { items, subitems, notes };
}

/** Text between dollar signs, so nothing in it needs escaping. */
const q = (text: string) => {
  if (text.includes("$t$")) throw new Error("Seed text cannot contain $t$.");
  return `$t$${text}$t$`;
};
const dateSql = (due?: string) => (due ? `'${due}'::date` : "null");

/**
 * The SQL that loads the seed. It does nothing when roadmap_items already has any rows,
 * so running it twice (or after adding your own items) never duplicates anything.
 */
export function seedSql(): string {
  const lines: string[] = [
    "-- Starting content for the Goals page (from the October 2026 meeting with Caitlin Sogn).",
    "-- Generated by `npm run roadmap:seed-sql` from src/lib/roadmap-seed.ts. Run it after db/roadmap.sql.",
    "-- Safe to run twice: it does nothing if roadmap_items already has rows.",
    "",
    "do $seed$",
    "declare",
    "  pid uuid;",
    "  sid uuid;",
    "begin",
    "  if exists (select 1 from public.roadmap_items) then",
    "    raise notice 'roadmap_items already has rows, so nothing was added.';",
    "    return;",
    "  end if;",
    "",
  ];
  let order = 0;
  for (const g of SEED) {
    lines.push(`  -- ${g.group}`);
    for (const item of g.items) {
      order += 1;
      lines.push(
        `  insert into public.roadmap_items (title, group_name, status, due_date, sort_order)`,
        `  values (${q(item.title)}, ${q(g.group)}, '${item.status ?? "Not started"}', ${dateSql(item.due)}, ${order})`,
        `  returning id into pid;`,
      );
      for (const note of item.notes ?? []) {
        lines.push(`  insert into public.roadmap_notes (item_id, body) values (pid, ${q(note)});`);
      }
      (item.subitems ?? []).forEach((sub, index) => {
        lines.push(
          `  insert into public.roadmap_items (parent_id, title, status, due_date, sort_order)`,
          `  values (pid, ${q(sub.title)}, '${sub.status ?? "Not started"}', ${dateSql(sub.due)}, ${index + 1})`,
          `  returning id into sid;`,
        );
        for (const note of sub.notes ?? []) {
          lines.push(`  insert into public.roadmap_notes (item_id, body) values (sid, ${q(note)});`);
        }
      });
    }
    lines.push("");
  }
  lines.push("end", "$seed$;", "");
  return lines.join("\n");
}
