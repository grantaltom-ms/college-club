import { formatDay } from "./dates";

/** One sent email campaign, with counts only. No subscriber names or addresses ever pass through here. */
export interface Campaign {
  id: string;
  title: string;
  subject: string;
  /** YYYY-MM-DD, Pacific time is not applied: this is the date Mailchimp reports. */
  sentOn: string;
  sent: number;
  bounces: number;
  delivered: number;
  uniqueOpens: number;
  /** Opens with Apple privacy and bot opens removed, or null when Mailchimp has no filtered figure. */
  filteredOpens: number | null;
  uniqueClicks: number;
  unsubscribes: number;
  weekly: boolean;
}

export interface EmailData {
  source: "live" | "sample";
  /** Date of the newest campaign. */
  through: string;
  campaigns: Campaign[];
}

/* ---------- Reading Mailchimp's reports ---------- */

interface Report {
  id?: string;
  campaign_title?: string;
  subject_line?: string;
  send_time?: string;
  emails_sent?: number;
  unsubscribed?: number;
  bounces?: { hard_bounces?: number; soft_bounces?: number; syntax_errors?: number };
  opens?: { unique_opens?: number; proxy_excluded_unique_opens?: number };
  clicks?: { unique_subscriber_clicks?: number; unique_clicks?: number };
}

export function isWeekly(title: string, subject: string): boolean {
  return /watercooler/i.test(`${title} ${subject}`);
}

export function toCampaign(r: Report): Campaign | null {
  if (!r.id || !r.send_time || !r.emails_sent) return null;
  const sent = r.emails_sent;
  const bounces = (r.bounces?.hard_bounces ?? 0) + (r.bounces?.soft_bounces ?? 0) + (r.bounces?.syntax_errors ?? 0);
  const title = r.campaign_title ?? "";
  const subject = r.subject_line ?? "";
  const filtered = r.opens?.proxy_excluded_unique_opens;
  return {
    id: r.id,
    title,
    subject,
    sentOn: r.send_time.slice(0, 10),
    sent,
    bounces,
    delivered: Math.max(sent - bounces, 0),
    uniqueOpens: r.opens?.unique_opens ?? 0,
    // Mailchimp sends 0 for sends before it started filtering, so a zero is treated as "not available".
    filteredOpens: typeof filtered === "number" && filtered > 0 ? filtered : null,
    uniqueClicks: r.clicks?.unique_subscriber_clicks ?? r.clicks?.unique_clicks ?? 0,
    unsubscribes: r.unsubscribed ?? 0,
    weekly: isWeekly(title, subject),
  };
}

export function mailchimpConfig(env: Record<string, string | undefined> = process.env) {
  const key = env.MAILCHIMP_API_KEY;
  if (!key) return null;
  const dc = key.split("-")[1];
  if (!dc || !/^[a-z]+\d+$/.test(dc)) return null;
  return { key, dc, listId: env.MAILCHIMP_LIST_ID || "f5e1cad862", since: env.MAILCHIMP_SINCE || "2022-01-01" };
}

const FIELDS = [
  "total_items",
  "reports.id",
  "reports.list_id",
  "reports.campaign_title",
  "reports.subject_line",
  "reports.send_time",
  "reports.emails_sent",
  "reports.unsubscribed",
  "reports.bounces",
  "reports.opens.unique_opens",
  "reports.opens.proxy_excluded_unique_opens",
  "reports.clicks.unique_subscriber_clicks",
  "reports.clicks.unique_clicks",
].join(",");

/** Reads every sent campaign for one audience from Mailchimp, read-only. */
export async function loadCampaigns(cfg: NonNullable<ReturnType<typeof mailchimpConfig>>): Promise<Campaign[]> {
  const out: Campaign[] = [];
  const auth = "Basic " + Buffer.from(`ccs:${cfg.key}`).toString("base64");
  for (let offset = 0; offset < 5000; offset += 500) {
    const url =
      `https://${cfg.dc}.api.mailchimp.com/3.0/reports?count=500&offset=${offset}` +
      `&since_send_time=${cfg.since}T00:00:00%2B00:00&fields=${FIELDS}`;
    const res = await fetch(url, { headers: { Authorization: auth }, next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Mailchimp answered ${res.status}`);
    const body = (await res.json()) as { total_items?: number; reports?: (Report & { list_id?: string })[] };
    for (const r of body.reports ?? []) {
      if (r.list_id && r.list_id !== cfg.listId) continue;
      const c = toCampaign(r);
      if (c) out.push(c);
    }
    if (offset + 500 >= (body.total_items ?? 0)) break;
  }
  return out.sort((a, b) => a.sentOn.localeCompare(b.sentOn));
}

/* ---------- Numbers for the page ---------- */

export interface Summary {
  label: string;
  campaigns: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  unsubRate: number;
}

const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

export function summarize(label: string, list: Campaign[]): Summary {
  const delivered = list.reduce((s, c) => s + c.delivered, 0);
  return {
    label,
    campaigns: list.length,
    delivered,
    openRate: pct(list.reduce((s, c) => s + c.uniqueOpens, 0), delivered),
    clickRate: pct(list.reduce((s, c) => s + c.uniqueClicks, 0), delivered),
    unsubRate: pct(list.reduce((s, c) => s + c.unsubscribes, 0), delivered),
  };
}

export function byYear(campaigns: Campaign[]): Summary[] {
  const years = [...new Set(campaigns.map((c) => c.sentOn.slice(0, 4)))].sort();
  return years.map((y) => summarize(y, campaigns.filter((c) => c.sentOn.startsWith(y))));
}

export function weeklyVsOther(campaigns: Campaign[]): Summary[] {
  return [
    summarize("Weekly Watercooler", campaigns.filter((c) => c.weekly)),
    summarize("Everything else", campaigns.filter((c) => !c.weekly)),
  ];
}

export const clickRate = (c: Campaign) => pct(c.uniqueClicks, c.delivered);
export const openRate = (c: Campaign) => pct(c.uniqueOpens, c.delivered);
export const filteredOpenRate = (c: Campaign) => (c.filteredOpens === null ? null : pct(c.filteredOpens, c.delivered));
export const unsubRate = (c: Campaign) => pct(c.unsubscribes, c.delivered);

/** Best and worst by click rate, ignoring small sends where one click swings the rate. */
export function extremes(campaigns: Campaign[], count: number, minDelivered = 100) {
  const ranked = campaigns.filter((c) => c.delivered >= minDelivered).sort((a, b) => clickRate(b) - clickRate(a));
  return { best: ranked.slice(0, count), worst: ranked.slice(-count).reverse() };
}

export interface FilteredSummary {
  campaigns: number;
  since: string;
  rawOpenRate: number;
  filteredOpenRate: number;
}

/** Compares raw and filtered opens across the sends that have both. */
export function filteredSummary(campaigns: Campaign[]): FilteredSummary | null {
  const both = campaigns.filter((c) => c.filteredOpens !== null);
  if (both.length === 0) return null;
  const delivered = both.reduce((s, c) => s + c.delivered, 0);
  return {
    campaigns: both.length,
    since: both[0].sentOn,
    rawOpenRate: pct(both.reduce((s, c) => s + c.uniqueOpens, 0), delivered),
    filteredOpenRate: pct(both.reduce((s, c) => s + (c.filteredOpens ?? 0), 0), delivered),
  };
}

export function recentSends(campaigns: Campaign[], count: number): Campaign[] {
  return campaigns.slice(-count).reverse();
}

export const fmtPct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
export const fmtDate = (d: string) => formatDay(d, true);

/* ---------- Sample data for development and tests ---------- */

export function sampleEmail(): EmailData {
  const campaigns: Campaign[] = [];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = Date.UTC(2022, 0, 4);
  for (let i = 0; i < 200; i++) {
    const weekly = i % 3 !== 2;
    const day = new Date(start + Math.round(i * 8.7 * 86_400_000)).toISOString().slice(0, 10);
    if (day > "2026-10-06") break;
    const delivered = Math.round((day >= "2026-08-12" ? 1700 : 1000) * (0.9 + rand() * 0.2));
    campaigns.push({
      id: `s${i}`,
      title: weekly ? `Weekly Watercooler ${day}` : `Notice ${i}`,
      subject: weekly ? "Watercooler" : `Notice ${i}`,
      sentOn: day,
      sent: delivered + 10,
      bounces: 10,
      delivered,
      uniqueOpens: Math.round(delivered * (0.55 + rand() * 0.15)),
      filteredOpens: day >= "2026-07-22" ? Math.round(delivered * 0.33) : null,
      uniqueClicks: Math.round(delivered * (weekly ? 0.02 + rand() * 0.02 : rand() * 0.2)),
      unsubscribes: Math.round(rand() * 2),
      weekly,
    });
  }
  return { source: "sample", through: campaigns[campaigns.length - 1].sentOn, campaigns };
}
