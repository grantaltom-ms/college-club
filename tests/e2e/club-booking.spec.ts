import { expect, test, type Page } from "@playwright/test";

/**
 * The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026 (see playwright.config.ts).
 * The invented club has these bookings already: Thu Oct 29 Heron 7 am (Sasha Bellweather), Loon 6 am (Erik Lindqvist
 * with Maren Lindqvist), Dock slip A 7 to 9 am (Walter Pemberton); Fri Oct 30 Osprey 8 am (Tomas Vandermeer);
 * and Merganser is out of service. All tests share one server, so each uses its own member, boat and slot.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

const openDay = (page: Page, day: string, type?: string) => page.goto(`/club/book?day=${day}${type ? `&type=${encodeURIComponent(type)}` : ""}`);

/** The slot link/cell for an item, such as slot(page, "Kingfisher", "9:00 to 9:30 am", "free"). */
const slot = (page: Page, item: string, range: string, state: string) => page.locator(`[aria-label="${item}, ${range}, ${state}"]`);

/** From the day view: click a free slot, optionally change the length, and book it. Ends on My bookings. */
async function book(page: Page, opts: { item: string; day: string; range: string; minutes?: number; type?: string }) {
  await openDay(page, opts.day, opts.type ?? "Shell");
  await slot(page, opts.item, opts.range, "free").click();
  await expect(page.getByRole("heading", { level: 1, name: `Book ${opts.item}` })).toBeVisible();
  if (opts.minutes) {
    await page.getByLabel("Length").selectOption(String(opts.minutes));
    await page.getByRole("button", { name: "Check my choices" }).click();
  }
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${opts.item}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

/** Cancel everything this member still has coming up, so a retried test starts clean. */
async function cancelAll(page: Page) {
  await page.goto("/club/my-bookings");
  const buttons = page.getByRole("button", { name: /^Cancel / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

// Cancelled bookings stay in the Past list as the record, so look in the right list: this server may have run these tests before.
const upcomingRows = (page: Page) => page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("booking-row");
const pastRows = (page: Page) => page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row");
const row = (page: Page, text: string) => upcomingRows(page).filter({ hasText: text });
const pastRow = (page: Page, text: string) => pastRows(page).filter({ hasText: text });

test("core flow: pick a member, find a free single, book it, see it in My bookings, cancel it, and see the slot free again", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await cancelAll(page);

  await openDay(page, "2026-10-31", "Shell");
  await expect(page.getByTestId("day-heading")).toHaveText("Saturday, Oct 31");
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  // Pick Kingfisher's 9:00 am half hour, the free single.
  await slot(page, "Kingfisher", "9:00 to 9:30 am", "free").click();
  await expect(page.getByRole("heading", { level: 1, name: "Book Kingfisher" })).toBeVisible();
  await expect(page.getByTestId("booking-when")).toContainText("Saturday, Oct 31, 9:00 to 10:30 am");
  await expect(page.getByTestId("check-ok")).toHaveText("This booking meets the rules.");
  // The rules that apply are shown, with the placeholder warning.
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("Rules for Kingfisher (single)");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("These numbers are placeholders");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("The shortest booking is 30 minutes and the longest is 4 hours.");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("Book up to 14 days ahead.");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("There is no limit on how many shell bookings you can hold or make in a day.");
  await page.getByRole("button", { name: "Book Kingfisher", exact: true }).click();

  // My bookings shows it.
  await expect(page).toHaveURL(/\/club\/my-bookings\?booked=/);
  await expect(page.getByTestId("booked-note")).toHaveText("Booked: Kingfisher, Saturday, Oct 31, 9:00 to 10:30 am.");
  await expect(row(page, "Kingfisher")).toContainText("Saturday, Oct 31, 9:00 to 10:30 am");
  await expect(row(page, "Kingfisher").getByTestId("booking-status")).toHaveText("Upcoming");

  // In the day view the member's own slots read "yours"; anyone else sees "booked".
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "yours")).toBeVisible();
  await expect(slot(page, "Kingfisher", "9:30 to 10:00 am", "yours")).toBeVisible();
  await expect(slot(page, "Kingfisher", "10:00 to 10:30 am", "yours")).toBeVisible();
  await expect(slot(page, "Kingfisher", "10:30 to 11:00 am", "free")).toBeVisible();
  await actAs(page, "Tomas Vandermeer");
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "booked")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Abernathy");

  // Cancel it, and the slot is free again for everyone.
  await actAs(page, "Nora Abernathy");
  await page.goto("/club/my-bookings");
  await row(page, "Kingfisher").getByRole("button", { name: /^Cancel Kingfisher/ }).click();
  await expect(page.getByTestId("cancelled-note")).toHaveText("Cancelled Kingfisher. The time is free for others again.");
  await expect(page.getByTestId("no-upcoming")).toBeVisible();
  await expect(pastRow(page, "Kingfisher").first().getByTestId("booking-status")).toHaveText("Cancelled");
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "free")).toBeVisible();
  await actAs(page, "Tomas Vandermeer");
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "free")).toBeVisible();
});

test("second flow: book a double with a qualified crewmate, who then sees it as theirs", async ({ page }) => {
  await actAs(page, "Hollis Whitcombe");
  await cancelAll(page);

  await openDay(page, "2026-10-31", "Shell");
  await slot(page, "Pelican", "7:00 to 7:30 am", "free").click();
  await expect(page.getByRole("heading", { level: 1, name: "Book Pelican" })).toBeVisible();
  // Only members who hold the qualification a double needs can be chosen as crew.
  const crew = page.getByRole("group", { name: /Crew/ });
  await expect(crew).toContainText("up to 1 other");
  await expect(crew.getByLabel("Maren Lindqvist")).toBeVisible();
  await expect(crew.getByLabel("Ines Castellanos")).toHaveCount(0); // holds no qualification
  await expect(crew.getByLabel("Hollis Whitcombe")).toHaveCount(0); // the booker is already aboard
  await crew.getByLabel("Maren Lindqvist").check();
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: "Book Pelican", exact: true }).click();
  await expect(row(page, "Pelican")).toContainText("crew: Maren Lindqvist");

  // Maren sees it as hers, without a cancel button; she cannot be put in another boat at the same time.
  await actAs(page, "Maren Lindqvist");
  await page.goto("/club/my-bookings");
  await expect(row(page, "Pelican")).toContainText("you are crew");
  await expect(row(page, "Pelican")).toContainText("booked by Hollis Whitcombe");
  await expect(row(page, "Pelican").getByRole("button")).toHaveCount(0);
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Pelican", "7:00 to 7:30 am", "yours")).toBeVisible();
  await slot(page, "Osprey", "7:00 to 7:30 am", "free").click();
  await expect(page.getByTestId("refusal-reasons")).toContainText("You are already on another boat from 7:00 to 8:30 am.");
  await expect(page.getByRole("button", { name: "Book Osprey" })).toHaveCount(0);

  // Hollis cancels, which frees Maren too.
  await actAs(page, "Hollis Whitcombe");
  await cancelAll(page);
  await actAs(page, "Maren Lindqvist");
  await openDay(page, "2026-10-31", "Shell");
  await expect(slot(page, "Pelican", "7:00 to 7:30 am", "free")).toBeVisible();
});

test("a crew member who is not qualified cannot slip in through the address bar", async ({ page }) => {
  await actAs(page, "Kenji Tanaka");
  await openDay(page, "2026-10-30", "Shell");
  const href = await slot(page, "Tern", "6:00 to 6:30 am", "free").getAttribute("href");
  await page.goto(`${href}&crew=${await crewId(page, "Ines Castellanos")}`);
  await expect(page.getByTestId("refusal-reasons")).toContainText("Ines Castellanos needs Sculling level 2 (placeholder) to crew Tern.");
  await expect(page.getByRole("button", { name: "Book Tern" })).toHaveCount(0);
});

/** A member's ID, read from the staff list of households' picker page. */
async function crewId(page: Page, name: string): Promise<string> {
  const value = await page.goto("/club/act-as").then(() => page.getByRole("button", { name: `Act as ${name}`, exact: true }).getAttribute("value"));
  return value!.replace("member:", "");
}

test("a refusal is always explained in plain words and never offers a Book button", async ({ page }) => {
  await actAs(page, "Ines Castellanos"); // holds no qualification
  await openDay(page, "2026-10-30", "Shell");
  await expect(page.getByText("You do not hold that qualification yet").first()).toBeVisible();
  const href = (await slot(page, "Heron", "9:00 to 9:30 am", "free").getAttribute("href"))!;
  await page.goto(href);
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["You need Sculling level 1 (placeholder) to use Heron."]);
  await expect(page.getByRole("button", { name: "Book Heron" })).toHaveCount(0);

  // Straight to the form for a slot that is already taken, and one beyond the booking window.
  const itemId = new URL(href, "http://x").searchParams.get("item")!;
  await actAs(page, "Nora Abernathy");
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-29T14:00:00.000Z`); // Heron, Thu 7 am: Sasha has it
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["Heron is already booked from 7:00 to 8:00 am."]);
  await page.goto(`/club/book/new?item=${itemId}&start=2026-11-12T13:00:00.000Z`); // Thu Nov 12, 5 am: one day too far
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["You can book up to 14 days ahead. Thursday, Nov 12 opens Thursday, Oct 29 at midnight."]);
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-28T19:00:00.000Z`); // 12 noon today: already started
  await expect(page.getByTestId("refusal-reasons")).toContainText("That time has already started. Choose a later time.");
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-30T11:00:00.000Z`); // 4 am Fri: before the club opens
  await expect(page.getByTestId("refusal-reasons")).toContainText("Heron can be booked from 5:00 am to 8:00 pm.");
});

test("a booking that goes stale between the form and the button is refused by the server, with the same explanation", async ({ page }) => {
  await actAs(page, "Walter Pemberton");
  await openDay(page, "2026-10-30", "Shell");
  const href = (await slot(page, "Grebe", "6:00 to 6:30 am", "free").getAttribute("href"))!;
  const itemId = new URL(href, "http://x").searchParams.get("item")!;
  // Someone else takes Grebe at 6 while Walter's form is open.
  await actAs(page, "Lars Eriksen");
  await cancelAll(page);
  await book(page, { item: "Grebe", day: "2026-10-30", range: "6:00 to 6:30 am" });
  // Walter presses Book on the stale form.
  await actAs(page, "Walter Pemberton");
  const res = await page.request.post("/api/club/bookings", { form: { item: itemId, start: "2026-10-30T13:00:00.000Z", minutes: "60" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  await page.goto(res.headers()["location"]);
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Grebe is already booked from 6:00 to 7:30 am.");
  await actAs(page, "Lars Eriksen");
  await cancelAll(page);
});

test("book, cancel and rebook again and again: nothing limits how many a member holds, and the slots always count right", async ({ page }) => {
  await actAs(page, "Jordan Bellweather");
  await cancelAll(page);
  const pastBefore = await pastRows(page).count();
  const mine = (boat: string, from: string) => upcomingRows(page).filter({ hasText: boat }).filter({ hasText: from });

  for (let round = 1; round <= 3; round++) {
    // The club's own numbers put no limit on how many bookings one member holds or makes in a day: four shell bookings, two on one day.
    await book(page, { item: "Osprey", day: "2026-10-31", range: "6:00 to 6:30 am" });
    await book(page, { item: "Kingfisher", day: "2026-11-01", range: "6:00 to 6:30 am" });
    await book(page, { item: "Heron", day: "2026-11-02", range: "6:00 to 6:30 am" });
    await book(page, { item: "Osprey", day: "2026-10-31", range: "9:00 to 9:30 am" });
    await expect(upcomingRows(page)).toHaveCount(4);
    // Every booking cancelled in the rounds before is still on record, in the Past list.
    await expect(pastRows(page)).toHaveCount(pastBefore + (round - 1) * 4);

    // Cancel one: the slot comes straight back, and the others stay.
    await page.goto("/club/my-bookings");
    await mine("Osprey", "6:00").getByRole("button", { name: /^Cancel Osprey/ }).click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
    await expect(upcomingRows(page)).toHaveCount(3);
    await openDay(page, "2026-10-31", "Shell");
    await expect(slot(page, "Osprey", "6:00 to 6:30 am", "free")).toBeVisible();
    await expect(slot(page, "Osprey", "9:00 to 9:30 am", "yours")).toBeVisible();
    await cancelAll(page);
  }
  await page.goto("/club/my-bookings");
  await expect(page.getByTestId("no-upcoming")).toBeVisible();
});

test("the clocks go back on Sunday Nov 1: that day has the same thirty half hours, none missing or doubled", async ({ page }) => {
  await actAs(page, "Sasha Bellweather");
  for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
    await openDay(page, day, "Shell");
    const heron = page.locator('[data-testid="item-card"][data-item="Heron"] .slots li');
    await expect(heron, day).toHaveCount(30);
    await expect(heron.first().locator("[aria-label]"), day).toHaveAttribute("aria-label", /^Heron, 5:00 to 5:30 am, /);
    await expect(heron.last().locator("[aria-label]"), day).toHaveAttribute("aria-label", "Heron, 7:30 to 8:00 pm, free");
    const labels = await heron.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(new Set(labels).size, `${day} labels are all different`).toBe(30);
  }
  // Booking on the day itself works, and shows the right time.
  await cancelAllFor(page);
  await book(page, { item: "Heron", day: "2026-11-01", range: "5:00 to 5:30 am", minutes: 120 });
  await expect(page.getByTestId("booked-note")).toHaveText("Booked: Heron, Sunday, Nov 1, 5:00 to 7:00 am.");
  await openDay(page, "2026-11-01", "Shell");
  for (const r of ["5:00 to 5:30 am", "5:30 to 6:00 am", "6:00 to 6:30 am", "6:30 to 7:00 am"]) await expect(slot(page, "Heron", r, "yours")).toBeVisible();
  await expect(slot(page, "Heron", "7:00 to 7:30 am", "free")).toBeVisible();
  await cancelAllFor(page);
});

/** Cancel only what this test made (Sasha also holds one sample booking, which stays). */
async function cancelAllFor(page: Page) {
  await page.goto("/club/my-bookings");
  const mine = page.getByRole("button", { name: /^Cancel Heron, 5:00/ });
  while ((await mine.count()) > 0) {
    await mine.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

test("members see only 'booked'; staff see who booked", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await openDay(page, "2026-10-29", "Shell");
  await expect(slot(page, "Heron", "7:00 to 7:30 am", "booked")).toContainText("Booked");
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");

  await actAs(page, "Test staff");
  await openDay(page, "2026-10-29", "Shell");
  await expect(slot(page, "Heron", "7:00 to 7:30 am", "booked")).toContainText("Sasha Bellweather");
  await expect(slot(page, "Loon", "6:00 to 6:30 am", "booked")).toContainText("Erik Lindqvist");
});

test("staff take a boat out of service: new bookings stop, existing ones stay, and the members affected are listed", async ({ page }) => {
  // Keep Cormorant's booking address from before it goes out of service, to try it afterwards.
  await actAs(page, "Nora Abernathy");
  await openDay(page, "2026-11-03", "Shell");
  const cormorantHref = (await slot(page, "Cormorant", "8:00 to 8:30 am", "free").getAttribute("href"))!;
  await actAs(page, "Tomas Vandermeer");
  await book(page, { item: "Cormorant", day: "2026-11-02", range: "8:00 to 8:30 am", minutes: 60 });

  await actAs(page, "Test staff");
  await page.goto("/club/equipment");
  // Merganser is already out in the invented club.
  await expect(page.getByTestId("equipment-row").filter({ hasText: "Merganser" }).getByTestId("equipment-status")).toContainText("Out of service: Rigger being repaired, expected back Nov 2, 2026");
  const cormorant = page.getByTestId("equipment-row").filter({ hasText: "Cormorant" });
  await expect(cormorant.getByTestId("equipment-status")).toHaveText("In service");
  await cormorant.locator("summary").click();
  await cormorant.getByLabel("Why (members will see this)").fill("Seat repair");
  await cormorant.getByRole("button", { name: "Take Cormorant out of service" }).click();

  await expect(page.getByTestId("affected")).toContainText("Cormorant is now out of service");
  await expect(page.getByTestId("affected-booking")).toHaveCount(1);
  await expect(page.getByTestId("affected-booking")).toContainText("Monday, Nov 2, 8:00 to 9:00 am");
  await expect(page.getByTestId("affected-booking")).toContainText("Tomas Vandermeer (booker, tomas.vandermeer@example.com");
  await expect(page.getByText("Nothing was cancelled")).toBeVisible();

  // The affected member's booking is untouched.
  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/my-bookings");
  await expect(row(page, "Cormorant").getByTestId("booking-status")).toHaveText("Upcoming");
  // Everyone else is stopped, and told why.
  await actAs(page, "Nora Abernathy");
  await openDay(page, "2026-11-03", "Shell");
  await expect(slot(page, "Cormorant", "8:00 to 8:30 am", "out of service")).toBeVisible();
  await page.goto(cormorantHref);
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Cormorant is out of service (Seat repair).");
  await expect(page.getByRole("button", { name: "Book Cormorant" })).toHaveCount(0);

  // Staff bring it back and new bookings work again.
  await actAs(page, "Test staff");
  await page.goto("/club/equipment");
  await page.getByRole("button", { name: "Return Cormorant to service" }).click();
  await expect(page.getByText("Back in service. New bookings are allowed again.")).toBeVisible();
  await actAs(page, "Nora Abernathy");
  await openDay(page, "2026-11-03", "Shell");
  await expect(slot(page, "Cormorant", "8:00 to 8:30 am", "free")).toBeVisible();

  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/my-bookings");
  await row(page, "Cormorant").getByRole("button", { name: /^Cancel Cormorant/ }).click();
});

test("staff can book past the rules with a reason, and the record says so", async ({ page }) => {
  await actAs(page, "Test staff");
  // Start clean if an earlier attempt left its booking behind.
  await page.goto("/club/my-bookings");
  const leftover = row(page, "Ines Castellanos").getByRole("button", { name: /^Cancel Heron/ });
  while ((await leftover.count()) > 0) {
    await leftover.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
  await openDay(page, "2026-11-04", "Shell");
  await slot(page, "Heron", "5:00 to 5:30 am", "free").click();
  await expect(page.getByTestId("check")).toContainText("Choose who this booking is for");
  await page.getByLabel("Booking for").selectOption({ label: "Ines Castellanos (The Castellanos household)" });
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Ines Castellanos needs Sculling level 1 (placeholder) to use Heron.");

  // Setting the rules aside needs a reason.
  await page.getByLabel("Book past the club rules").check();
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByText("Say why the rules are being set aside")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book Heron" })).toHaveCount(0);

  await page.getByLabel("Why (kept in the record)").fill("Learn-to-row lesson with the coach");
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("waived-rules")).toContainText("Ines Castellanos needs Sculling level 1 (placeholder) to use Heron.");
  await expect(page.getByTestId("check-ok")).toHaveText("This can be booked as a staff override.");
  await page.getByRole("button", { name: "Book Heron", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "All bookings" })).toBeVisible();
  const lesson = row(page, "Heron").filter({ hasText: "Ines Castellanos" });
  await expect(lesson).toHaveCount(1);
  await expect(lesson).toContainText("staff override: Learn-to-row lesson with the coach");
  await expect(lesson).toContainText("Wednesday, Nov 4, 5:00 to 6:30 am");

  // A staff override never beats a fact: nobody else can take the same slot, override or not.
  await openDay(page, "2026-11-04", "Shell");
  await expect(slot(page, "Heron", "5:00 to 5:30 am", "booked")).toContainText("Ines Castellanos");
  await actAs(page, "Test staff");
  await page.goto("/club/my-bookings");
  await row(page, "Ines Castellanos").getByRole("button", { name: /^Cancel Heron/ }).click();
  await expect(page.getByTestId("cancelled-note")).toContainText("Cancelled Heron");
});

test("a member whose household has ended is told so and cannot book", async ({ page }) => {
  await actAs(page, "Colm Fitzgerald");
  await openDay(page, "2026-10-30", "Shell");
  await expect(page.getByTestId("blocked-note")).toContainText("This household's membership ended on Oct 7, 2026, so new bookings are closed.");
  await slot(page, "Osprey", "11:00 to 11:30 am", "free").click();
  await expect(page.getByTestId("refusal-reasons")).toHaveText("This household's membership ended on Oct 7, 2026, so new bookings are closed.");
  await expect(page.getByRole("button", { name: "Book Osprey" })).toHaveCount(0);
});

test("only staff can see the equipment page", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  const res = await page.goto("/club/equipment");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Equipment" })).toHaveCount(0);
  await actAs(page, "Test staff");
  await expect(page.getByRole("link", { name: "Equipment" })).toBeVisible();
});

test("not signed in as anyone, the booking pages point to the picker", async ({ page }) => {
  for (const path of ["/club/book", "/club/my-bookings", "/club/equipment"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Choose a test member" })).toBeVisible();
  }
  const res = await page.request.post("/api/club/bookings", { form: { item: "x" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toContain("/club/act-as");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("the day view, the booking form and My bookings fit without sideways scrolling, with tappable slots", async ({ page }) => {
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await actAs(page, "Hollis Whitcombe");
    await openDay(page, "2026-10-30");
    expect(await fits()).toBe(true);
    const box = await slot(page, "Heron", "9:00 to 9:30 am", "free").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThan(60);
    await slot(page, "Pelican", "9:00 to 9:30 am", "free").click();
    expect(await fits()).toBe(true);
    await page.goto("/club/my-bookings");
    expect(await fits()).toBe(true);
    await actAs(page, "Test staff");
    await page.goto("/club/equipment");
    expect(await fits()).toBe(true);
    await openDay(page, "2026-10-30");
    expect(await fits()).toBe(true);
  });
});
