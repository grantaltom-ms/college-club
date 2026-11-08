import { expect, test, type Page } from "@playwright/test";
import { pickSlot } from "./helpers";

/**
 * Fitness classes in the browser. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026.
 * The invented club has these classes already: Erg Conditioning on Thu Oct 29 at 5:00 pm in the Boathouse gym, 4 chairs,
 * full, with Tomas Vandermeer and Nora Abernathy waiting; Morning Yoga on Fri Oct 30 at 7:00 am (2 people in); Stretch &
 * Mobility on Fri Oct 30 at 12:00 pm, nobody in yet. All tests share one server, so the ones that change things make
 * their own class, use their own members, and cancel their class at the end so a retried run starts clean.
 *
 * The primary list is a bulletin of classes (usual days from pinned sessions). Tap a class for its upcoming dates,
 * then sign up on a date. The day-by-day board stays behind the "By day" toggle.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const card = (page: Page, name: string) => page.getByTestId("class-card").filter({ hasText: name });
const upcomingRows = (page: Page) => page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("class-row");

/** Open a class's upcoming-dates page from the bulletin, then open its first (or matching) session. */
async function openClassSession(page: Page, name: string, sessionText?: RegExp | string) {
  await page.goto("/club/classes");
  await card(page, name).getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(/\/club\/classes\/of\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const row = sessionText ? page.getByTestId("class-session").filter({ hasText: sessionText }) : page.getByTestId("class-session").first();
  await row.getByTestId("session-signup").click();
  await expect(page).toHaveURL(/\/club\/classes\/[0-9a-f-]{36}/);
}

/** Leave everything this member still has coming up, so a retried test starts clean. */
async function leaveAll(page: Page) {
  await page.goto("/club/my-bookings");
  const buttons = page.getByRole("button", { name: /^Leave / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("left-note")).toBeVisible();
  }
}

test("core flow: pick a member, find a class, sign up, see it in My bookings, leave, and see the place free again", async ({ page }) => {
  await actAs(page, "Rafael Castellanos");
  await leaveAll(page);

  await page.goto("/club/classes");
  await expect(page.getByRole("heading", { level: 1, name: "Fitness classes" })).toBeVisible();
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  await expect(page.getByTestId("classes-view-toggle").getByRole("link", { name: "Classes" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("class-calendar-subscribe")).toBeVisible();
  await expect(page.getByTestId("calendar-ics")).toBeVisible();
  await expect(card(page, "Stretch & Mobility").getByTestId("class-schedule")).toContainText(/Fridays/);
  await expect(card(page, "Stretch & Mobility").getByTestId("class-schedule")).toContainText(/Clubhouse room/);
  await expect(card(page, "Stretch & Mobility").getByTestId("class-schedule")).toContainText(/10 places/);

  await openClassSession(page, "Stretch & Mobility", /Friday, Oct 30/);
  await expect(page.getByRole("heading", { level: 1, name: "Stretch & Mobility" })).toBeVisible();
  await expect(page.getByTestId("class-when")).toContainText("Friday, Oct 30, 12:00 to 12:30 pm");
  await expect(page.getByRole("heading", { name: "Rules for Stretch & Mobility" })).toBeVisible();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByTestId("joined-note")).toContainText("You are in. You have a place.");
  await expect(page.getByTestId("joined-note")).toContainText("Stretch & Mobility on Friday, Oct 30");
  await expect(page.locator("#joined .club-done-title")).toHaveText("You're in");

  await page.goto("/club/my-bookings");
  const row = upcomingRows(page).filter({ hasText: "Stretch & Mobility" });
  await expect(row).toContainText("Friday, Oct 30, 12:00 to 12:30 pm");
  await expect(row.getByTestId("class-status")).toHaveText("You have a place");

  // Anyone else sees one fewer place on the class's date list, and not the name.
  await actAs(page, "Walter Pemberton");
  await page.goto("/club/classes");
  await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).click();
  await expect(page.getByTestId("class-session").filter({ hasText: /Friday, Oct 30/ }).getByTestId("class-chairs")).toHaveText("9 places left");
  await page.getByTestId("class-session").filter({ hasText: /Friday, Oct 30/ }).getByTestId("session-signup").click();
  await expect(page.locator("body")).not.toContainText("Castellanos");

  await actAs(page, "Rafael Castellanos");
  await page.goto("/club/my-bookings");
  await upcomingRows(page).filter({ hasText: "Stretch & Mobility" }).getByRole("button", { name: /^Leave / }).click();
  await expect(page.getByTestId("left-note")).toContainText("Your place is free for others.");
  await expect(upcomingRows(page).filter({ hasText: "Stretch & Mobility" })).toHaveCount(0);
  await page.goto("/club/classes");
  await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).click();
  await expect(page.getByTestId("class-session").filter({ hasText: /Friday, Oct 30/ }).getByTestId("class-chairs")).toHaveText("10 places left");
});

test("My bookings holds class sign-ups and boat bookings in one list, soonest first, each tagged with what it is", async ({ page }) => {
  // The sample's Julien Moreau holds a chair in Lunchtime Mobility at 1:15 pm today and has the Drift paddle board at 3 pm today.
  await actAs(page, "Julien Moreau");
  await page.goto("/club/my-bookings");
  await expect(page.getByRole("heading", { level: 1, name: "My bookings" })).toBeVisible();
  const list = page.getByRole("list", { name: "Upcoming bookings" });
  const mobility = list.getByTestId("class-row").filter({ hasText: "Lunchtime Mobility" });
  const drift = list.getByTestId("booking-row").filter({ hasText: "Drift" });
  await expect(mobility).toHaveCount(1);
  await expect(drift).toHaveCount(1);
  await expect(mobility.getByTestId("row-kind")).toHaveText("Class");
  await expect(drift.getByTestId("row-kind")).toHaveText("Paddle Board");
  // One list in time order: the 1:15 pm class comes before the 3 pm paddle board, whichever kind each is.
  const names = await list.locator('[data-testid="class-row"], [data-testid="booking-row"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-class") ?? el.getAttribute("data-item")));
  expect(names.indexOf("Lunchtime Mobility")).toBeGreaterThanOrEqual(0);
  expect(names.indexOf("Lunchtime Mobility")).toBeLessThan(names.indexOf("Drift"));
  // There is no second list of classes any more: one Upcoming heading and one Past heading.
  await expect(page.getByRole("heading", { level: 2, name: "Upcoming" })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Past" })).toHaveCount(1);
  // The class row keeps its link to the class and its own buttons.
  await expect(mobility.getByRole("link", { name: "Lunchtime Mobility" })).toHaveAttribute("href", /\/club\/classes\/[0-9a-f-]{36}$/);
});

test("the old My classes address forwards to My bookings, keeping only the notices it understood, and My account no longer lists it", async ({ page }) => {
  await actAs(page, "Rafael Castellanos");
  await page.goto("/club/my-classes");
  await expect(page).toHaveURL(/\/club\/my-bookings$/);
  await expect(page.getByRole("heading", { level: 1, name: "My bookings" })).toBeVisible();

  await page.goto("/club/my-classes?notice=invalid&left=not-a-real-id&somethingelse=1");
  await expect(page).toHaveURL(/\/club\/my-bookings\?(?=.*notice=invalid)(?=.*left=not-a-real-id)(?!.*somethingelse)/);
  await expect(page.locator("p.club-alert")).toBeVisible();

  // The menu has no My classes link: the page is part of My bookings.
  await page.setViewportSize({ width: 1180, height: 800 });
  await page.goto("/club");
  await page.getByRole("navigation", { name: "Member area" }).getByRole("button", { name: "My account" }).click();
  await expect(page.locator("#club-account-menu").getByRole("link", { name: "My classes" })).toHaveCount(0);
  await expect(page.locator("#club-account-menu").getByRole("link", { name: "My bookings" })).toBeVisible();

  // Staff are sent to the same place: All bookings.
  await actAs(page, "Test staff");
  await page.goto("/club/my-classes");
  await expect(page).toHaveURL(/\/club\/my-bookings$/);
  await expect(page.getByRole("heading", { level: 1, name: "All bookings" })).toBeVisible();
});

test("the calendar feed lists upcoming classes with no member names, and works without signing in", async ({ page, request }) => {
  await actAs(page, "Nora Abernathy");
  await page.goto("/club/classes");
  const href = await page.getByTestId("calendar-ics").getAttribute("href");
  expect(href).toMatch(/\/api\/club\/classes\/calendar$/);

  // Signed out: calendar apps have no cookie.
  const fresh = await request.get("/api/club/classes/calendar");
  expect(fresh.status()).toBe(200);
  expect(fresh.headers()["content-type"]).toMatch(/text\/calendar/);
  const body = await fresh.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect(body).toContain("SUMMARY:Erg Conditioning");
  expect(body).toContain("SUMMARY:Stretch & Mobility");
  expect(body).toContain("LOCATION:Boathouse gym");
  expect(body).not.toContain("Vandermeer");
  expect(body).not.toContain("Abernathy");
  expect(body).not.toContain("Lindqvist");
});

test("By day still shows the day board for members who think in dates", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await page.goto("/club/classes");
  await page.getByTestId("classes-view-toggle").getByRole("link", { name: "By day" }).click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page.getByTestId("classes-view-toggle").getByRole("link", { name: "By day" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Pick a day" })).toBeVisible();
  await page.getByRole("navigation", { name: "Pick a day" }).getByRole("link", { name: /Fri Oct 30/ }).click();
  await expect(page.getByTestId("day-heading")).toContainText("Friday, Oct 30");
  // Places left can move if another test signed up for Stretch on the shared server; just open the session.
  await expect(card(page, "Stretch & Mobility").getByTestId("class-chairs")).toContainText(/places left|Full/);
  await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).click();
  await expect(page).toHaveURL(/\/club\/classes\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("class-when")).toContainText("Friday, Oct 30");
});

test("a full class: join the waiting list, and when someone leaves the first in line gets the chair at once", async ({ page, browser }) => {
  const suffix = Date.now().toString(36);
  const name = `Drill ${suffix}`;

  // Staff make a one-chair class on a day of its own.
  await actAs(page, "Test staff");
  await page.goto("/club/classes/manage");
  await page.getByLabel("Name").fill(name);
  await page.locator("#chairs").fill("1");
  await page.getByRole("button", { name: "Add class" }).click();
  await expect(page.getByTestId("created-note")).toBeVisible();
  await page.getByLabel("Class", { exact: true }).selectOption({ label: name });
  await page.getByLabel("First date").fill("2026-11-03");
  await page.getByLabel("Start time (Pacific)").fill("10:00");
  await page.locator("#sched-room").selectOption("none");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByTestId("scheduled-note")).toHaveText(/Scheduled 1 session/);

  const open = async (p: Page) => {
    await openClassSession(p, name);
    await expect(p.getByRole("heading", { level: 1, name })).toBeVisible();
  };
  const as = async (who: string) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await actAs(p, who);
    return p;
  };

  const lars = await as("Lars Eriksen");
  await open(lars);
  await lars.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(lars.getByTestId("joined-note")).toContainText("You are in. You have a place.");
  await expect(lars.locator("#joined .club-done-title")).toHaveText("You're in");

  const britta = await as("Britta Eriksen");
  await open(britta);
  await expect(britta.getByTestId("class-chairs")).toContainText("Full");
  await britta.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(britta.getByTestId("joined-note")).toContainText("On the waiting list, 1st in line.");
  await expect(britta.locator("#joined .club-done-title")).toHaveText("On the waiting list");

  const declan = await as("Declan Halloran");
  await open(declan);
  await declan.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(declan.getByTestId("joined-note")).toContainText("On the waiting list, 2nd in line.");
  await declan.goto("/club/my-bookings");
  await expect(upcomingRows(declan).filter({ hasText: name }).getByTestId("class-status")).toHaveText("On the waiting list");
  await expect(upcomingRows(declan).filter({ hasText: name })).toContainText("2nd in line");

  // Lars leaves; Britta now has the chair, with no action of her own, and Declan is first in line.
  await lars.goto("/club/my-bookings");
  await upcomingRows(lars).filter({ hasText: name }).getByRole("button", { name: /^Leave / }).click();
  await expect(lars.getByTestId("left-note")).toBeVisible();
  await britta.goto("/club/my-bookings");
  await expect(upcomingRows(britta).filter({ hasText: name }).getByTestId("class-status")).toHaveText("You have a place");
  await expect(upcomingRows(britta).filter({ hasText: name })).toContainText("moved up from the waiting list");
  await declan.goto("/club/my-bookings");
  await expect(upcomingRows(declan).filter({ hasText: name })).toContainText("1st in line");

  // Staff see all the names; cancelling takes everyone off, emails them, and lists who was told.
  await openClassSession(page, name);
  await expect(page.getByTestId("sheet")).toContainText("Britta Eriksen");
  await expect(page.getByTestId("sheet")).toContainText("Declan Halloran");
  await page.getByLabel(/Cancel this class/).fill("Instructor is ill");
  await page.getByRole("button", { name: /^Cancel .*Drill/ }).click();
  await expect(page.getByTestId("class-cancelled")).toContainText("Instructor is ill");
  await expect(page.getByTestId("class-changed")).toContainText("We emailed all 2 people who were signed up or waiting.");
  await expect(page.getByTestId("affected")).toContainText("Britta Eriksen");
  await expect(page.getByTestId("affected")).toContainText("Declan Halloran");
  await expect(page.getByTestId("affected")).toContainText("People who were emailed");
  await page.goto("/club/outbox");
  await expect(page.getByTestId("outbox-message").filter({ hasText: "To britta.eriksen@example.com" }).filter({ hasText: "Class cancelled" })).toHaveCount(1);
  await expect(page.getByTestId("outbox-message").filter({ hasText: "To declan.halloran@example.com" }).filter({ hasText: "Class cancelled" })).toHaveCount(1);
  await expect(page.getByTestId("outbox-message").filter({ hasText: "Instructor is ill" }).first()).toBeVisible();
  await britta.goto("/club/my-bookings");
  await expect(britta.getByRole("list", { name: "Past bookings" }).getByTestId("class-row").filter({ hasText: name })).toContainText("Class cancelled");
  await britta.context().close();
  await declan.context().close();
  await lars.context().close();
});

test("one place at a time: a class is refused when a boat is booked then, and a boat when you are in a class", async ({ page }) => {
  await actAs(page, "Chidi Okonkwo");
  const cancelBoats = async () => {
    await page.goto("/club/my-bookings");
    const buttons = page.getByRole("button", { name: /^Cancel / });
    while ((await buttons.count()) > 0) {
      await buttons.first().click();
      await expect(page.getByTestId("cancelled-note")).toBeVisible();
    }
  };
  await cancelBoats();
  await leaveAll(page);

  // A single booked over the Stretch class hour (dense list needs the hour).
  await page.goto("/club/book?day=2026-10-30&what=shell&kind=single&hour=12");
  await pickSlot(page, "Heron", "12:00 to 12:30 pm");
  await page.getByRole("button", { name: "Book Heron", exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();

  await openClassSession(page, "Stretch & Mobility", /Friday, Oct 30/);
  const classPage = page.url();
  await expect(page.getByTestId("refusal")).toContainText("You have Heron booked from 12:00 to 1:30 pm.");
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toHaveCount(0);

  // Without the boat, the class is open; once in it, the same hour is closed for boats.
  await cancelBoats();
  await page.goto(classPage);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByTestId("joined-note")).toBeVisible();
  await page.goto("/club/book?day=2026-10-30&what=shell&kind=single&hour=12");
  await pickSlot(page, "Heron", "12:00 to 12:30 pm");
  await expect(page.getByTestId("refusal-reasons")).toContainText("You are signed up for Stretch & Mobility from 12:00 to 12:30 pm.");
  await leaveAll(page);
});

test("staff: a class that would clash with another in the gym is explained in words, a free hour is scheduled, and members see the gym held", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const name = `Core ${suffix}`;
  await actAs(page, "Test staff");
  await page.goto("/club/classes/manage");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Usual room").selectOption({ label: "Boathouse gym" });
  await page.getByRole("button", { name: "Add class" }).click();
  await expect(page.getByTestId("created-note")).toBeVisible();

  const fill = async (time: string) => {
    await page.getByLabel("Class", { exact: true }).selectOption({ label: name });
    await page.getByLabel("First date").fill("2026-10-29");
    await page.getByLabel("Start time (Pacific)").fill(time);
  };
  await fill("17:15");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByTestId("schedule-problems")).toContainText("Nothing was scheduled. Boathouse gym is already used for Erg Conditioning on Thursday, Oct 29, 5:00 to 5:45 pm.");
  await fill("19:00");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByTestId("scheduled-note")).toHaveText(/Scheduled 1 session/);

  // Members see the gym held for the class and cannot book it then.
  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/book?day=2026-10-29&type=Gym%20Space");
  await expect(page.locator(`option[aria-label="Boathouse gym, 7:00 to 7:30 pm, ${name} class"]`)).toHaveCount(1);
  await expect(page.locator(`option[aria-label="Boathouse gym, 7:30 to 8:00 pm, ${name} class"]`)).toHaveCount(1);
  await expect(page.locator('option[aria-label=\"Boathouse gym, 6:30 to 7:00 pm, free\"]')).toHaveCount(1);

  // Cancelling the class gives the room back.
  await actAs(page, "Test staff");
  await openClassSession(page, name);
  await page.getByLabel(/Cancel this class/).fill("Test finished");
  await page.getByRole("button", { name: /^Cancel .*Core/ }).click();
  await expect(page.getByTestId("class-cancelled")).toBeVisible();
  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/book?day=2026-10-29&type=Gym%20Space");
  await expect(page.locator('option[aria-label=\"Boathouse gym, 7:00 to 7:30 pm, free\"]')).toHaveCount(1);
});

test("a full class shows its waiting list to staff but only counts to members", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/classes");
  await expect(card(page, "Erg Conditioning").getByTestId("class-schedule")).toContainText(/Thursdays/);
  await expect(card(page, "Erg Conditioning").getByTestId("class-schedule")).toContainText(/4 places/);
  await openClassSession(page, "Erg Conditioning", /Thursday, Oct 29/);
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");
  await expect(page.getByRole("button", { name: "Join the waiting list" })).toBeVisible();

  await actAs(page, "Test staff");
  await openClassSession(page, "Erg Conditioning", /Thursday, Oct 29/);
  const sheet = page.getByTestId("sheet");
  await expect(sheet).toContainText("Erik Lindqvist");
  await expect(sheet.locator('[data-status="waitlisted"]').first()).toContainText("Tomas Vandermeer · waiting, 1st in line");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("the class pages fit the screen", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/club/classes");
    expect(await noSidewaysScroll()).toBe(true);
    await card(page, "Erg Conditioning").getByRole("link", { name: "Erg Conditioning" }).click();
    expect(await noSidewaysScroll()).toBe(true);
    await page.getByTestId("class-session").first().getByTestId("session-signup").click();
    expect(await noSidewaysScroll()).toBe(true);
    await page.goto("/club/my-bookings");
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Test staff");
    await page.goto("/club/classes/manage");
    expect(await noSidewaysScroll()).toBe(true);
  });
});
