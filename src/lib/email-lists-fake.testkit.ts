/**
 * A stand-in for Mailchimp and the Claude API, for the list builder's tests. The unit tests call `handle` as a fetch function;
 * the browser tests run it as a small web server (scripts/fake-email-apis.ts), so the app's server talks to it exactly as it
 * would to the real services. Invented example.org addresses only, matching the invented members in samplePool().
 *
 * This file imports nothing from the app on purpose: Node runs it directly for the browser tests.
 */

export interface FakeState {
  contacts: { email: string; status: string; num: string; first: string; last: string; interests: string[] }[];
  segments: Map<number, { name: string; members: Set<string> }>;
  campaigns: { id: string; web_id: number; body: Record<string, unknown>; html?: string }[];
  /** Every call, "METHOD /path" with the query left off. */
  calls: string[];
  /** Every request body sent to the Claude API. */
  claudeRequests: Record<string, unknown>[];
  nextSegment: number;
  sentYesterday: string[];
}

export function freshState(): FakeState {
  const c = (num: string, first: string, last: string, status = "subscribed", interests: string[] = []) => ({
    email: `${first.toLowerCase()}.${last.toLowerCase()}@example.org`,
    status,
    num,
    first,
    last,
    interests,
  });
  return {
    contacts: [
      c("S101", "Avery", "Lindqvist"),
      c("S102", "Brooke", "Okafor"),
      c("S102", "Sam", "Okafor"),
      c("S103", "Casey", "Moreau"),
      c("S104", "Devon", "Achebe", "unsubscribed"),
      c("S105", "Emery", "Tanaka"),
      c("S106", "Finley", "Brooks", "subscribed", ["int-row"]),
      c("S107", "Gray", "Pemberton"),
    ],
    segments: new Map(),
    campaigns: [],
    calls: [],
    claudeRequests: [],
    nextSegment: 5001,
    sentYesterday: ["brooke.okafor@example.org"],
  };
}

const LIST = "f5e1cad862";
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** What the fake Claude answers for a description: a few phrases mapped to filters, enough for the tests. */
export function fakeReading(description: string): Record<string, unknown> {
  const d = description.toLowerCase();
  const months = /(\d+|three|six) months?/.exec(d);
  const n = months ? ({ three: 3, six: 6 } as Record<string, number>)[months[1]] ?? Number(months[1]) : null;
  return {
    listName: d.includes("row") ? "New members interested in rowing" : "Members",
    notUnderstood: d.includes("left-handed") ? ["left-handed"] : [],
    rule: {
      joinedWithinMonths: n,
      joinedOnOrAfter: null,
      joinedOnOrBefore: null,
      memberTypes: d.includes("intermediate") ? ["Intermediate"] : [],
      interestsAny: d.includes("row") ? ["rowing"] : [],
      minVisitsPerMonth: null,
      maxVisitsPerMonth: d.includes("rarely") ? 1 : null,
      noVisitInDays: null,
      minShellOutings: null,
      maxShellOutings: d.includes("hasn't rowed") ? 0 : null,
      leaveOutRecentlyEmailed: d.includes("skip anyone emailed"),
    },
  };
}

export function fakeDraft(ask: string): Record<string, unknown> {
  return {
    subject: "A member erg class, once or twice a week",
    previewText: "Would you join a member-run erg workout?",
    paragraphs: [`Some of us are ${ask.slice(0, 60)}.`, "It would meet [day and time] in the boathouse gym <every week>."],
    signOff: "See you at the boathouse,",
  };
}

export function createFake(state: FakeState = freshState()) {
  async function handle(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const raw = init.body ?? (input instanceof Request ? await input.text() : undefined);
    const body = raw ? JSON.parse(String(raw)) : undefined;
    const path = url.pathname.replace(/^\/3\.0/, "");
    state.calls.push(`${method} ${path}`);

    // ---- Claude ----
    if (path === "/v1/messages" && method === "POST") {
      state.claudeRequests.push(body);
      const user = String(body.messages?.[0]?.content ?? "");
      const answer = user.startsWith("Description: ") ? fakeReading(user.slice(13)) : fakeDraft(user.replace(/^What the email should say: /, ""));
      return ok({
        id: "msg_fake",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }

    // ---- Mailchimp ----
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const count = Number(url.searchParams.get("count") ?? 10);
    const page = <T>(items: T[]) => items.slice(offset, offset + count);
    if (path === `/lists/${LIST}/merge-fields`) {
      return ok({ merge_fields: [{ tag: "FNAME", name: "First Name" }, { tag: "LNAME", name: "Last Name" }, { tag: "MMERGE5", name: "Member #" }] });
    }
    if (path === `/lists/${LIST}/interest-categories`) return ok({ categories: [{ id: "cat1" }] });
    if (path === `/lists/${LIST}/interest-categories/cat1/interests`) return ok({ interests: [{ id: "int-row", name: "Rowing" }, { id: "int-bridge", name: "Bridge" }] });
    if (path === `/lists/${LIST}/members`) {
      return ok({
        total_items: state.contacts.length,
        members: page(state.contacts).map((c) => ({
          email_address: c.email,
          status: c.status,
          merge_fields: { FNAME: c.first, LNAME: c.last, MMERGE5: c.num },
          interests: Object.fromEntries(["int-row", "int-bridge"].map((id) => [id, c.interests.includes(id)])),
        })),
      });
    }
    if (path === "/reports") {
      const sent = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      return ok({ reports: state.sentYesterday.length ? [{ id: "rep1", list_id: LIST, campaign_title: "Watercooler", subject_line: "This week at the club", send_time: sent }] : [] });
    }
    if (path === "/reports/rep1/sent-to") return ok({ total_items: state.sentYesterday.length, sent_to: page(state.sentYesterday).map((e) => ({ email_address: e })) });
    if (path === `/lists/${LIST}/segments` && method === "POST") {
      const id = state.nextSegment++;
      state.segments.set(id, { name: body.name, members: new Set(body.static_segment ?? []) });
      return ok({ id, name: body.name });
    }
    const segMembers = new RegExp(`^/lists/${LIST}/segments/(\\d+)/members$`).exec(path);
    if (segMembers) {
      const seg = state.segments.get(Number(segMembers[1]));
      if (!seg) return ok({ title: "Resource Not Found" }, 404);
      const all = [...seg.members].sort();
      return ok({ total_items: all.length, members: page(all).map((e) => ({ email_address: e })) });
    }
    const seg = new RegExp(`^/lists/${LIST}/segments/(\\d+)$`).exec(path);
    if (seg && method === "POST") {
      const s = state.segments.get(Number(seg[1]));
      if (!s) return ok({ title: "Resource Not Found" }, 404);
      for (const e of body.members_to_add ?? []) s.members.add(e);
      for (const e of body.members_to_remove ?? []) s.members.delete(e);
      return ok({ total_added: (body.members_to_add ?? []).length, total_removed: (body.members_to_remove ?? []).length });
    }
    if (path === `/lists/${LIST}`) return ok({ campaign_defaults: { from_name: "College Club Seattle", from_email: "membership@example.org" } });
    if (path === "/campaigns" && method === "POST") {
      const n = state.campaigns.length + 1;
      const c = { id: `camp${n}`, web_id: 9000 + n, body };
      state.campaigns.push(c);
      return ok({ id: c.id, web_id: c.web_id });
    }
    const content = /^\/campaigns\/(camp\d+)\/content$/.exec(path);
    if (content && method === "PUT") {
      const c = state.campaigns.find((x) => x.id === content[1]);
      if (c) c.html = body.html;
      return ok({ html: body.html });
    }
    if (path === "/fake/state") {
      return ok({ campaigns: state.campaigns, segments: [...state.segments].map(([id, s]) => ({ id, name: s.name, members: [...s.members].sort() })), calls: state.calls });
    }
    if (path === "/fake/reset" && method === "POST") {
      Object.assign(state, freshState());
      return ok({ reset: true });
    }
    return ok({ title: "Resource Not Found", detail: `${method} ${path}` }, 404);
  }
  return { state, handle: handle as typeof fetch };
}
