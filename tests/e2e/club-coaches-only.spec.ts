import { expect, test, type Page } from "@playwright/test";
import { pickSlot, slot, slotHref } from "./helpers";

/**
 * The 8x (Grant, Nov 5, 2026) and the 4x (Grant, Nov 10) are booked only by coaches and club staff; on screen they are labelled "8+" and
 * "4x/+" (Nov 10). The rest of this note is about the 8x; the 4x has its own tests at the end.
 * The 8x is booked only by coaches and club staff (Grant, Nov 5, 2026). Since Nov 10 a member who is not a coach does not see it, or the
 * 4x, on Reservations at all, and its booking form is "page not found" for them; a coach and staff see it marked "Coaches only". The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28,
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
/** The free start time in the eight's dropdown (an option: enabled for a coach or staff, disabled for anyone else). */
const freeTime = (page: Page, e: Eight) => slot(page, e.name, e.range, "free");

async function cancelAll(page: Page) {
  await page.goto("/club/my-bookings");
  const buttons = page.getByRole("button", { name: /^Cancel / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

test.describe("the 8x is for coaches and staff", () => {
  test("a member who is not a coach is not shown the eights at all, even by asking for the 8+ size in the address", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await openEights(page, LOOKING);
    await expect(eightRow(page, LOOKING)).toHaveCount(0);
    await expect(page.getByText(LOOKING.name)).toHaveCount(0);
    // Without a size she can book, the page offers the sizes she can book instead.
    await expect(page.getByTestId("shell-kinds").locator(".club-book-shell-size-label")).toHaveText(["1x", "2x"]);
  });

  test("the same screen as a coach, and as staff, offers the times as links", async ({ page }) => {
    for (const who of ["Kenji Tanaka", "Test staff"]) {
      await actAs(page, who);
      await openEights(page, LOOKING);
      await expect(eightRow(page, LOOKING).getByText("Coaches only", { exact: true })).toBeVisible();
      await expect(eightRow(page, LOOKING).getByTestId("coaches-only-note")).toHaveCount(0);
      await expect(freeTime(page, LOOKING)).toBeEnabled();
    }
  });

  test("a member who is not a coach who opens the booking form by its address gets page not found, and nothing is booked", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await openEights(page, LOOKING);
    const href = await slotHref(page, LOOKING.name, LOOKING.range);
    expect(href).toMatch(/^\/club\/book\/new\?/);
    // A coach's form says who can book it.
    await page.goto(href!);
    await expect(page.getByRole("region", { name: "Rules" })).toContainText("Only coaches and club staff can book this boat. No skill level is checked: the coach decides who rows.");

    await actAs(page, "Nora Abernathy");
    const response = await page.goto(href!);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(LOOKING.name)).toHaveCount(0);
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("booking-row").filter({ hasText: LOOKING.name })).toHaveCount(0);
  });

  test("the crew list for an eight offers every other active member, including one with no qualification, even though the boat carries a skill level", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await openEights(page, LOOKING);
    await pickSlot(page, LOOKING.name, LOOKING.range);
    await expect(page.getByRole("heading", { level: 1, name: `Book ${LOOKING.name}` })).toBeVisible();
    // The sample's eight carries iCrew's own skill level (Advanced), which is not checked for an eight. Ines Castellanos holds no
    // qualification at all, and a coach can still seat her.
    const crew = page.getByRole("group", { name: /^Crew/ });
    await expect(crew.getByLabel("Ines Castellanos")).toBeVisible();
    await expect(crew.getByText("No other member holds the qualification this boat needs.")).toHaveCount(0);
    expect(await crew.getByRole("checkbox").count()).toBeGreaterThan(5);
    // And the staff screen for the boat says no skill level is checked, rather than showing the stored one.
    await actAs(page, "Test staff");
    await page.goto("/club/equipment?find=Betty");
    await page.getByRole("link", { name: `Edit or retire ${LOOKING.name}`, exact: true }).click();
    await expect(page.getByTestId("item-skill")).toHaveText("Skill level needed: not checked on a coaches-only boat");
  });

  test("a coach books an eight, sees it in My bookings, and cancels it", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await cancelAll(page);
    await openEights(page, COACH_BOOKS);
    await pickSlot(page, COACH_BOOKS.name, COACH_BOOKS.range);
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
    await pickSlot(page, STAFF_BOOKS.name, STAFF_BOOKS.range);
    await expect(page.getByRole("heading", { level: 1, name: `Book ${STAFF_BOOKS.name}` })).toBeVisible();
    await page.getByLabel("Booking for").selectOption({ label: "Nora Abernathy (The Abernathy household)" });
    await page.getByRole("button", { name: "Check my choices" }).click();
    await expect(page.getByTestId("check-ok")).toBeVisible();
    // Staff need no reason, and nothing is set aside: the booking meets the rules as they are for staff.
    await expect(page.getByTestId("waived-rules")).toHaveCount(0);
    await expect(page.getByLabel(/reason/i)).toHaveCount(0);
  });
});

/** The 4x: the sample club's quad, Albatross. Its hours on DAY are not used by any other test. */
const QUAD_LOOKING: Eight = { name: "Albatross", hour: 11, range: "11:00 to 11:30 am" };
const QUAD_COACH_BOOKS: Eight = { name: "Albatross", hour: 15, range: "3:00 to 3:30 pm" };
const openQuads = (page: Page, e: Eight) => page.goto(`/club/book?day=${DAY}&what=shell&kind=quad&hour=${e.hour}`);

test.describe("the 4x is for coaches and staff too, and the sizes read 4x/+ and 8+", () => {
  test("a coach sees the sizes labelled 1x, 2x, 4x/+ and 8+, and the chosen size is named the same way", async ({ page }) => {
    for (const who of ["Kenji Tanaka", "Test staff"]) {
      await actAs(page, who);
      await page.goto(`/club/book?day=${DAY}&what=shell`);
      const sizes = page.getByTestId("shell-kinds");
      await expect(sizes.locator(".club-book-shell-size-label")).toHaveText(["1x", "2x", "4x/+", "8+"]);
      await expect(sizes.getByText("4x", { exact: true })).toHaveCount(0);
      await expect(sizes.getByText("8x", { exact: true })).toHaveCount(0);
      await sizes.locator("[data-kind=quad]").click();
      await expect(page.getByTestId("browse-label")).toHaveText("Shells · 4x/+");
      await page.goto(`/club/book?day=${DAY}&what=shell&kind=eight`);
      await expect(page.getByTestId("browse-label")).toHaveText("Shells · 8+");
    }
  });

  test("a member who is not a coach sees only 1x and 2x, is never shown a quad, and gets page not found for one by address", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await openQuads(page, QUAD_LOOKING);
    const href = await slotHref(page, QUAD_LOOKING.name, QUAD_LOOKING.range);
    expect(href).toMatch(/^\/club\/book\/new\?/);

    // Erik Lindqvist holds the highest sculling level, which was what a quad needed before; it no longer shows him one.
    await actAs(page, "Erik Lindqvist");
    await page.goto("/club/book");
    await expect(page.locator(".club-book-choose-hint").filter({ hasText: "1x, 2x" }).first()).toHaveText("1x, 2x");
    await page.goto(`/club/book?day=${DAY}&what=shell`);
    const sizes = page.getByTestId("shell-kinds");
    await expect(sizes.locator(".club-book-shell-size-label")).toHaveText(["1x", "2x"]);
    await expect(sizes.locator("[data-kind=quad], [data-kind=eight]")).toHaveCount(0);
    await openQuads(page, QUAD_LOOKING);
    await expect(eightRow(page, QUAD_LOOKING)).toHaveCount(0);
    await expect(page.getByTestId("browse-label")).toHaveCount(0);

    const response = await page.goto(href!);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("button", { name: "Book Albatross", exact: true })).toHaveCount(0);
  });

  test("a coach books the quad, sees it in My bookings, and cancels it", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await cancelAll(page);
    await openQuads(page, QUAD_COACH_BOOKS);
    await pickSlot(page, QUAD_COACH_BOOKS.name, QUAD_COACH_BOOKS.range);
    await expect(page.getByTestId("check-ok")).toBeVisible();
    await page.getByRole("button", { name: "Book Albatross", exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await expect(page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("booking-row").filter({ hasText: "Albatross" })).toHaveCount(1);
    await cancelAll(page);
  });
});
