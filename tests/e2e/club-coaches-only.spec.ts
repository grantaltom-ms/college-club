import { expect, test, type Page } from "@playwright/test";

/**
 * The 8x is booked only by coaches and club staff (Grant, Nov 5, 2026). A member who is not a coach still sees it on Reservations, marked
 * "Coaches only", but cannot book it; a coach and staff can. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28,
 * 2026. The sample club's coach is Kenji Tanaka; Nora Abernathy is an ordinary member. Nobody books an eight in any other test, and these
 * tests cancel what they book, so they can be run again.
 */

const DAY = "2026-11-04";
/** Each test that books or could be disturbed by a booking has its own boat and hour, because the tests run side by side on one server. */
type Eight = { name: string; hour: number; range: string };
const LOOKING: Eight = { name: "Betty Binns Fletcher", hour: 9, range: "9:00 to 9:30 am" }; // only looked at, never booked
const COACH_BOOKS: Eight = { name: "Charlie Hamlin Empacher", hour: 10, range: "10:00 to 10:30 am" };
const STAFF_BOOKS: Eight = { name: "Charlie Hamlin Empacher", hour: 14, range: "2:00 to 2:30 pm" };

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Reservations for the 8x size on the day above, at the hour of the given eight, with the dense list of eights. */
const openEights = (page: Page, e: Eight) => page.goto(`/club/book?day=${DAY}&what=shell&kind=eight&hour=${e.hour}`);
const eightRow = (page: Page, e: Eight) => page.locator(`[data-testid="shell-row"][data-item="${e.name}"]`);
const freeLink = (page: Page, e: Eight) => page.locator(`a[aria-label="${e.name}, ${e.range}, free"]`);

async function cancelAll(page: Page) {
  await page.goto("/club/my-bookings");
  const buttons = page.getByRole("button", { name: /^Cancel / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

test.describe("the 8x is for coaches and staff", () => {
  test("a member who is not a coach sees the eights marked Coaches only, with no times to click", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await openEights(page, LOOKING);
    const row = eightRow(page, LOOKING);
    await expect(row).toBeVisible();
    await expect(row.getByText("Coaches only", { exact: true })).toBeVisible();
    await expect(row.getByTestId("coaches-only-note")).toHaveText("Coaches only: this boat can only be booked by coaches and club staff. Ask a coach or club staff to book it.");
    // The times are shown but are not links, so there is nothing to click.
    await expect(row.locator(`span[aria-label="${LOOKING.name}, ${LOOKING.range}, free"]`)).toBeVisible();
    await expect(freeLink(page, LOOKING)).toHaveCount(0);
    await expect(page.getByTestId("shell-dense-count")).toHaveText("No shells free in this hour.");
  });

  test("the same screen as a coach, and as staff, offers the times as links", async ({ page }) => {
    for (const who of ["Kenji Tanaka", "Test staff"]) {
      await actAs(page, who);
      await openEights(page, LOOKING);
      await expect(eightRow(page, LOOKING).getByText("Coaches only", { exact: true })).toBeVisible();
      await expect(eightRow(page, LOOKING).getByTestId("coaches-only-note")).toHaveCount(0);
      await expect(freeLink(page, LOOKING)).toBeVisible();
    }
  });

  test("a member who is not a coach who opens the booking form by its address is refused in words, and nothing is booked", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await openEights(page, LOOKING);
    const href = await freeLink(page, LOOKING).getAttribute("href");
    expect(href).toMatch(/^\/club\/book\/new\?/);

    await actAs(page, "Nora Abernathy");
    await page.goto(href!);
    await expect(page.getByRole("heading", { level: 1, name: `Book ${LOOKING.name}` })).toBeVisible();
    await expect(page.getByTestId("refusal-reasons")).toContainText(`${LOOKING.name} can only be booked by coaches and club staff. Ask a coach or club staff to book it.`);
    await expect(page.getByTestId("check-ok")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Book ${LOOKING.name}`, exact: true })).toHaveCount(0);
    // The rules say who can book it.
    await expect(page.getByRole("region", { name: "Rules" })).toContainText("Only coaches and club staff can book this boat. No skill level is checked: the coach decides who rows.");
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("booking-row").filter({ hasText: LOOKING.name })).toHaveCount(0);
  });

  test("a coach books an eight, sees it in My bookings, and cancels it", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await cancelAll(page);
    await openEights(page, COACH_BOOKS);
    await freeLink(page, COACH_BOOKS).click();
    await expect(page.getByRole("heading", { level: 1, name: `Book ${COACH_BOOKS.name}` })).toBeVisible();
    await expect(page.getByTestId("check-ok")).toBeVisible();
    await page.getByRole("button", { name: `Book ${COACH_BOOKS.name}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await expect(page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("booking-row").filter({ hasText: COACH_BOOKS.name })).toHaveCount(1);
    // Somebody else no longer finds the boat free in that hour, as for any boat.
    await actAs(page, "Nora Abernathy");
    await openEights(page, COACH_BOOKS);
    await expect(eightRow(page, COACH_BOOKS)).toHaveCount(0);
    await actAs(page, "Kenji Tanaka");
    await cancelAll(page);
  });

  test("staff book an eight for a member who is not a coach, with no reason to give", async ({ page }) => {
    await actAs(page, "Test staff");
    await openEights(page, STAFF_BOOKS);
    await freeLink(page, STAFF_BOOKS).click();
    await expect(page.getByRole("heading", { level: 1, name: `Book ${STAFF_BOOKS.name}` })).toBeVisible();
    await page.getByLabel("Booking for").selectOption({ label: "Nora Abernathy (The Abernathy household)" });
    await page.getByRole("button", { name: "Check my choices" }).click();
    await expect(page.getByTestId("check-ok")).toBeVisible();
    // Staff need no reason, and nothing is set aside: the booking meets the rules as they are for staff.
    await expect(page.getByTestId("waived-rules")).toHaveCount(0);
    await expect(page.getByLabel(/reason/i)).toHaveCount(0);
  });
});
