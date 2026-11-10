/**
 * The committee pages (Nov 9, Grant): one page each for the Boathouse, Membership and Social committees, built from the dashboard's own
 * sections so the numbers are always current. They live at their own addresses with their own plain header and are left out of the
 * dashboard's menu on purpose (Grant: the menu would get too crowded). Each committee's own sections come first, then sections it shares
 * with another committee, shown in full, each with a line saying why it matters to that committee.
 */

/** The dashboard sections a committee page can show. Each is the body of the dashboard page of the same name. */
export type SectionKey = "summary" | "shells" | "reservations" | "timing" | "visits" | "membership" | "email" | "events";

export interface CommitteeSection {
  key: SectionKey;
  /** The section's heading on the committee page. */
  heading: string;
  /** Why this section matters to this committee, in one plain sentence. */
  why: string;
  /** True for a section another committee also sees. */
  shared: boolean;
}

export interface Committee {
  slug: "boathouse" | "membership" | "social";
  name: string;
  /** What the committee covers, in Grant's words. */
  covers: string;
  sections: CommitteeSection[];
}

export const COMMITTEES: Committee[] = [
  {
    slug: "boathouse",
    name: "Boathouse Committee",
    covers: "Rowing and the rowing programs.",
    sections: [
      { key: "shells", heading: "Shells", shared: false, why: "How often each boat goes out, so you can see which boats earn their rack space and which need attention." },
      { key: "reservations", heading: "Reservations", shared: false, why: "What members book and when, including the dock and gym time around the boathouse." },
      { key: "timing", heading: "When people come", shared: true, why: "The busiest days and hours, for planning practices, programs and boat work around the traffic." },
      { key: "visits", heading: "Member visits", shared: true, why: "Who comes and how often, so programs can reach rowers who have gone quiet." },
    ],
  },
  {
    slug: "membership",
    name: "Membership Committee",
    covers: "Keeping members and welcoming new ones.",
    sections: [
      { key: "summary", heading: "How the club is doing", shared: false, why: "The club at a glance: visits, boats, email and membership in one place." },
      { key: "membership", heading: "Membership", shared: false, why: "Who joins, who leaves and why, and the waitlist: the committee's core numbers." },
      { key: "visits", heading: "Member visits", shared: true, why: "Members who rarely or never come in are the most likely to leave, and new members who have not settled in show up here first." },
      { key: "timing", heading: "When people come", shared: true, why: "When members are actually here, for timing welcome sessions and onboarding." },
      { key: "email", heading: "Email", shared: true, why: "Whether members open and click the club's emails, the main way to reach members who have gone quiet." },
    ],
  },
  {
    slug: "social",
    name: "Social Committee",
    covers: "Planning, hosting and running events and social life at the club.",
    sections: [
      { key: "events", heading: "Events and Marketing", shared: false, why: "Each event's sign-ups and turnout, and the targets the board is watching." },
      { key: "email", heading: "Email", shared: true, why: "How the Watercooler and other emails perform, since that is where most events are promoted." },
      { key: "timing", heading: "When people come", shared: true, why: "The busiest days and hours, for choosing when to hold an event." },
      { key: "visits", heading: "Member visits", shared: true, why: "How often members come in, so events can draw back the ones who rarely visit." },
    ],
  },
];

export function committeeBySlug(slug: string): Committee | undefined {
  return COMMITTEES.find((c) => c.slug === slug);
}

export function committeePath(slug: Committee["slug"]): string {
  return `/committees/${slug}`;
}
