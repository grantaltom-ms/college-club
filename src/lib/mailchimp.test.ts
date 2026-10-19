import { afterEach, describe, expect, it, vi } from "vitest";
import {
  byYear,
  clickRate,
  extremes,
  filteredSummary,
  isWeekly,
  listSize,
  loadCampaigns,
  quarterOf,
  weeklyByMonthOfYear,
  weeklyByQuarter,
  mailchimpConfig,
  sampleEmail,
  summarize,
  toCampaign,
  weeklyVsOther,
  type Campaign,
} from "./mailchimp";

function camp(over: Partial<Campaign>): Campaign {
  return {
    id: "x",
    title: "t",
    subject: "s",
    sentOn: "2026-01-06",
    sent: 110,
    bounces: 10,
    delivered: 100,
    uniqueOpens: 60,
    filteredOpens: null,
    uniqueClicks: 3,
    unsubscribes: 0,
    weekly: false,
    ...over,
  };
}

describe("toCampaign", () => {
  it("reads a Mailchimp report and works out delivered", () => {
    const c = toCampaign({
      id: "a1",
      campaign_title: "Weekly Watercooler Oct 6",
      subject_line: "Water cooler",
      send_time: "2026-10-06T00:30:00+00:00",
      emails_sent: 1700,
      unsubscribed: 4,
      bounces: { hard_bounces: 5, soft_bounces: 3, syntax_errors: 2 },
      opens: { unique_opens: 1000, proxy_excluded_unique_opens: 550 },
      clicks: { unique_subscriber_clicks: 40 },
    })!;
    expect(c.delivered).toBe(1690);
    expect(c.sentOn).toBe("2026-10-06");
    expect(c.filteredOpens).toBe(550);
    expect(c.weekly).toBe(true);
  });

  it("treats a zero filtered count as not available, and skips empty reports", () => {
    const c = toCampaign({ id: "a", send_time: "2024-01-01T00:00:00+00:00", emails_sent: 10, opens: { proxy_excluded_unique_opens: 0 } })!;
    expect(c.filteredOpens).toBeNull();
    expect(toCampaign({ id: "a", send_time: "2024-01-01T00:00:00+00:00", emails_sent: 0 })).toBeNull();
    expect(toCampaign({})).toBeNull();
  });
});

describe("numbers", () => {
  it("summarizes by delivered emails, not by averaging rates", () => {
    const s = summarize("x", [camp({ delivered: 100, uniqueClicks: 10 }), camp({ delivered: 900, uniqueClicks: 0 })]);
    expect(s.clickRate).toBeCloseTo(1);
    expect(s.delivered).toBe(1000);
  });

  it("splits by year and by Watercooler", () => {
    const list = [camp({ sentOn: "2025-03-01", weekly: true }), camp({ sentOn: "2026-03-01" })];
    expect(byYear(list).map((y) => y.label)).toEqual(["2025", "2026"]);
    const [w, o] = weeklyVsOther(list);
    expect([w.campaigns, o.campaigns]).toEqual([1, 1]);
  });

  it("ignores small sends when picking best and worst", () => {
    const list = [
      camp({ id: "tiny", subject: "tiny", delivered: 10, uniqueClicks: 10 }),
      camp({ id: "top", subject: "top", uniqueClicks: 30 }),
      camp({ id: "mid", subject: "mid", uniqueClicks: 5 }),
      camp({ id: "low", subject: "low", uniqueClicks: 0 }),
    ];
    const { best, worst } = extremes(list, 1);
    expect(best[0].id).toBe("top");
    expect(worst[0].id).toBe("low");
    expect(clickRate(list[1])).toBe(30);
  });

  it("compares raw and filtered opens only across emails that have both", () => {
    expect(filteredSummary([camp({})])).toBeNull();
    const f = filteredSummary([camp({ filteredOpens: 30, sentOn: "2026-08-01" }), camp({})])!;
    expect(f.campaigns).toBe(1);
    expect(f.rawOpenRate).toBe(60);
    expect(f.filteredOpenRate).toBe(30);
  });

  it("groups Watercoolers by quarter in order and leaves one-off emails out", () => {
    expect(quarterOf("2024-02-14")).toBe("2024 Q1");
    expect(quarterOf("2024-12-31")).toBe("2024 Q4");
    const list = [
      camp({ sentOn: "2025-07-01", weekly: true, uniqueClicks: 2 }),
      camp({ sentOn: "2025-01-07", weekly: true, uniqueClicks: 4 }),
      camp({ sentOn: "2025-02-11", weekly: true, uniqueClicks: 6 }),
      camp({ sentOn: "2025-02-12", weekly: false, uniqueClicks: 50 }),
    ];
    const q = weeklyByQuarter(list);
    expect(q.map((s) => s.label)).toEqual(["2025 Q1", "2025 Q3"]);
    expect(q[0].campaigns).toBe(2);
    expect(q[0].clickRate).toBeCloseTo(5);
    expect(weeklyByQuarter([camp({})])).toEqual([]);
  });

  it("pools Watercoolers by month of the year across years", () => {
    const list = [
      camp({ sentOn: "2024-08-06", weekly: true, uniqueClicks: 1 }),
      camp({ sentOn: "2025-08-05", weekly: true, uniqueClicks: 3 }),
      camp({ sentOn: "2025-08-05", weekly: false, uniqueClicks: 99 }),
    ];
    const m = weeklyByMonthOfYear(list);
    expect(m).toHaveLength(12);
    expect(m[7].label).toBe("Aug");
    expect(m[7].campaigns).toBe(2);
    expect(m[7].clickRate).toBeCloseTo(2);
    expect(m[0].campaigns).toBe(0);
    expect(m[0].clickRate).toBe(0);
  });

  it("tracks list size from the latest Watercoolers and flags unsubscribe spikes", () => {
    const list = [
      camp({ id: "old", sentOn: "2026-07-01", weekly: true }),
      camp({ id: "jump", sentOn: "2026-08-12", weekly: true, delivered: 1919, unsubscribes: 58, bounces: 116 }),
      camp({ id: "calm", sentOn: "2026-08-19", weekly: true, delivered: 1861, unsubscribes: 5 }),
      camp({ id: "notice", sentOn: "2026-08-20", weekly: false, delivered: 400, unsubscribes: 40 }),
    ];
    const pts = listSize(list, 2);
    expect(pts.map((p) => p.id)).toEqual(["jump", "calm"]);
    expect(pts[0].spike).toBe(true);
    expect(pts[1].spike).toBe(false);
    expect(pts[0].bounces).toBe(116);
    expect(listSize(list, 10)).toHaveLength(3);
  });

  it("spots Watercooler titles case-insensitively", () => {
    expect(isWeekly("WEEKLY WATERCOOLER", "")).toBe(true);
    expect(isWeekly("Survey", "Annual survey")).toBe(false);
  });
});

describe("mailchimpConfig", () => {
  it("needs a key with a server suffix", () => {
    expect(mailchimpConfig({})).toBeNull();
    expect(mailchimpConfig({ MAILCHIMP_API_KEY: "nosuffix" })).toBeNull();
    const cfg = mailchimpConfig({ MAILCHIMP_API_KEY: "abc123-us11" })!;
    expect(cfg.dc).toBe("us11");
    expect(cfg.listId).toBe("f5e1cad862");
  });
});

describe("loadCampaigns with Mailchimp mocked", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pages through results, keeps only the chosen audience and sorts by date", async () => {
    const page = (reports: object[], total: number) => ({ ok: true, json: async () => ({ total_items: total, reports }) });
    const make = (id: string, list: string, day: string) => ({ id, list_id: list, send_time: `${day}T10:00:00+00:00`, emails_sent: 100 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([make("b", "f5e1cad862", "2026-02-01"), make("test", "other", "2026-02-02")], 600))
      .mockResolvedValueOnce(page([make("a", "f5e1cad862", "2026-01-01")], 600));
    vi.stubGlobal("fetch", fetchMock);
    const out = await loadCampaigns(mailchimpConfig({ MAILCHIMP_API_KEY: "k-us11" })!);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("https://us11.api.mailchimp.com/3.0/reports");
  });

  it("raises a plain error when Mailchimp refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(loadCampaigns(mailchimpConfig({ MAILCHIMP_API_KEY: "k-us11" })!)).rejects.toThrow("401");
  });
});

describe("sample email data", () => {
  it("has both kinds of email and spans several years", () => {
    const d = sampleEmail();
    expect(d.campaigns.some((c) => c.weekly)).toBe(true);
    expect(d.campaigns.some((c) => !c.weekly)).toBe(true);
    expect(byYear(d.campaigns).length).toBeGreaterThanOrEqual(3);
  });
});

describe("list jump, merged segments and season", () => {
  const point = (id: string, delivered: number, spike = false) => ({ id, sentOn: `2026-0${id}-01`, delivered, bounces: 0, unsubscribes: 0, spike });

  it("finds the biggest one-step rise and counts the high-unsubscribe sends after it", async () => {
    const { listJump } = await import("./mailchimp");
    const jump = listJump([point("1", 1000), point("2", 1010), point("3", 1900, true), point("4", 1850, true), point("5", 1800)]);
    expect(jump).toEqual({ from: 1010, to: 1900, on: "2026-03-01", sendsSince: 3, spikesSince: 2 });
    expect(listJump([point("1", 1000), point("2", 1100), point("3", 1200)])).toBeNull();
    expect(listJump([])).toBeNull();
  });

  it("adds an email sent to two lists on one day back into one row", async () => {
    const { mergeSegments, clickRate } = await import("./mailchimp");
    const c = (id: string, delivered: number, clicks: number, day = "2025-09-18") => ({
      id, title: id, subject: "Update to ACH Billing", sentOn: day, sent: delivered, bounces: 0, delivered,
      uniqueOpens: delivered, filteredOpens: null, uniqueClicks: clicks, unsubscribes: 0, weekly: false,
    });
    const merged = mergeSegments([c("a", 100, 33), c("b", 194, 64), c("c", 50, 5, "2025-09-19")]);
    expect(merged).toHaveLength(2);
    expect(merged[0].delivered).toBe(294);
    expect(clickRate(merged[0])).toBeCloseTo((97 / 294) * 100);
  });

  it("names the lowest and highest month, and the same quarter a year before", async () => {
    const { seasonRange, quarterVsYearAgo } = await import("./mailchimp");
    const s = (label: string, clickRate: number, campaigns = 4) => ({ label, campaigns, delivered: 1000, openRate: 50, clickRate, unsubRate: 0 });
    const range = seasonRange([s("Jan", 2.9), s("May", 3.6), s("Sep", 2.6), s("Dec", 0, 0)]);
    expect(range?.low.label).toBe("Sep");
    expect(range?.high.label).toBe("May");
    expect(seasonRange([s("Jan", 2)])).toBeNull();
    const q = quarterVsYearAgo([s("2025 Q3", 4.5), s("2026 Q2", 2.9), s("2026 Q3", 3.7)]);
    expect(q?.now.label).toBe("2026 Q3");
    expect(q?.yearAgo?.label).toBe("2025 Q3");
    expect(quarterVsYearAgo([s("2026 Q3", 3)])?.yearAgo).toBeNull();
    // A quarter still under way is skipped once the last data day is known.
    const withQ4 = [s("2025 Q3", 4.5), s("2026 Q3", 2.9), s("2026 Q4", 3.7)];
    expect(quarterVsYearAgo(withQ4, "2026-10-14")?.now.label).toBe("2026 Q3");
    expect(quarterVsYearAgo(withQ4, "2026-12-31")?.now.label).toBe("2026 Q4");
    expect(quarterVsYearAgo(withQ4, "2025-08-01")).toBeNull();
  });

  it("the sample data has the August jump the page leads with", async () => {
    const { listJump, listSize, sampleEmail } = await import("./mailchimp");
    const jump = listJump(listSize(sampleEmail().campaigns, 30));
    expect(jump).not.toBeNull();
    expect(jump!.on >= "2026-08-12").toBe(true);
  });
});
