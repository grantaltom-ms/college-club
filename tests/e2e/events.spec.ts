import { expect, test, type Page } from "@playwright/test";
import { sampleEvents } from "../../src/lib/events";
import { seedEventsData } from "../../src/lib/events-seed.testkit";
import { sampleMembership } from "../../src/lib/membership";
import { dashboardNav, mockDashboard, openNavMenu } from "./helpers";

/** Serve the eight pilot events from the events endpoint, as it answers when the table is loaded, so no test touches the real database. */
async function mockSeed(page: Page) {
  await mockDashboard(page);
  const membership = JSON.stringify(sampleMembership());
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body: membership }));
  const body = JSON.stringify(seedEventsData());
  await page.route("**/api/events", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
}

const row = (page: Page, text: string) => page.getByTestId("event-row").filter({ hasText: text });

const HEADINGS = ["Event scoreboard", "How to read these numbers", "Where members stand", "Tests we are running", "Board targets", "Keeping this page honest"];

test.describe("the Events and Marketing page with the table loaded", () => {
  test.beforeEach(async ({ page }) => {
    await mockSeed(page);
    await page.goto("/events");
  });

  test("has its title and subtitle, no sample banner, and the six sections in order", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: "Events and Marketing." })).toBeVisible();
    await expect(page.getByText("What we promoted, who signed up, and who showed up — from the Watercooler, iCrew and the front door.")).toBeVisible();
    await expect(page.locator(".sample-banner")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(HEADINGS);
  });

  test("lists the eight events by date with every column, door comparison under the count, and the one-line summary", async ({ page }) => {
    const table = page.getByTestId("events-table");
    await expect(table.getByRole("columnheader")).toHaveText([
      "Event",
      "Date",
      "Price",
      "Promoted",
      "Registered (members)",
      "Attending (persons incl. guests)",
      "Capacity filled %",
      "Door entries (event window)",
      "Note",
    ]);
    await expect(page.getByTestId("event-row")).toHaveCount(8);
    await expect(page.getByTestId("event-row").locator("td:first-child")).toHaveText([
      "BINGO Night",
      "Wine Tasting",
      "Boathouse Work Party",
      "Pumpkin Carving",
      "Seahawks Watch Party (Oct 25 game)",
      "Seahawks vs Cardinals Watch Party Upcoming",
      "Whiskey Tasting Upcoming",
      "International Comedy Competition (at WAC) Upcoming",
    ]);
    await expect(row(page, "BINGO Night").getByRole("cell")).toHaveText([
      "BINGO Night",
      "Sep 10, 2026",
      "$20 buy-in",
      "2",
      "16",
      "43",
      "78%",
      "36 Baseline Thursdays Sep 3 and Sep 17: 27 and 24 entries in the same 4-9 PM window",
      "Door entries agree with iCrew: busiest Thursday evening of the four checked",
    ]);
    await expect(row(page, "Wine Tasting").getByRole("cell")).toHaveText([
      "Wine Tasting",
      "Sep 24, 2026",
      "$26",
      "4",
      "14",
      "34",
      "62%",
      "25 Baseline Thursdays Sep 3 and Sep 17: 27 and 24 entries in the same 4-9 PM window",
      "No door lift despite 34 registered persons - attendees may already be inside, or one swipe admits a group",
    ]);
    await expect(page.getByTestId("events-summary")).toHaveText("Paid tastings filled best this fall; watch parties barely register — members just come.");
    // The comparison text sits under the count, in its own line.
    const count = row(page, "BINGO Night").getByRole("cell").nth(7);
    const note = count.locator(".ev-door-note");
    await expect(note).toBeVisible();
    expect(await note.evaluate((el) => getComputedStyle(el).display)).toBe("block");
  });

  test("shows a dash, never a percentage, for an event with no capacity, and a dash for a missing door count or note", async ({ page }) => {
    await expect(row(page, "Boathouse Work Party").getByRole("cell")).toHaveText([
      "Boathouse Work Party",
      "Oct 10, 2026",
      "Free",
      "1",
      "19",
      "23",
      "—",
      "—",
      "The Oct 28 Watercooler reported 24 members attended - registrations ran at about 80% of turnout",
    ]);
    await expect(row(page, "Pumpkin Carving").getByRole("cell")).toHaveText(["Pumpkin Carving", "Oct 24, 2026", "$12", "2", "7", "16", "53%", "—", "—"]);
    // The percentages of the rest: persons over capacity, rounded.
    const filled = page.getByTestId("event-row").locator("td:nth-child(7)");
    await expect(filled).toHaveText(["78%", "62%", "—", "53%", "13%", "6% so far", "87% so far", "65% so far"]);
  });

  test("labels an upcoming event's registrations 'so far', and a held event's not at all", async ({ page }) => {
    for (const name of ["BINGO Night", "Wine Tasting", "Boathouse Work Party", "Pumpkin Carving", "Seahawks Watch Party (Oct 25 game)"]) {
      await expect(row(page, name)).not.toContainText("so far");
      await expect(row(page, name)).not.toContainText("Upcoming");
    }
    await expect(row(page, "Whiskey Tasting").getByRole("cell")).toHaveText([
      "Whiskey Tasting Upcoming",
      "Nov 12, 2026",
      "$26",
      "4",
      "18 so far",
      "48 so far",
      "87% so far",
      "—",
      "Registrations as of Nov 5, 2026 - nearly full a week out",
    ]);
    for (const name of ["Seahawks vs Cardinals Watch Party", "Whiskey Tasting", "International Comedy Competition"]) {
      await expect(row(page, name).locator(".ev-so-far")).toHaveCount(3);
      await expect(row(page, name).locator(".ev-tag")).toHaveText("Upcoming");
    }
    await expect(row(page, "International Comedy Competition").getByRole("cell").nth(2)).toHaveText("Price TBA");
  });

  test("explains how to read the numbers in the five plain bullets", async ({ page }) => {
    await expect(page.getByTestId("how-to-read").getByRole("listitem")).toHaveText([
      "These numbers are directional, not exact — the club is small, so a single busy night swings a percentage.",
      "An RSVP is an intention, not attendance; iCrew does not record who actually came, and one member’s registration usually includes guests.",
      "Door entries count entries, not people — one swipe can let a group in, and people already inside never swipe.",
      "Compare like with like: same season last year, not last month — club use is strongly seasonal.",
      "Email “opens” overstate reading (many mail apps open messages automatically), so treat the email stage as the softest number on the page.",
    ]);
  });

  test("shows the four member cards from the same live data as the Summary, each with how far its data goes", async ({ page }) => {
    await expect(page.getByText("Snapshots, not live figures")).toHaveCount(0);
    await expect(page.getByText("The same member list and visit data as the Summary page")).toBeVisible();
    await expect(page.getByText("Member list: QuickBooks member list, Oct 21, 2026.")).toBeVisible();
    const visited = page.getByTestId("stand-visited");
    await expect(visited).toContainText("455 of 497 members came in at least once this year");
    await expect(visited).toContainText("As of: visits Jan 1 – Sep 27, 2026");
    const rarely = page.getByTestId("stand-rarely");
    await expect(rarely).toContainText("133 of 497 (27%) came in less than once a month, or not at all");
    await expect(rarely).toContainText("As of: visits Jan 1 – Sep 27, 2026");
    const none = page.getByTestId("stand-none");
    await expect(none).toContainText("31 have not visited at all in the data we hold");
    const waitlist = page.getByTestId("stand-waitlist");
    await expect(waitlist.getByRole("heading", { level: 3 })).toHaveText("Waitlist");
    await expect(waitlist).toContainText("12 people on the waitlist");
    await expect(waitlist).toContainText("As of: Mar 2024");
    await expect(page.locator("[data-testid^='stand-']")).toHaveCount(4);
    // The old typed-in iCrew figures are gone for good.
    await expect(page.getByText("of 550")).toHaveCount(0);
  });

  test("says plainly when the membership figures fail, and Try again brings the waitlist back", async ({ page }) => {
    let fail = true;
    const membership = JSON.stringify(sampleMembership());
    await page.route("**/api/membership", (route) =>
      fail
        ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The membership figures could not be loaded." }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: membership }),
    );
    await page.goto("/events");
    const waitlist = page.getByTestId("stand-waitlist");
    await expect(waitlist).toContainText("As of: the membership figures could not be loaded");
    await expect(waitlist).not.toContainText("not loaded yet");
    const targets = page.getByTestId("targets-table").locator("tbody tr");
    await expect(targets.nth(4).getByRole("cell").nth(1)).toHaveText("Could not be loaded");
    // The member cards still show: only the waitlist depends on the membership figures.
    await expect(page.getByTestId("stand-rarely")).toContainText("133 of 497");
    fail = false;
    await waitlist.getByRole("button", { name: "Try again" }).click();
    await expect(waitlist).toContainText("12 people on the waitlist");
    await expect(waitlist.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(targets.nth(4).getByRole("cell").nth(1)).toHaveText("12");
  });

  test("lists the two tests as approved or ready and not sent, in the wording the committee agreed", async ({ page }) => {
    const retention = page.getByTestId("test-retention");
    await expect(retention.getByRole("heading", { level: 3 })).toHaveText("Winter retention test — approved, not sent");
    await expect(retention).toContainText(
      "Approved Nov 2, 2026. When it goes: an email to 134 at-risk members, with about 20 similar members held back and not contacted, so results can be compared honestly. Sending waits on the final go-ahead. Owner: Membership committee (Amy and Rick).",
    );
    const happyHour = page.getByTestId("test-happy-hour");
    await expect(happyHour.getByRole("heading", { level: 3 })).toHaveText("Happy Hour invitation — list ready, not sent");
    await expect(happyHour).toContainText(
      "20 disengaged members identified and checked against Mailchimp (19 currently sendable). No date set and nothing sent. Success measure, agreed before sending: visits within 60 days, compared with similar members not contacted.",
    );
  });

  test("lists the five board targets, every one 'not set yet', with no number made up", async ({ page }) => {
    const table = page.getByTestId("targets-table");
    await expect(table.getByRole("columnheader")).toHaveText(["Measure", "Where we are now", "Target"]);
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0).getByRole("cell")).toHaveText(["% of members visiting at least monthly", "71% (353 of 497)", "Not set yet — board to set"]);
    await expect(rows.nth(1).getByRole("cell")).toHaveText(["Members with no visit at all in the data", "31", "Not set yet — board to set"]);
    await expect(rows.nth(2).getByRole("cell")).toHaveText(["Event capacity filled (persons)", "53–78% across Sep–Oct ticketed events", "Not set yet — board to set"]);
    await expect(rows.nth(3).getByRole("cell")).toHaveText(["New members with 3+ visits in their first 90 days", "Not measured yet", "Not set yet — board to set"]);
    await expect(rows.nth(4).getByRole("cell")).toHaveText(["Waitlist", "12", "Not set yet — board to set"]);
    await expect(table.locator("td:nth-child(3)")).toHaveText(Array(5).fill("Not set yet — board to set"));
  });

  test("gives staff the three rules for keeping the page honest", async ({ page }) => {
    await expect(page.getByTestId("keeping-honest").getByRole("listitem")).toHaveText([
      "Every promoted event gets its own iCrew RSVP link — never reuse a link, and don’t promote an event with only a website signup.",
      "Set a capacity on every event, or “filled %” can’t be shown.",
      "Door data is loaded monthly; event rows are added after each Watercooler goes out.",
    ]);
  });

  test("lives in the Board Materials menu, after Financials, which is marked as the active section", async ({ page }) => {
    await expect(dashboardNav(page).getByRole("button", { name: "Board Materials" })).toHaveAttribute("aria-current", "page");
    const menu = await openNavMenu(page, "Board Materials");
    await expect(menu.getByRole("menuitem")).toHaveText(["Email", "Membership", "Financials", "Events and Marketing"]);
    await expect(menu.getByRole("menuitem", { name: "Events and Marketing" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("menuitem", { name: "Financials" })).not.toHaveAttribute("aria-current", "page");
  });

  test("gives every region of the page its own name, so a screen reader can tell them apart", async ({ page }) => {
    const names = await page.getByRole("region").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby") ?? ""));
    expect(names.length).toBeGreaterThan(5);
    const labels = await page.getByRole("region").evaluateAll((els) =>
      els.map((el) => {
        const id = el.getAttribute("aria-labelledby");
        return (id ? document.getElementById(id)?.textContent : el.getAttribute("aria-label")) ?? "";
      }),
    );
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.trim() !== "")).toBe(true);
  });

  test("carries no member name, email or per-person row anywhere on the page", async ({ page }) => {
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/@/);
    // The table is counts and event labels: every cell of the number columns is a count, a percentage or a dash.
    const numbers = await page.getByTestId("event-row").locator("td:nth-child(n+4):nth-child(-n+8)").allInnerTexts();
    for (const cell of numbers) expect(cell).toMatch(/^(\d+%?|—)( so far)?(\s.+)?$/);
  });
});

test.describe("the Events and Marketing page when the table is not there or has nothing in it", () => {
  test("a table that is missing shows a plain message and a way to try again, and the written sections still show", async ({ page }) => {
    await page.route("**/api/events", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "The event figures could not be loaded. If the event_scoreboard table has not been set up yet, see db/event_scoreboard.sql." }),
      }),
    );
    await page.goto("/events");
    await expect(page.getByRole("heading", { level: 1, name: "Events and Marketing." })).toBeVisible();
    const alert = page.locator(".status-error");
    await expect(alert).toContainText("The event figures could not be loaded. If the event_scoreboard table has not been set up yet, see db/event_scoreboard.sql.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByTestId("events-table")).toHaveCount(0);
    await expect(page.locator(".sample-banner")).toHaveCount(0);
    // Everything that is written text, not read from the table, is still there.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(HEADINGS);
    await expect(page.getByTestId("targets-table").locator("tbody tr")).toHaveCount(5);
    // The rest of the site is unaffected: the summary page still opens.
    await dashboardNav(page).getByRole("link", { name: "Summary" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "How the club is doing." })).toBeVisible();
  });

  test("a table with nothing in it says what to load, rather than showing an empty table", async ({ page }) => {
    await page.route("**/api/events", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "There are no event figures yet. Load db/event_scoreboard.csv into the event_scoreboard table." }),
      }),
    );
    await page.goto("/events");
    await expect(page.locator(".status-error")).toContainText("There are no event figures yet. Load db/event_scoreboard.csv into the event_scoreboard table.");
    await expect(page.getByTestId("events-table")).toHaveCount(0);
    await expect(page.getByTestId("event-row")).toHaveCount(0);
    await expect(page.getByTestId("how-to-read")).toBeVisible();
  });

  test("a failed request with no message falls back to the page's own plain words, and Try again recovers when the table is loaded", async ({ page }) => {
    let calls = 0;
    const body = JSON.stringify(seedEventsData());
    await page.route("**/api/events", (route) => {
      calls += 1;
      return calls === 1 ? route.abort() : route.fulfill({ status: 200, contentType: "application/json", body });
    });
    await page.goto("/events");
    await expect(page.locator(".status-error")).toContainText("The event figures could not be loaded.");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("event-row")).toHaveCount(8);
    await expect(page.locator(".status-error")).toHaveCount(0);
    expect(calls).toBe(2);
  });
});

test.describe("the Events and Marketing page on sample data", () => {
  test("labels invented figures as sample, and never shows them as the real pilot", async ({ page }) => {
    const body = JSON.stringify(sampleEvents());
    await page.route("**/api/events", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await page.goto("/events");
    await expect(page.locator(".sample-banner")).toContainText("Sample data. These are made-up numbers for testing, not the real club.");
    await expect(page.getByTestId("event-row").locator("td:first-child")).toHaveText(["Sample Trivia Night", "Sample Open House", "Sample Winter Tasting Upcoming"]);
    await expect(row(page, "Sample Open House").getByRole("cell").nth(6)).toHaveText("—");
    await expect(page.getByText("BINGO Night")).toHaveCount(0);
  });

  test("the real endpoint, with no database set up, serves the labelled sample and the page draws it", async ({ page, baseURL }) => {
    const res = await fetch(`${baseURL}/api/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.source).toBe("sample");
    expect(body.events).toHaveLength(3);
    expect(JSON.stringify(body)).not.toMatch(/@/);
    // No mock here: the page asks the running server.
    await page.goto("/events");
    await expect(page.locator(".sample-banner")).toBeVisible();
    await expect(page.getByTestId("event-row")).toHaveCount(3);
  });
});

test.describe("the Events and Marketing page on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("never scrolls the page sideways: the wide scoreboard scrolls inside its own box, and the cards stack", async ({ page }) => {
    await mockSeed(page);
    await page.goto("/events");
    await expect(page.getByTestId("event-row")).toHaveCount(8);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const region = page.getByRole("region", { name: "Counts for each event" });
    expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    // The four snapshot cards sit one above the other, not side by side.
    const boxes = await Promise.all(["visited", "rarely", "none", "waitlist"].map((k) => page.getByTestId(`stand-${k}`).boundingBox()));
    const lefts = boxes.map((b) => Math.round(b!.x));
    expect(new Set(lefts).size).toBe(1);
    const tops = boxes.map((b) => b!.y);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    // Nothing in a snapshot card spills past its edge.
    for (const k of ["visited", "rarely", "none", "waitlist"]) {
      const card = page.getByTestId(`stand-${k}`);
      expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  });
});
