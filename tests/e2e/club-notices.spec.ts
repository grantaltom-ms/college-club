import { expect, test, type Browser, type Page } from "@playwright/test";
import { pickSlot } from "./helpers";

/**
 * The emails the club sends when something changes (Nov 5, 2026), in the browser: a spot opened for you, an event cancelled or
 * changed, a boat you booked taken out of service or reported with major damage. Nothing is really emailed in a test build; each
 * email lands on the test outbox page, so the tests read it there the way a person trying the demo would.
 *
 * The emails are sent just after the page that caused them has answered, so every check here polls the outbox until the email is
 * there. Every test makes its own uniquely named event or boat (the tests share one server), and uses invented members only.
 * The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026.
 */

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes,Owner emails";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

async function as(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await actAs(page, who);
  return page;
}

/** The emails on the test outbox for one address with the given words in them. */
const mails = (page: Page, to: string, words: string) => page.getByTestId("outbox-message").filter({ hasText: `To ${to}` }).filter({ hasText: words });

/** Waits (reloading the outbox) until the email is there, and returns it. */
async function mailArrives(staff: Page, to: string, words: string) {
  await expect(async () => {
    await staff.goto("/club/outbox");
    await expect(mails(staff, to, words)).toHaveCount(1, { timeout: 1000 });
  }, `an email to ${to} saying "${words}"`).toPass({ timeout: 20_000 });
  return mails(staff, to, words);
}

/** Looks at the outbox once, after the emails that should be there have arrived, and says there is none to this address with those words. */
async function noMail(staff: Page, to: string, words: string) {
  await staff.goto("/club/outbox");
  await expect(mails(staff, to, words)).toHaveCount(0);
}

async function addEvent(page: Page, e: { title: string; date: string; start: string; end: string; limit?: string; price?: string; place?: string }): Promise<string> {
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

async function uploadBoat(page: Page, name: string) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  const csv = [HEADER, `${name},Shell,1,None,Club,,,,`].join("\r\n") + "\r\n";
  await page.locator("#equip-file").setInputFiles({ name: "boats.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByTestId("equip-check").click();
  await page.getByTestId("equip-add").click();
  await expect(page.getByTestId("equip-done")).toContainText(/Added \d+ items?/);
}

/** The member books the 30-minute slot at the given hour from the dense list and ends on My bookings. */
async function bookBoat(page: Page, boat: string, day: string, hour: number, range: string) {
  await page.goto(`/club/book?day=${day}&what=shell&kind=single&hour=${hour}`);
  await pickSlot(page, boat, range);
  await expect(page.getByRole("heading", { level: 1, name: `Book ${boat}` })).toBeVisible();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

test("a waiting list that moves up, an event that changes and an event that is cancelled each email exactly the people they are about", async ({ page, browser }) => {
  const title = `Notice ${tag()}`;
  const id = await addEvent(page, { title, date: "2026-11-06", start: "18:00", end: "20:00", limit: "1", price: "20" });

  const lars = await as(browser, "Lars Eriksen");
  const britta = await as(browser, "Britta Eriksen");
  for (const p of [lars, britta]) {
    await p.goto(`/club/events/${id}`);
    await p.getByTestId("party-submit").click();
    await expect(p.getByTestId("joined-note")).toBeVisible();
  }
  await expect(britta.getByTestId("your-place")).toHaveText("You are on the waitlist, 1st in line.");
  // Joining a list is the person's own doing: nobody is emailed for it.
  await noMail(page, "britta.eriksen@example.com", title);

  // Lars cancels: Britta moves up with no action of her own, and is told.
  await lars.goto(`/club/events/${id}`);
  await lars.getByRole("button", { name: "Cancel my RSVP" }).click();
  const spot = await mailArrives(page, "britta.eriksen@example.com", `You have a place: ${title}`);
  await expect(spot).toContainText("Hello Britta,");
  await expect(spot).toContainText("Friday, Nov 6, 6:00 to 8:00 pm");
  await expect(spot).toContainText("Cost: $20.00 a place, $20.00 for your party");
  await expect(spot).toContainText("You can cancel at no charge until Wednesday, Nov 4, 6:00 pm.");
  await noMail(page, "lars.eriksen@example.com", `You have a place: ${title}`);

  // Staff move the event a day later: Britta (going) is told what changed, Lars (who left) is not.
  await actAs(page, "Test staff");
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await page.locator("#e-date").fill("2026-11-07");
  await page.locator("#e-start").fill("19:00");
  await page.locator("#e-end").fill("21:00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const changed = await mailArrives(page, "britta.eriksen@example.com", `Event changed: ${title}`);
  await expect(changed).toContainText("Time: now Saturday, Nov 7, 7:00 to 9:00 pm (it was Friday, Nov 6, 6:00 to 8:00 pm)");
  await expect(changed).toContainText("Your place is still held.");
  await expect(changed).not.toContainText("Place:");
  await noMail(page, "lars.eriksen@example.com", `Event changed: ${title}`);

  // A new price alone tells nobody.
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await page.locator("#e-price").fill("25");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Cancelling the event tells everyone who still had a place, with the reason.
  await page.goto(`/club/events/${id}`);
  await page.locator("#why").fill("Venue flooded");
  await page.getByRole("button", { name: /^Cancel .*/ }).filter({ hasText: "Cancel event" }).click();
  await expect(page.getByTestId("event-cancelled")).toBeVisible();
  const cancelled = await mailArrives(page, "britta.eriksen@example.com", `Event cancelled: ${title}`);
  await expect(cancelled).toContainText("Reason: Venue flooded");
  await expect(cancelled).toContainText("You had places for 1 person.");
  await expect(cancelled).toContainText("you will not be billed for them");
  await noMail(page, "lars.eriksen@example.com", `Event cancelled: ${title}`);
  // The price-only change and the moves above left exactly one email of each kind.
  await expect(mails(page, "britta.eriksen@example.com", title)).toHaveCount(3);

  await lars.context().close();
  await britta.context().close();
});

test("a boat taken out of service emails the people with a booking on it, and nobody else", async ({ page, browser }) => {
  const boat = `Notice${tag()}`;
  await uploadBoat(page, boat);
  const declan = await as(browser, "Declan Halloran");
  await bookBoat(declan, boat, "2026-11-10", 6, "6:00 to 6:30 am");

  await actAs(page, "Test staff");
  await page.goto("/club/equipment");
  const row = page.getByTestId("equipment-row").filter({ hasText: boat });
  await row.locator("summary").click();
  await row.getByLabel("Why (members will see this)").fill("Seat repair");
  await row.getByRole("button", { name: `Take ${boat} out of service` }).click();
  await expect(page.getByTestId("affected")).toContainText(`${boat} is now out of service`);
  await expect(page.getByTestId("affected")).toContainText("Each of these members was also emailed");

  const mail = await mailArrives(page, "declan.halloran@example.com", `Boat out of service: ${boat}`);
  await expect(mail).toContainText(`${boat} has been taken out of service.`);
  await expect(mail).toContainText("Reason: Seat repair");
  await expect(mail).toContainText("Tuesday, Nov 10, 6:00 to 7:30 am");
  await expect(mail).toContainText("Please check with club staff before you go.");
  await noMail(page, "britta.eriksen@example.com", boat);
  await declan.context().close();
});

test("a major damage report emails the people with a booking on the boat (not the person who filed it); a minor one emails nobody", async ({ page, browser }) => {
  const boat = `Notice${tag()}`;
  await uploadBoat(page, boat);
  const hollis = await as(browser, "Hollis Whitcombe");
  await bookBoat(hollis, boat, "2026-11-10", 8, "8:00 to 8:30 am");
  const jordan = await as(browser, "Jordan Bellweather");
  await bookBoat(jordan, boat, "2026-11-10", 10, "10:00 to 10:30 am");

  const file = async (what: string, major: boolean) => {
    await jordan.goto("/club/damage");
    await jordan.waitForLoadState("networkidle");
    await jordan.getByLabel("Which boat or space?").selectOption({ label: boat });
    await jordan.getByLabel("What is wrong?").fill(what);
    await jordan.getByLabel("Where on the boat? (optional)").fill("Bow");
    if (major) await jordan.getByLabel("Major: it should not be used until someone has looked at it").check();
    await jordan.getByTestId("damage-submit").click();
    await expect(jordan.getByTestId("action-ok")).toContainText(`Your report on ${boat} is filed.`);
  };

  await file("Seat sticks a little", false);
  await file("Rigger is cracked", true);

  const mail = await mailArrives(page, "hollis.whitcombe@example.com", `Check before you go: ${boat} has damage reported`);
  await expect(mail).toContainText('Major damage reported on Oct 28, 2026: "Rigger is cracked" (Bow). Check with club staff before you use it.');
  await expect(mail).toContainText("Tuesday, Nov 10, 8:00 to 9:30 am");
  await expect(mail).not.toContainText("Jordan");
  // Jordan filed it, so Jordan is not emailed about it; and the minor report emailed nobody.
  await noMail(page, "jordan.bellweather@example.com", `Check before you go: ${boat}`);
  await expect(mails(page, "hollis.whitcombe@example.com", boat)).toHaveCount(1);
  await hollis.context().close();
  await jordan.context().close();
});

test("the test outbox says what it now holds, and the event screen says who is emailed", async ({ page }) => {
  await actAs(page, "Test staff");
  await page.goto("/club/outbox");
  await expect(page.getByTestId("outbox-warning")).toContainText("a spot that opened, an event that was cancelled or changed, and a boat that was taken out of service");
  const id = await addEvent(page, { title: `Words ${tag()}`, date: "2026-11-09", start: "18:00", end: "19:00" });
  await page.goto(`/club/events/${id}`);
  await page.getByText("Edit this event").click();
  await expect(page.getByText("A new time or place emails everyone going or waiting.")).toBeVisible();
  await expect(page.getByText("everyone going or waiting is emailed")).toBeVisible();
});
