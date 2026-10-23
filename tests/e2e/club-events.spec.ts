import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Events and RSVPs in the browser. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026, so a
 * place on a waitlist made now is held until 2:00 pm. The invented club has these events already: Members' Dinner on Fri
 * Oct 30 at 6 pm ($45, 12 spots, full, with Nora Abernathy and Ines Castellanos on the waitlist), Fall Regatta Social on Sat
 * Oct 31 ($25, 40 spots), and a free Boathouse Work Party on Tue Nov 3 with no limit. All tests share one server, so the
 * ones that change things make their own event and cancel it at the end, so a retried run starts clean.
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

/** Press the plus or minus until the number picker shows `n`. Waits for the page to come alive before trusting a click. */
async function setParty(page: Page, n: number) {
  const count = page.getByTestId("party-count");
  const more = page.getByRole("button", { name: "More people" });
  const fewer = page.getByRole("button", { name: "Fewer people" });
  await expect(count).toBeVisible();
  for (let guard = 0; guard < 20; guard++) {
    const now = Number(await count.innerText());
    if (now === n) return;
    await (now < n ? more : fewer).click();
    await expect(count).not.toHaveText(String(now), { timeout: 1500 }).catch(() => undefined);
  }
  await expect(count).toHaveText(String(n));
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

test("core flow: pick a member, find an event, choose how many people, RSVP, see the spots go, change the party, cancel, and see them come back", async ({ page }) => {
  const title = `Core ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-04", start: "19:00", end: "21:00", limit: "10", price: "25" });

  await actAs(page, "Rafael Castellanos");
  await page.goto("/club/events");
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  await expect(card(page, title).getByTestId("event-places")).toHaveText("10 spots left");
  await expect(card(page, title)).toContainText("Wednesday, Nov 4, 7:00 pm");
  await card(page, title).getByRole("link", { name: title }).click();

  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How RSVPs work" })).toBeVisible();
  // The picker starts at one person (the member), and the words and the total follow the number.
  await expect(page.getByTestId("party-count")).toHaveText("1");
  await setParty(page, 3);
  await expect(page.getByTestId("price-total")).toHaveText("3 spots × $25 = $75");
  await expect(page.getByTestId("party-notice")).toHaveText("There are 10 spots available. There is room for your party.");
  await page.getByTestId("party-submit").click();
  await expect(page.getByTestId("joined-note")).toHaveText("You are going. 3 spots taken.");
  await expect(page.getByTestId("your-place")).toHaveText("You are going, party of 3.");

  await page.goto("/club/events");
  await expect(card(page, title).getByTestId("event-places")).toHaveText("7 spots left");
  await expect(card(page, title)).toContainText("You are going, party of 3.");

  // Someone else sees the spots but not the name.
  await actAs(page, "Walter Pemberton");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("event-places")).toContainText("7 spots left");
  await expect(page.locator("body")).not.toContainText("Castellanos");

  // Making the party smaller gives spots back; cancelling gives them all back.
  await actAs(page, "Rafael Castellanos");
  await page.goto(`/club/events/${id}`);
  await setParty(page, 1);
  await page.getByRole("button", { name: "Change my party" }).click();
  await expect(page.getByTestId("your-place")).toHaveText("You are going.");
  await expect(page.getByTestId("event-places")).toContainText("9 spots left");
  await page.getByRole("button", { name: "Cancel my RSVP" }).click();
  await page.goto("/club/events");
  await expect(card(page, title).getByTestId("event-places")).toHaveText("10 spots left");
  await cancelEvent(page, id);
});

test("too many people for the spots left: the picker says so before anything is pressed, the party can join the waitlist or take the smaller number, and a waiting place is held for an hour", async ({ page, browser }) => {
  const title = `Spots ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-05", start: "18:00", end: "20:00", limit: "3" });

  const lars = await as(browser, "Lars Eriksen");
  await lars.goto(`/club/events/${id}`);
  await lars.getByTestId("party-submit").click();
  await expect(lars.getByTestId("joined-note")).toHaveText("You are going. 1 spot taken.");

  // Two spots are left. Britta wants four: she is told before she presses anything.
  const britta = await as(browser, "Britta Eriksen");
  await britta.goto(`/club/events/${id}`);
  await setParty(britta, 2);
  await expect(britta.getByTestId("party-notice")).toHaveText("There are 2 spots available. There is room for your party.");
  await setParty(britta, 4);
  await expect(britta.getByTestId("party-notice")).toHaveText(
    "There are only 2 spots available. There is a waitlist. To RSVP now, lower the number to 2. Or join the waitlist for 4. Your place on the waitlist will be removed in 1 hour, unless you press Keep my place.",
  );
  await expect(britta.getByTestId("party-submit")).toHaveText("Join the waitlist for 4");
  await expect(britta.getByTestId("party-instead")).toHaveText("RSVP for 2 instead");

  // She joins the waitlist for all four: told no, told about the waitlist, and told when the place will be removed.
  await britta.getByTestId("party-submit").click();
  await expect(britta.getByTestId("joined-note")).toHaveText(
    "We don't have that many spots available. There is a waitlist, and you are on it, 1st in line, for a party of 4. If only 2 spots would work for your party, change your party to 2 below. Your place on the waitlist will be removed in 1 hour, at 2:00 pm, unless you press Keep my place.",
  );
  await expect(britta.getByTestId("your-place")).toHaveText("You are on the waitlist for a party of 4, 1st in line.");
  await expect(britta.getByTestId("hold-note")).toHaveText("Your place is held until 2:00 pm. Press Keep my place to hold it for another hour.");

  // Keeping the place works, and so does making the party smaller: two fit, so she moves up at once.
  await britta.getByTestId("keep-place").click();
  await expect(britta.getByText("Saved.")).toBeVisible();
  await expect(britta.getByTestId("hold-note")).toContainText("held until 2:00 pm");
  await setParty(britta, 5);
  await expect(britta.getByTestId("party-notice")).toHaveText("Only 2 spots are available, so a party of 5 stays on the waitlist.");
  await setParty(britta, 2);
  await expect(britta.getByTestId("party-notice")).toHaveText("This number fits now, so you would move up to a spot straight away.");
  await britta.getByRole("button", { name: "Change my party" }).click();
  await expect(britta.getByTestId("your-place")).toHaveText("You are going, party of 2.");

  // Declan arrives when it is full: nothing smaller would fit, so there is no smaller party to offer.
  const declan = await as(browser, "Declan Halloran");
  await declan.goto(`/club/events/${id}`);
  await setParty(declan, 3);
  await expect(declan.getByTestId("party-notice")).toContainText("There are no spots available. There is a waitlist.");
  await expect(declan.getByTestId("party-instead")).toHaveCount(0); // nothing smaller would fit either

  await cancelEvent(page, id);
  for (const p of [lars, britta, declan]) await p.context().close();
});

test("the smaller party in one press: 'RSVP for N instead' takes the spots that are left", async ({ page, browser }) => {
  const title = `Instead ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-05", start: "10:00", end: "12:00", limit: "3" });
  const lars = await as(browser, "Lars Eriksen");
  await lars.goto(`/club/events/${id}`);
  await lars.getByTestId("party-submit").click();
  await expect(lars.getByTestId("joined-note")).toBeVisible();

  const camille = await as(browser, "Camille Moreau");
  await camille.goto(`/club/events/${id}`);
  await setParty(camille, 4);
  await camille.getByTestId("party-instead").click();
  await expect(camille.getByTestId("joined-note")).toHaveText("You are going. 2 spots taken.");
  await expect(camille.getByTestId("event-places")).toContainText("Full");

  // Now it is full and the waitlist is open: a single person is told so, and can join the waitlist.
  const declan = await as(browser, "Declan Halloran");
  await declan.goto(`/club/events/${id}`);
  await expect(declan.getByTestId("party-notice")).toContainText("There are no spots available. There is a waitlist.");
  await expect(declan.getByTestId("party-submit")).toHaveText("Join the waitlist for 1");
  await declan.getByTestId("party-submit").click();
  await expect(declan.getByTestId("joined-note")).toContainText("1st in line, for a party of 1.");

  // When Lars cancels, Declan's single spot opens and he moves up with no action of his own.
  await lars.goto(`/club/events/${id}`);
  await lars.getByRole("button", { name: "Cancel my RSVP" }).click();
  await declan.goto(`/club/events/${id}`);
  await expect(declan.getByTestId("your-place")).toHaveText("You are going.");
  await cancelEvent(page, id);
  for (const p of [lars, camille, declan]) await p.context().close();
});

test("a personal link from an email: the CSV has one link per active adult, opening it records nothing, one click RSVPs, the waitlist can be kept from it, and a forged link finds nothing", async ({ page, browser }) => {
  const title = `Links ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-06", start: "18:00", end: "20:00", limit: "2" });

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
  await setParty(stranger, 2);
  await stranger.getByTestId("party-submit").click();
  await expect(stranger.getByTestId("joined-note")).toHaveText("You are going. 2 spots taken.");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("sheet")).toContainText("Chidi Okonkwo · party of 2 · going · from an email link");

  // Amara's link, on a full event: told there is a waitlist, joins it, and can keep her place from the same link.
  const amaraPage = await (await browser.newContext()).newPage();
  await amaraPage.goto(amara.pathname);
  await expect(amaraPage.getByTestId("party-notice")).toContainText("There are no spots available. There is a waitlist.");
  await amaraPage.getByTestId("party-submit").click();
  await expect(amaraPage.getByTestId("joined-note")).toContainText("you are on it, 1st in line, for a party of 1");
  await expect(amaraPage.getByTestId("hold-note")).toContainText("held until 2:00 pm");
  await amaraPage.getByTestId("keep-place").click();
  await expect(amaraPage.getByTestId("your-place")).toHaveText("You are on the waitlist, 1st in line.");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("sheet").locator('[data-status="waitlisted"]')).toContainText("Amara Okonkwo · waitlist, 1st in line, held until 2:00 pm · from an email link");

  // Forged or mismatched links find nothing, and all look the same.
  const forged = chidi.pathname.slice(0, -1) + (chidi.pathname.endsWith("A") ? "B" : "A");
  const chidiCodeOnAmara = `/club/rsvp/${id}/${amara.pathname.split("/")[4]}/${chidi.pathname.split("/")[5]}`;
  const otherEvent = chidi.pathname.replace(id, "11111111-1111-4111-8111-111111111111");
  for (const bad of [forged, chidiCodeOnAmara, otherEvent]) {
    expect((await stranger.goto(bad))?.status(), bad).toBe(404);
    await expect(stranger.locator("body")).not.toContainText("Okonkwo");
  }
  const noCode = await stranger.request.post("/api/club/events/link", { form: { event: id, member: chidi.pathname.split("/")[4], token: "x".repeat(43), action: "rsvp", people: "1" }, maxRedirects: 0 });
  expect(noCode.status()).toBe(404);

  // The link can cancel too, and only that person's own RSVP; Chidi leaving moves Amara up.
  await stranger.goto(chidi.pathname);
  await stranger.getByRole("button", { name: "Cancel my RSVP" }).click();
  await expect(stranger.getByTestId("joined-note")).toHaveText("Your RSVP is cancelled.");
  await amaraPage.goto(amara.pathname);
  await expect(amaraPage.getByTestId("your-place")).toHaveText("You are going.");
  for (const p of [stranger, amaraPage]) await p.context().close();
  await cancelEvent(page, id);
});

test("refusals are explained in plain words: closed, and an event that must start in the future", async ({ page }) => {
  const title = `Soon ${Date.now().toString(36)}`;
  // Starts at 1:30 pm today, half an hour from the frozen clock, so RSVPs (which close an hour before) are already closed.
  const id = await addEvent(page, { title, date: "2026-10-28", start: "13:30", end: "15:00" });
  await actAs(page, "Rafael Castellanos");
  await page.goto(`/club/events/${id}`);
  await expect(page.getByTestId("refusal")).toContainText(`RSVPs for ${title} closed 1 hour before it starts.`);
  await expect(page.getByTestId("party-submit")).toHaveCount(0);
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

test("staff: raising the limit moves the waitlist up, a new price is remembered, and cancelling the event lists who to contact", async ({ page, browser }) => {
  const title = `Limit ${Date.now().toString(36)}`;
  const id = await addEvent(page, { title, date: "2026-11-07", start: "17:00", end: "19:00", limit: "1" });
  const lars = await as(browser, "Lars Eriksen");
  const britta = await as(browser, "Britta Eriksen");
  for (const p of [lars, britta]) {
    await p.goto(`/club/events/${id}`);
    await p.getByTestId("party-submit").click();
    await expect(p.getByTestId("joined-note")).toBeVisible();
  }
  await expect(britta.getByTestId("your-place")).toHaveText("You are on the waitlist, 1st in line.");

  await actAs(page, "Test staff");
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await page.locator("#e-limit").fill("2");
  await page.locator("#e-price").fill("12.50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByTestId("event-places")).toContainText("$12.50 a spot");
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

test("a full sample event: members see counts and the join-the-waitlist button, never names; staff see names, parties and who is waiting", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/events");
  await expect(card(page, "Members' Dinner").getByTestId("event-places")).toHaveText("Full, 2 on the waitlist");
  await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");
  await expect(page.getByTestId("party-submit")).toHaveText("Join the waitlist for 1");
  await expect(page.getByTestId("party-notice")).toContainText("There are no spots available. There is a waitlist.");
  await expect(page.getByText("$45 a spot")).toBeVisible();

  await actAs(page, "Test staff");
  await page.goto("/club/events");
  await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
  await expect(page.getByTestId("sheet")).toContainText("Erik Lindqvist · party of 2 · going");
  await expect(page.getByTestId("sheet").locator('[data-status="waitlisted"]').first()).toContainText("Nora Abernathy · party of 2 · waitlist, 1st in line");
});

test("a free event with no limit just counts who is going", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/events");
  await expect(card(page, "Boathouse Work Party").getByTestId("event-places")).toContainText("going");
  await expect(card(page, "Boathouse Work Party")).toContainText("Free");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("the event pages fit the screen, and the plus and minus are big enough to tap", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/club/events");
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Declan Halloran");
    await page.goto("/club/events");
    await card(page, "Members' Dinner").getByRole("link", { name: "Members' Dinner" }).click();
    expect(await noSidewaysScroll()).toBe(true);
    for (const name of ["Fewer people", "More people"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await setParty(page, 4);
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
