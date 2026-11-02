import { expect, test, type Page } from "@playwright/test";

/**
 * Practices and lineups: staff mark a member as a coach; a coach (or staff) sets up a practice that reserves boats and seats people by
 * name; rowers see their boat, seat and side on screen; the boat shows as "Practice" and cannot be booked while it runs; a booking made
 * before the practice is flagged, never cancelled; and the same person cannot be in two places. Every test uploads its own uniquely
 * named boat through the equipment upload (the tests share one server and a practice is never removed), uses its own day, and uses only
 * invented members. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026. Kenji Tanaka is the sample club's
 * coach and runs the sample practice; Rafael Castellanos is only ever marked as a coach and unmarked in one test; Dev Rao is never a coach.
 */

const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes,Owner emails";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Staff load club singles that anyone may book (no skill level), through the upload, as a real staff member would. */
async function uploadBoats(page: Page, ...names: string[]) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  const csv = [HEADER, ...names.map((n) => `${n},Shell,1,None,Club,,,,`)].join("\r\n") + "\r\n";
  await page.locator("#equip-file").setInputFiles({ name: "boats.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByTestId("equip-check").click();
  await page.getByTestId("equip-add").click();
  await expect(page.getByTestId("equip-done")).toContainText(/Added \d+ items?/);
}

/** Waits for the page's scripts to have started, so a button pressed next is handled by the page and not sent as a plain form. */
const settled = (page: Page) => page.waitForLoadState("networkidle");

const slot = (page: Page, item: string, range: string, state: string) => page.locator(`[aria-label="${item}, ${range}, ${state}"]`);

/** Fills in the set-up form as a person would and ends on the new practice's page. */
async function setUp(page: Page, o: { name: string; day: string; start: string; end: string; boats: string[]; notes?: string; coach?: string }) {
  await page.goto("/club/practices/new");
  await settled(page);
  await page.getByLabel("Name", { exact: true }).fill(o.name);
  await page.getByLabel("Day", { exact: true }).fill(o.day);
  await page.getByLabel("Starts", { exact: true }).fill(o.start);
  await page.getByLabel("Ends", { exact: true }).fill(o.end);
  if (o.coach) await page.getByLabel("Run by", { exact: true }).selectOption({ label: `${o.coach} (coach)` });
  if (o.notes) await page.getByLabel("Note for the crew (optional)").fill(o.notes);
  for (const boat of o.boats) await page.getByTestId("practice-boats").getByLabel(boat).check();
  await page.getByTestId("practice-submit").click();
  await expect(page.getByTestId("practice-made")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: o.name })).toBeVisible();
}

/** Finds a member by name on the practice page and seats them in the first empty seat, on the chosen side. */
async function seat(page: Page, name: string, side: "port" | "starboard" | "" = "") {
  await page.getByLabel("Find a member by name (at least three letters)").fill(name);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const choice = page.locator(`[data-testid="rower-choice"][data-name="${name}"]`);
  await expect(choice).toBeVisible();
  await settled(page);
  await choice.getByLabel("Side").selectOption(side);
  await choice.getByRole("button", { name: `Seat ${name}`, exact: true }).click();
  // Once seated the person is no longer offered, and the note on their card goes with the card, so wait for where they end up.
  await expect(choice).toHaveCount(0);
}

/** The member books the free slot at the given time from the day view, as a person would, and ends on My bookings. */
async function book(page: Page, boat: string, day: string, range: string) {
  await page.goto(`/club/book?day=${day}&type=Shell`);
  await slot(page, boat, range, "free").click();
  await expect(page.getByRole("heading", { level: 1, name: `Book ${boat}` })).toBeVisible();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

const seatRow = (page: Page, boat: string, n: number) => page.locator(`[data-testid="practice-boat"][data-boat="${boat}"] [data-testid="seat-row"][data-seat="${n}"]`);

test.describe("coaches", () => {
  test("staff mark an adult as a coach on the household page and the file says so; that member then sees Practices, an ordinary member does not, and unmarking takes it away", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByRole("link", { name: /Castellanos/ }).first().click();
    const adult = page.locator('[data-testid="desk-adult"]', { hasText: "Rafael Castellanos" });
    await expect(adult.getByTestId("coach-status")).toHaveText("Not a coach.");
    await settled(page);
    await adult.getByRole("button", { name: "Mark Rafael Castellanos as a coach" }).click();
    await expect(adult.getByTestId("action-ok")).toContainText("Marked as a coach.");
    await expect(adult.getByTestId("coach-status")).toHaveText("A coach: can set up practices and seat crews.");
    await expect(page.getByText("Rafael Castellanos was marked as a coach by Test staff.")).toBeVisible();

    await actAs(page, "Rafael Castellanos");
    await expect(page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Practices", exact: true })).toBeVisible();
    expect((await page.goto("/club/practices"))?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    expect((await page.goto("/club/practices/new"))?.status()).toBe(200);
    // A coach is not staff: nothing else in the staff office opens.
    expect((await page.goto("/club/admin"))?.status()).toBe(404);

    await actAs(page, "Dev Rao");
    await expect(page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Practices", exact: true })).toHaveCount(0);
    expect((await page.goto("/club/practices"))?.status()).toBe(404);
    expect((await page.goto("/club/practices/new"))?.status()).toBe(404);

    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByRole("link", { name: /Castellanos/ }).first().click();
    await settled(page);
    await adult.getByRole("button", { name: "Take the coach mark off Rafael Castellanos" }).click();
    await expect(adult.getByTestId("action-ok")).toContainText("No longer marked as a coach.");
    await expect(adult.getByTestId("coach-status")).toHaveText("Not a coach.");
    await actAs(page, "Rafael Castellanos");
    expect((await page.goto("/club/practices"))?.status()).toBe(404);
  });
});

test.describe("setting a practice up and seating people", () => {
  test("a coach sets one up, reserves a boat, seats a rower by name; the rower sees their seat; the boat is a 'Practice' slot nobody can book", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const name = `Technique ${tag()}`;
    await uploadBoats(page, boat);

    await actAs(page, "Kenji Tanaka");
    await setUp(page, { name, day: "2026-11-04", start: "07:00", end: "09:00", boats: [boat], notes: "Drills first.\nThen two pieces." });
    await expect(page.getByTestId("practice-when")).toHaveText("Wednesday, Nov 4, 7:00 to 9:00 am");
    await expect(page.getByText("Run by Kenji Tanaka")).toBeVisible();
    await expect(page.getByTestId("practice-notes")).toContainText("Drills first.");
    await expect(seatRow(page, boat, 1)).toContainText("empty");

    await seat(page, "Dev Rao", "starboard");
    await expect(seatRow(page, boat, 1)).toContainText("Dev Rao");
    await expect(seatRow(page, boat, 1)).toContainText("starboard");
    const practiceUrl = page.url().replace(/\?.*$/, "");

    // The rower: My practices, My bookings, and the practice page showing only their own boat.
    await actAs(page, "Dev Rao");
    await page.goto("/club/my-practices");
    const mine = page.locator(`[data-testid="my-practice"][data-practice="${name}"]`);
    await expect(mine.getByTestId("my-seat")).toHaveText(`${boat}, seat 1 · starboard`);
    await expect(mine).toContainText("Wednesday, Nov 4, 7:00 to 9:00 am");
    await expect(mine).toContainText("Run by Kenji Tanaka");
    await page.goto("/club/my-bookings");
    await expect(page.locator(`[data-testid="booking-practice"]`, { hasText: name })).toContainText(`${boat}, seat 1 (starboard)`);
    await page.goto(practiceUrl);
    await expect(page.getByTestId("my-place")).toHaveText(`Your place: ${boat}, seat 1 (starboard).`);
    await expect(page.getByTestId("practice-boat")).toHaveCount(1);
    await expect(page.getByLabel("Find a member by name (at least three letters)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Take out|Cancel the practice|Seat/ })).toHaveCount(0);

    // Somebody who is not in the practice cannot open it.
    await actAs(page, "Walter Pemberton");
    expect((await page.goto(practiceUrl))?.status()).toBe(404);

    // The boat is a "Practice" slot while it runs, free before and after, and the legend says what the colour means.
    await page.goto("/club/book?day=2026-11-04&type=Shell");
    await expect(page.getByRole("list", { name: "Legend" })).toContainText("Practice");
    await expect(slot(page, boat, "7:00 to 7:30 am", "practice")).toBeVisible();
    await expect(slot(page, boat, "8:30 to 9:00 am", "practice")).toBeVisible();
    await expect(slot(page, boat, "6:30 to 7:00 am", "free")).toBeVisible();
    await expect(slot(page, boat, "9:00 to 9:30 am", "free")).toBeVisible();
  });

  test("seating someone who is booked on another boat, or in a class, then is refused in the engine's own words; a person cannot be in two seats", async ({ page }) => {
    const reserved = `Skiff${tag()}`;
    const theirs = `Skiff${tag()}`;
    await uploadBoats(page, reserved, theirs);

    await actAs(page, "Camille Moreau");
    await book(page, theirs, "2026-11-09", "8:00 to 8:30 am");

    await actAs(page, "Kenji Tanaka");
    await setUp(page, { name: `Refusals ${tag()}`, day: "2026-11-09", start: "07:00", end: "09:00", boats: [reserved] });
    await page.getByLabel("Find a member by name (at least three letters)").fill("Camille Moreau");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    const choice = page.locator('[data-testid="rower-choice"][data-name="Camille Moreau"]');
    await settled(page);
    await choice.getByRole("button", { name: "Seat Camille Moreau", exact: true }).click();
    await expect(choice.getByTestId("action-error")).toHaveText(`Camille Moreau has ${theirs} booked from 8:00 to 9:30 am.`);
    await expect(seatRow(page, reserved, 1)).toContainText("empty");

    // Seat somebody else, then try to seat them again: they are already in the practice, so the search no longer offers them.
    await seat(page, "Julien Moreau");
    await page.getByLabel("Find a member by name (at least three letters)").fill("Julien Moreau");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(page.getByTestId("no-rowers")).toBeVisible();
  });

  test("taking someone out empties the seat, taking a boat off and putting it back works, and cancelling frees the boat for booking at once", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const name = `Changes ${tag()}`;
    await uploadBoats(page, boat);

    await actAs(page, "Kenji Tanaka");
    await setUp(page, { name, day: "2026-11-10", start: "07:00", end: "09:00", boats: [boat] });
    await seat(page, "Alex Brooks", "port");
    await settled(page);
    await seatRow(page, boat, 1).getByRole("button", { name: "Take Alex Brooks out of seat 1" }).click();
    await expect(seatRow(page, boat, 1)).toContainText("empty");

    await seat(page, "Alex Brooks");
    await expect(seatRow(page, boat, 1)).toContainText("Alex Brooks");
    await settled(page);
    await page.getByRole("button", { name: `Take ${boat} off the practice` }).click();
    await expect(page.getByTestId("no-boats")).toBeVisible();
    await expect(page.getByTestId("add-boat-form")).toBeVisible();
    await page.getByLabel("Add a boat").selectOption({ label: boat });
    await page.getByRole("button", { name: "Add the boat" }).click();
    await expect(seatRow(page, boat, 1)).toContainText("empty");

    await page.getByLabel("Why? (optional)").fill("Too windy");
    await page.getByRole("button", { name: "Cancel the practice" }).click();
    // The cancel form, and its note, go away with the refresh, so wait for where the practice ends up.
    await expect(page.getByTestId("practice-cancelled")).toHaveText("Cancelled: Too windy");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cancelled");
    await page.goto("/club/practices?show=past");
    await expect(page.locator(`[data-testid="practice-card"][data-practice="${name}"]`)).toHaveAttribute("data-status", "cancelled");

    await actAs(page, "Hollis Whitcombe");
    await page.goto("/club/book?day=2026-11-10&type=Shell");
    await expect(slot(page, boat, "7:00 to 7:30 am", "free")).toBeVisible();
  });
});

test.describe("who may change a practice", () => {
  test("a coach sees a practice staff run but cannot change it; staff can", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const name = `Staff run ${tag()}`;
    await uploadBoats(page, boat);
    await setUp(page, { name, day: "2026-11-11", start: "07:00", end: "09:00", boats: [boat] });
    await expect(page.getByText("Run by Staff")).toBeVisible();
    await expect(page.getByLabel("Find a member by name (at least three letters)")).toBeVisible();
    const url = page.url().replace(/\?.*$/, "");

    await actAs(page, "Kenji Tanaka");
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("read-only-note")).toHaveText("Only club staff, or the coach who runs this practice, can change it.");
    await expect(page.getByLabel("Find a member by name (at least three letters)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Cancel the practice|Add the boat/ })).toHaveCount(0);
    await page.goto("/club/practices");
    await expect(page.locator(`[data-testid="practice-card"][data-practice="${name}"]`)).toContainText("Run by Staff");
  });

  test("staff can name the coach who runs a practice, and that coach can then change it", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const name = `Named coach ${tag()}`;
    await uploadBoats(page, boat);
    await setUp(page, { name, day: "2026-11-12", start: "07:00", end: "09:00", boats: [boat], coach: "Kenji Tanaka" });
    await expect(page.getByText("Run by Kenji Tanaka")).toBeVisible();
    const url = page.url().replace(/\?.*$/, "");
    await actAs(page, "Kenji Tanaka");
    await page.goto(url);
    await expect(page.getByLabel("Find a member by name (at least three letters)")).toBeVisible();
    await expect(page.getByTestId("read-only-note")).toHaveCount(0);
  });

  test("the set-up form explains every mistake at once, and nothing is saved", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/practices/new");
    await settled(page);
    await page.getByLabel("Name", { exact: true }).fill("Backwards");
    await page.getByLabel("Day", { exact: true }).fill("2026-11-14");
    await page.getByLabel("Starts", { exact: true }).fill("09:00");
    await page.getByLabel("Ends", { exact: true }).fill("07:00");
    await page.getByTestId("practice-submit").click();
    await expect(page.getByTestId("action-error")).toHaveText("The practice must end after it starts.");
    await expect(page).toHaveURL(/\/club\/practices\/new$/);
    // A day that has already gone is stopped by the date box itself, before the server is asked.
    await page.getByLabel("Day", { exact: true }).fill("2026-10-27");
    expect(await page.getByLabel("Day", { exact: true }).evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
    // Nothing was saved by either attempt.
    await page.goto("/club/practices");
    await expect(page.locator('[data-testid="practice-card"][data-practice="Backwards"]')).toHaveCount(0);
  });
});

test.describe("a booking made before the practice", () => {
  test("is flagged to the coach and staff and shown to the booker, and nothing is cancelled", async ({ page }) => {
    const boat = `Skiff${tag()}`;
    const name = `Over a booking ${tag()}`;
    await uploadBoats(page, boat);

    await actAs(page, "Priya Rao");
    await book(page, boat, "2026-11-05", "8:00 to 8:30 am");

    await actAs(page, "Kenji Tanaka");
    await setUp(page, { name, day: "2026-11-05", start: "07:00", end: "09:00", boats: [boat] });
    const list = page.getByTestId("practice-clash-list");
    await expect(list).toContainText("1 booking already made on this practice's boat overlaps the practice.");
    await expect(list.getByTestId("clash-row")).toContainText(`Priya Rao has ${boat} from Thursday, Nov 5, 8:00 to 9:30 am`);
    // The coach is a member, so how to reach the booker is for staff only.
    await expect(list.locator("a")).toHaveCount(0);
    await expect(list).not.toContainText("@");
    const url = page.url().replace(/\?.*$/, "");
    await page.goto("/club/practices");
    await expect(page.locator(`[data-testid="practice-card"][data-practice="${name}"]`).getByTestId("practice-clashes")).toHaveText("1 booking already made on its boats overlaps it.");

    await actAs(page, "Test staff");
    await page.goto(url);
    await expect(page.getByTestId("clash-row").locator("a")).toHaveText("priya.rao@example.com");

    await actAs(page, "Priya Rao");
    await page.goto("/club/my-bookings");
    const row = page.locator("li", { has: page.getByTestId("booking-practice-notice") }).filter({ hasText: boat });
    await expect(row.getByTestId("booking-status")).toHaveText("Upcoming");
    await expect(row.getByTestId("booking-practice-notice")).toHaveText(`${boat} is also reserved for ${name} from 7:00 to 9:00 am. Please check with club staff before you go.`);
  });
});

test.describe("the sample club", () => {
  test("has a coach who runs a practice with a lineup, and one earlier booking flagged", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/practices");
    const card = page.locator('[data-testid="practice-card"][data-practice="Morning technique session"]');
    await expect(card).toContainText("Sunday, Nov 8, 7:00 to 9:00 am");
    await expect(card).toContainText("Run by Kenji Tanaka · 3 boats · 6 of 7 seats filled");
    await expect(card.getByTestId("practice-clashes")).toHaveText("1 booking already made on its boats overlaps it.");
    await card.getByRole("link", { name: "Morning technique session" }).click();
    await expect(seatRow(page, "Albatross", 1)).toContainText("Erik Lindqvist · port");
    await expect(seatRow(page, "Albatross", 4)).toContainText("Nora Abernathy · starboard");
    await expect(seatRow(page, "Pelican", 2)).toContainText("Alex Brooks");
    await expect(seatRow(page, "Kingfisher", 1)).toContainText("empty");
    await expect(page.getByTestId("clash-row")).toContainText("Sasha Bellweather has Kingfisher");

    await actAs(page, "Erik Lindqvist");
    await page.goto("/club/my-practices");
    const mine = page.locator('[data-testid="my-practice"][data-practice="Morning technique session"]');
    await expect(mine.getByTestId("my-seat")).toHaveText("Albatross, seat 1 · port");
    await expect(mine).toContainText("In the boat with Maren Lindqvist, Hollis Whitcombe, Nora Abernathy");
  });

  test("a phone-sized screen fits: no sideways scrolling, and the buttons are big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await actAs(page, "Test staff");
    await page.goto("/club/practices");
    await page.getByRole("link", { name: "Morning technique session" }).click();
    await settled(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
    const take = page.getByRole("button", { name: "Take Erik Lindqvist out of seat 1" });
    expect((await take.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.goto("/club/practices/new");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
