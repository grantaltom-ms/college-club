import { expect, test, type Page } from "@playwright/test";

/**
 * Fitness classes in the browser. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026.
 * The invented club has these classes already: Erg Conditioning on Thu Oct 29 at 5:00 pm in the Boathouse gym, 4 chairs,
 * full, with Tomas Vandermeer and Nora Abernathy waiting; Morning Yoga on Fri Oct 30 at 7:00 am (2 people in); Stretch &
 * Mobility on Fri Oct 30 at 12:00 pm, nobody in yet. All tests share one server, so the ones that change things make
 * their own class, use their own members, and cancel their class at the end so a retried run starts clean.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const card = (page: Page, name: string) => page.getByTestId("class-card").filter({ hasText: name });
const upcomingRows = (page: Page) => page.getByRole("list", { name: "Upcoming classes" }).getByTestId("class-row");

/** Leave everything this member still has coming up, so a retried test starts clean. */
async function leaveAll(page: Page) {
  await page.goto("/club/my-classes");
  const buttons = page.getByRole("button", { name: /^Leave / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("left-note")).toBeVisible();
  }
}

test("core flow: pick a member, find a class, sign up, see it in My classes, leave, and see the chair free again", async ({ page }) => {
  await actAs(page, "Rafael Castellanos");
  await leaveAll(page);

  await page.goto("/club/classes?day=2026-10-30");
  await expect(page.getByTestId("day-heading")).toHaveText("Friday, Oct 30");
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  await expect(card(page, "Stretch & Mobility").getByTestId("class-chairs")).toHaveText("10 chairs left");
  await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Stretch & Mobility" })).toBeVisible();
  await expect(page.getByTestId("class-when")).toContainText("Friday, Oct 30, 12:00 to 12:30 pm");
  await expect(page.getByRole("heading", { name: "Rules for Stretch & Mobility" })).toBeVisible();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByTestId("joined-note")).toHaveText("You are in. You have a chair.");

  await page.goto("/club/my-classes");
  const row = upcomingRows(page).filter({ hasText: "Stretch & Mobility" });
  await expect(row).toContainText("Friday, Oct 30, 12:00 to 12:30 pm");
  await expect(row.getByTestId("class-status")).toHaveText("You have a chair");

  // Anyone else sees one fewer chair, and not the name.
  await actAs(page, "Walter Pemberton");
  await page.goto("/club/classes?day=2026-10-30");
  await expect(card(page, "Stretch & Mobility").getByTestId("class-chairs")).toHaveText("9 chairs left");
  await page.goto(await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).getAttribute("href").then((h) => h!));
  await expect(page.locator("body")).not.toContainText("Castellanos");

  await actAs(page, "Rafael Castellanos");
  await page.goto("/club/my-classes");
  await upcomingRows(page).filter({ hasText: "Stretch & Mobility" }).getByRole("button", { name: /^Leave / }).click();
  await expect(page.getByTestId("left-note")).toContainText("Your place is free for others.");
  await expect(page.getByTestId("no-upcoming-classes")).toBeVisible();
  await page.goto("/club/classes?day=2026-10-30");
  await expect(card(page, "Stretch & Mobility").getByTestId("class-chairs")).toHaveText("10 chairs left");
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
    await p.goto("/club/classes?day=2026-11-03");
    await card(p, name).getByRole("link", { name }).click();
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
  await expect(lars.getByTestId("joined-note")).toHaveText("You are in. You have a chair.");

  const britta = await as("Britta Eriksen");
  await open(britta);
  await expect(britta.getByTestId("class-chairs")).toContainText("Full");
  await britta.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(britta.getByTestId("joined-note")).toContainText("On the waiting list, 1st in line.");

  const declan = await as("Declan Halloran");
  await open(declan);
  await declan.getByRole("button", { name: "Join the waiting list" }).click();
  await expect(declan.getByTestId("joined-note")).toContainText("On the waiting list, 2nd in line.");
  await declan.goto("/club/my-classes");
  await expect(upcomingRows(declan).filter({ hasText: name }).getByTestId("class-status")).toHaveText("On the waiting list");
  await expect(upcomingRows(declan).filter({ hasText: name })).toContainText("2nd in line");

  // Lars leaves; Britta now has the chair, with no action of her own, and Declan is first in line.
  await lars.goto("/club/my-classes");
  await upcomingRows(lars).filter({ hasText: name }).getByRole("button", { name: /^Leave / }).click();
  await expect(lars.getByTestId("left-note")).toBeVisible();
  await britta.goto("/club/my-classes");
  await expect(upcomingRows(britta).filter({ hasText: name }).getByTestId("class-status")).toHaveText("You have a chair");
  await expect(upcomingRows(britta).filter({ hasText: name })).toContainText("moved up from the waiting list");
  await declan.goto("/club/my-classes");
  await expect(upcomingRows(declan).filter({ hasText: name })).toContainText("1st in line");

  // Staff see all the names, and cancelling the class takes everyone off and lists who to contact.
  await page.goto("/club/classes?day=2026-11-03");
  await card(page, name).getByRole("link", { name }).click();
  await expect(page.getByTestId("sheet")).toContainText("Britta Eriksen");
  await expect(page.getByTestId("sheet")).toContainText("Declan Halloran");
  await page.getByLabel("Cancel this class (members will see the reason)").fill("Instructor is ill");
  await page.getByRole("button", { name: /^Cancel .*Drill/ }).click();
  await expect(page.getByTestId("class-cancelled")).toContainText("Instructor is ill");
  await expect(page.getByTestId("affected")).toContainText("Britta Eriksen");
  await expect(page.getByTestId("affected")).toContainText("Declan Halloran");
  await britta.goto("/club/my-classes");
  await expect(britta.getByRole("list", { name: "Past classes" }).getByTestId("class-row").filter({ hasText: name })).toContainText("Class cancelled");
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

  // A single booked over the Stretch class hour.
  await page.goto("/club/book?day=2026-10-30&type=Shell");
  await page.locator('[aria-label="Heron, 12:00 to 12:30 pm, free"]').click();
  await page.getByRole("button", { name: "Book Heron", exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();

  await page.goto("/club/classes?day=2026-10-30");
  await card(page, "Stretch & Mobility").getByRole("link", { name: "Stretch & Mobility" }).click();
  await expect(page).toHaveURL(/\/club\/classes\/[0-9a-f-]{36}$/);
  const classPage = page.url();
  await expect(page.getByTestId("refusal")).toContainText("You have Heron booked from 12:00 to 1:30 pm.");
  await expect(page.getByRole("button", { name: "Sign up", exact: true })).toHaveCount(0);

  // Without the boat, the class is open; once in it, the same hour is closed for boats.
  await cancelBoats();
  await page.goto(classPage);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByTestId("joined-note")).toBeVisible();
  await page.goto("/club/book?day=2026-10-30&type=Shell");
  await page.locator('[aria-label="Heron, 12:00 to 12:30 pm, free"]').click();
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
  await expect(page.locator(`[aria-label="Boathouse gym, 7:00 to 7:30 pm, ${name} class"]`)).toBeVisible();
  await expect(page.locator(`[aria-label="Boathouse gym, 7:30 to 8:00 pm, ${name} class"]`)).toBeVisible();
  await expect(page.locator('[aria-label="Boathouse gym, 6:30 to 7:00 pm, free"]')).toBeVisible();

  // Cancelling the class gives the room back.
  await actAs(page, "Test staff");
  await page.goto("/club/classes?day=2026-10-29");
  await card(page, name).getByRole("link", { name }).click();
  await page.getByLabel("Cancel this class (members will see the reason)").fill("Test finished");
  await page.getByRole("button", { name: /^Cancel .*Core/ }).click();
  await expect(page.getByTestId("class-cancelled")).toBeVisible();
  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/book?day=2026-10-29&type=Gym%20Space");
  await expect(page.locator('[aria-label="Boathouse gym, 7:00 to 7:30 pm, free"]')).toBeVisible();
});

test("a full class shows its waiting list to staff but only counts to members", async ({ page }) => {
  await actAs(page, "Declan Halloran");
  await page.goto("/club/classes?day=2026-10-29");
  await expect(card(page, "Erg Conditioning").getByTestId("class-chairs")).toHaveText("Full, 2 waiting");
  await card(page, "Erg Conditioning").getByRole("link", { name: "Erg Conditioning" }).click();
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");
  await expect(page.getByRole("button", { name: "Join the waiting list" })).toBeVisible();

  await actAs(page, "Test staff");
  await page.goto("/club/classes?day=2026-10-29");
  await card(page, "Erg Conditioning").getByRole("link", { name: "Erg Conditioning" }).click();
  const sheet = page.getByTestId("sheet");
  await expect(sheet).toContainText("Erik Lindqvist");
  await expect(sheet.locator('[data-status="waitlisted"]').first()).toContainText("Tomas Vandermeer · waiting, 1st in line");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("the class pages fit the screen", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/club/classes?day=2026-10-29");
    expect(await noSidewaysScroll()).toBe(true);
    await card(page, "Erg Conditioning").getByRole("link", { name: "Erg Conditioning" }).click();
    expect(await noSidewaysScroll()).toBe(true);
    await page.goto("/club/my-classes");
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Test staff");
    await page.goto("/club/classes/manage");
    expect(await noSidewaysScroll()).toBe(true);
  });
});
