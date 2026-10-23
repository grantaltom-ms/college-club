import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Events and RSVPs in the browser. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026.
 * The invented club has these events already: Members' Dinner on Fri Oct 30 at 6 pm ($45, 12 places, full, with Nora
 * Abernathy and Ines Castellanos waiting), Fall Regatta Social on Sat Oct 31 ($25, 40 places), and a free Boathouse Work Party
 * on Tue Nov 3 with no limit. All tests share one server, so the ones that change things make their own event and cancel
 * it at the end, so a retried run starts clean.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const card = (page: Page, title: string) => page.getByTestId("event-card").filter({ hasText: title });

/** A person in a browser of their own, so several people can use the club at once. */
async function as(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await actAs(page, who);
  return page;
}

/** Staff add an event through the form. Returns its ID. */
async function addEvent(page: Page, e: { title: string; date: string; start: string; end: string; limit?: string; price?: string }): Promise<string> {
  await actAs(page, "Test staff");
  await page.goto("/club/events/manage");
  await page.locator("#title").fill(e.title);
  await page.locator("#date").fill(e.date);
  await page.locator("#start").fill(e.start);
  await page.locator("#end").fill(e.end);
  if (e.limit) await page.locator("#limit").fill(e.limit);
  if (e.price) await page.locator("#price").fill(e.price);
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page).toHaveURL(/\/club\/events\/[0-9a-f-]{36}\?changed=1$/);
  return page.url().match(/events\/([0-9a-f-]{36})/)![1];
}

async function cancelEvent(page: Page, id: string, reason = "Test finished") {
  await actAs(page, "Test staff");
  await page.goto(`/club/events/${id}`);
  await page.locator("#why").fill(reason);
  await page.getByRole("button", { name: /^Cancel .*/ }).filter({ hasText: "Cancel event" }).click();
  await expect(page.getByTestId("event-cancelled")).toBeVisible();
}

test("core flow: pick a member, find an event, RSVP with guests, see the places go, change guests, cancel, and see them come back", async ({ page }) => {
  const title = `Core ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-04", start: "19:00", end: "21:00", limit: "10", price: "25" });

  await actAs(page, "Rafael Castellanos");
  await page.goto("/club/events");
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  await expect(card(page, title).getByTestId("event-places")).toHaveText("10 places left");
  await expect(card(page, title)).toContainText("Wednesday, Nov 4, 7:00 pm");
  await card(page, title).getByRole("link", { name: title }).click();

  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How RSVPs work" })).toBeVisible();
  await page.locator("#guests").selectOption("2");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByTestId("price-total")).toHaveText("3 places × $25 = $75");
  await page.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(page.getByTestId("joined-note")).toHaveText("You are going. 3 places taken.");
  await expect(page.getByTestId("your-place")).toHaveText("You are going, with 2 guests.");

  await page.goto("/club/events");
  await expect(card(page, title).getByTestId("event-places")).toHaveText("7 places left");
  await expect(card(page, title)).toContainText("You are going, with 2 guests.");

  // Someone else sees the places but not the name.
  await actAs(page, "Walter Pemberton");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("event-places")).toContainText("7 places left");
  await expect(page.locator("body")).not.toContainText("Castellanos");

  // Changing guests gives places back; cancelling gives them all back.
  await actAs(page, "Rafael Castellanos");
  await page.goto(`/club/events/${id}`);
  await page.locator("#change-guests").selectOption("0");
  await page.getByRole("button", { name: "Change guests" }).click();
  await expect(page.getByTestId("your-place")).toHaveText("You are going.");
  await expect(page.getByTestId("event-places")).toContainText("9 places left");
  await page.getByRole("button", { name: "Cancel my RSVP" }).click();
  await page.goto("/club/events");
  await expect(card(page, title).getByTestId("event-places")).toHaveText("10 places left");
  await cancelEvent(page, id);
});

test("a full event: join the waiting list as a group, and when someone cancels the first group that fits gets the places at once", async ({ page, browser }) => {
  const title = `Waiting ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-05", start: "18:00", end: "20:00", limit: "3" });

  const lars = await as(browser, "Lars Eriksen");
  await lars.goto(`/club/events/${id}`);
  await lars.locator("#guests").selectOption("1");
  await lars.getByRole("button", { name: "Update" }).click();
  await lars.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(lars.getByTestId("joined-note")).toHaveText("You are going. 2 places taken.");

  // Britta and a guest need two places; one is left, so the pair joins the waiting list together.
  const britta = await as(browser, "Britta Eriksen");
  await britta.goto(`/club/events/${id}?guests=1`);
  await expect(britta.getByText("does not fit in the 1 place left")).toBeVisible();
  await britta.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(britta.getByTestId("joined-note")).toContainText("On the waiting list, 1st in line.");

  // Declan alone fits in the one place left, so he goes ahead of the waiting pair.
  const declan = await as(browser, "Declan Halloran");
  await declan.goto(`/club/events/${id}`);
  await declan.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(declan.getByTestId("joined-note")).toHaveText("You are going. 1 place taken.");
  await expect(declan.getByTestId("event-places")).toContainText("Full, 1 waiting");

  // Lars cancels: two places free up and Britta's pair moves in with no action of her own.
  await lars.goto(`/club/events/${id}`);
  await lars.getByRole("button", { name: "Cancel my RSVP" }).click();
  await britta.goto(`/club/events/${id}`);
  await expect(britta.getByTestId("your-place")).toHaveText("You are going, with 1 guest.");

  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("sheet")).toContainText("Britta Eriksen +1 · going");
  await expect(page.getByTestId("sheet")).toContainText("Declan Halloran · going");
  await cancelEvent(page, id);
  await britta.goto(`/club/events/${id}`);
  await expect(britta.getByTestId("event-cancelled")).toContainText("Test finished");
  for (const p of [lars, britta, declan]) await p.context().close();
});

test("a personal link from an email: the CSV has one link per active adult, opening it records nothing, one click RSVPs, and a forged link finds nothing", async ({ page, browser }) => {
  const title = `Links ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-06", start: "18:00", end: "20:00", limit: "5" });

  // Staff download everyone's links.
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("links-download")).toBeVisible();
  const download = await page.request.get(`/api/club/events/${id}/links`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("text/csv");
  expect(download.headers()["content-disposition"]).toContain("rsvp-links-links-");
  const csv = await download.text();
  const rows = csv.trim().split("\r\n");
  expect(rows[0]).toBe("email,first_name,last_name,household,rsvp_link");
  expect(csv).not.toContain("colm.fitzgerald@example.com"); // that household left
  const link = (email: string) => rows.find((r) => r.startsWith(`${email},`))!.split(",").pop()!;
  const chidi = new URL(link("chidi.okonkwo@example.com"));
  const amara = new URL(link("amara.okonkwo@example.com"));
  expect(chidi.pathname).toMatch(new RegExp(`^/club/rsvp/${id}/[0-9a-f-]{36}/[A-Za-z0-9_-]{43}$`));

  // A stranger's browser, with no test member chosen: the link alone says who is replying.
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(chidi.pathname);
  await expect(stranger.getByTestId("link-who")).toContainText("Replying as Chidi Okonkwo");
  await expect(stranger.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  // Opening the link recorded nothing.
  await page.goto(`/club/events/${id}`);
  await expect(page.getByText("Nobody has RSVPed yet.")).toBeVisible();

  // One click, with a guest.
  await stranger.locator("#guests").selectOption("1");
  await stranger.getByRole("button", { name: "Update" }).click();
  await stranger.getByRole("button", { name: "Yes, I am going" }).click();
  await expect(stranger.getByTestId("joined-note")).toHaveText("You are going. 2 places taken.");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("sheet")).toContainText("Chidi Okonkwo +1 · going · from an email link");

  // Forged or mismatched links find nothing, and all look the same.
  const forged = chidi.pathname.slice(0, -1) + (chidi.pathname.endsWith("A") ? "B" : "A");
  const chidiCodeOnAmara = `/club/rsvp/${id}/${amara.pathname.split("/")[4]}/${chidi.pathname.split("/")[5]}`;
  const otherEvent = chidi.pathname.replace(id, "11111111-1111-4111-8111-111111111111");
  for (const bad of [forged, chidiCodeOnAmara, otherEvent]) {
    expect((await stranger.goto(bad))?.status(), bad).toBe(404);
    await expect(stranger.locator("body")).not.toContainText("Okonkwo");
  }
  const noCode = await stranger.request.post("/api/club/events/link", { form: { event: id, member: chidi.pathname.split("/")[4], token: "x".repeat(43), action: "rsvp", guests: "0" }, maxRedirects: 0 });
  expect(noCode.status()).toBe(404);

  // The link can cancel too, and only that person's own RSVP.
  await stranger.goto(chidi.pathname);
  await stranger.getByRole("button", { name: "Cancel my RSVP" }).click();
  await expect(stranger.getByTestId("joined-note")).toHaveText("Your RSVP is cancelled.");
  await stranger.context().close();
  await cancelEvent(page, id);
});

test("refusals are explained in plain words: closed, and an event that must start in the future", async ({ page }) => {
  const title = `Soon ${Date.now().toString(36)}`;
  // Starts at 1:30 pm today, half an hour from the frozen clock, so RSVPs (which close an hour before) are already closed.
  const id = await addEvent(page, { title, date: "2026-10-28", start: "13:30", end: "15:00" });
  await actAs(page, "Rafael Castellanos");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("refusal")).toContainText(`RSVPs for ${title} closed 1 hour before it starts.`);
  await expect(page.getByRole("button", { name: "RSVP", exact: true })).toHaveCount(0);
  await cancelEvent(page, id);

  // The add-event form explains a time already gone, and keeps what was typed.
  await actAs(page, "Test staff");
  await page.goto("/club/events/manage");
  await page.locator("#title").fill("Too late");
  await page.locator("#date").fill("2026-10-28");
  await page.locator("#start").fill("12:00");
  await page.locator("#end").fill("14:00");
  await page.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByTestId("event-problem")).toHaveText("The event must start in the future.");
  await expect(page.locator("#title")).toHaveValue("Too late");
});

test("staff: raising the limit moves the waiting list up, a new price is remembered, and cancelling the event lists who to contact", async ({ page, browser }) => {
  const title = `Limit ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-07", start: "17:00", end: "19:00", limit: "1" });
  const lars = await as(browser, "Lars Eriksen");
  const britta = await as(browser, "Britta Eriksen");
  for (const p of [lars, britta]) {
    await p.goto(`/club/events/${id}`);
    await p.getByRole("button", { name: /^(RSVP|Join the waiting list)$/ }).click();
    await expect(p.getByTestId("joined-note")).toBeVisible();
  }
  await expect(britta.getByTestId("your-place")).toHaveText("You are on the waiting list, 1st in line.");

  await actAs(page, "Test staff");
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await page.locator("#e-limit").fill("2");
  await page.locator("#e-price").fill("12.50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByTestId("event-places")).toContainText("$12.50 a place");
  await expect(page.getByTestId("sheet").locator('[data-status="going"]')).toHaveCount(2);
  await britta.goto(`/club/events/${id}`);
  await expect(britta.getByTestId("your-place")).toHaveText("You are going.");

  // A limit below the people going is refused in words.
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await page.locator("#e-limit").evaluate((el: HTMLInputElement) => { el.min = "1"; });
  await page.locator("#e-limit").fill("1");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("p.club-alert")).toContainText("cannot go below the number of people already going");

  await cancelEvent(page, id, "Venue flooded");
  await expect(page.getByTestId("affected")).toContainText("Lars Eriksen");
  await expect(page.getByTestId("affected")).toContainText("Britta Eriksen");
  await lars.context().close();
  await britta.context().close();
});

test("a full sample event: members see counts and the join-the-waiting-list button, never names; staff see names and guests", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/events");
  await expect(card(page, "Members' Dinner").getByTestId("event-places")).toHaveText("Full, 2 waiting");
  await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");
  await expect(page.getByRole("button", { name: "Join the waiting list" })).toBeVisible();
  await expect(page.getByText("$45 a place")).toBeVisible();

  await actAs(page, "Test staff");
  await page.goto("/club/events");
  await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
  await expect(page.getByTestId("sheet")).toContainText("Erik Lindqvist +1 · going");
  await expect(page.getByTestId("sheet").locator('[data-status="waitlisted"]').first()).toContainText("Nora Abernathy +1 · waiting, 1st in line");
});

test("a free event with no limit just counts who is going", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/events");
  await expect(card(page, "Boathouse Work Party").getByTestId("event-places")).toContainText("going");
  await expect(card(page, "Boathouse Work Party")).toContainText("Free");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("the event pages fit the screen", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/club/events");
    expect(await noSidewaysScroll()).toBe(true);
    await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Test staff");
    await page.goto("/club/events/manage");
    expect(await noSidewaysScroll()).toBe(true);
    await page.goto("/club/events");
    await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
    await page.getByText("Edit this event").click();
    expect(await noSidewaysScroll()).toBe(true);
  });
});
