import { expect, test, type Page } from "@playwright/test";

/**
 * Pools: a dock, the club room or the gym is one item with a number of places. Members book a time and see how many places
 * are left; nobody is given a place number. These tests use the invented club's two pools: "Dock berths" (4 places) and
 * "Weight room" (3 places), on a day no other test books, and cancel what they book so the next run starts clean.
 */

const DAY = "2026-11-02";
const DOCK = "Dock berths";
const GYM = "Weight room";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};
const slot = (page: Page, item: string, range: string, words: string) => page.locator(`[aria-label="${item}, ${range}, ${words}"]`);
const bookPage = (page: Page, type: string) => page.goto(`/club/book?day=${DAY}&type=${encodeURIComponent(type)}`);

/** The member books the half hour from 8:00 in a pool, from the day view, and ends on My bookings. */
async function bookEight(page: Page, who: string, item: string, placesLeft: number, places: number) {
  await actAs(page, who);
  await bookPage(page, item === DOCK ? "Dock Space" : "Gym Space");
  await slot(page, item, "8:00 to 8:30 am", `${placesLeft} of ${places} places left`).click();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${item}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

/** Gives back the member's 8:00 place in one pool only, so tests running side by side never cancel each other's bookings. */
async function cancelAll(page: Page, who: string, item: string) {
  await actAs(page, who);
  await page.goto("/club/my-bookings");
  for (;;) {
    const button = page.getByRole("button", { name: new RegExp(`^Cancel ${item}, 8:00`) }).first();
    if ((await button.count()) === 0) break;
    await button.click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
    await page.goto("/club/my-bookings");
  }
}

test.describe("a pool of places", () => {
  test("members see how many places are left, book one, watch the count go down, and the next person is told it is full until a place is given back", async ({ page }) => {
    const who = ["Alex Brooks", "Kenji Tanaka", "Priya Rao", "Dev Rao"];
    try {
      await actAs(page, who[0]);
      await bookPage(page, "Dock Space");
      const card = page.locator(`[data-testid="item-card"][data-item="${DOCK}"]`);
      await expect(card).toContainText("4 places");
      await expect(slot(page, DOCK, "8:00 to 8:30 am", "4 of 4 places left")).toContainText("4 left");

      // Each booking takes one place; the same slot shows one fewer to the next person, and the booker sees it as theirs.
      for (const [i, name] of who.entries()) await bookEight(page, name, DOCK, 4 - i, 4);
      await actAs(page, who[0]);
      await bookPage(page, "Dock Space");
      await expect(slot(page, DOCK, "8:00 to 8:30 am", "yours")).toBeVisible();

      // A fifth member finds the slot full: it is not a link, and the form says so in words and offers no Book button.
      await actAs(page, "Julien Moreau");
      await bookPage(page, "Dock Space");
      const full = page.locator(`[aria-label="${DOCK}, 8:00 to 8:30 am, 0 of 4 places left"]`);
      await expect(full).toHaveAttribute("data-state", "booked");
      await expect(full).toContainText("Full");
      // A booking is 90 minutes by default, so the next hour is full too, and the half hour after it is free.
      await expect(slot(page, DOCK, "8:30 to 9:00 am", "0 of 4 places left")).toHaveAttribute("data-state", "booked");
      await expect(slot(page, DOCK, "9:00 to 9:30 am", "0 of 4 places left")).toHaveAttribute("data-state", "booked");
      // The form for the full slot, reached by its address (the day view offers no link to it), says why.
      const nextHref = (await slot(page, DOCK, "9:30 to 10:00 am", "4 of 4 places left").getAttribute("href"))!;
      const form = new URL(nextHref, page.url());
      form.searchParams.set("start", new Date("2026-11-02T08:00:00-08:00").toISOString());
      await page.goto(form.toString());
      await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText([`${DOCK} is full from 8:00 to 9:30 am: all 4 places are booked.`]);
      await expect(page.getByRole("button", { name: `Book ${DOCK}` })).toHaveCount(0);

      // When one of them gives a place back, the count goes up and the fifth member can book it.
      await cancelAll(page, who[1], DOCK);
      await actAs(page, "Julien Moreau");
      await bookPage(page, "Dock Space");
      await expect(slot(page, DOCK, "8:00 to 8:30 am", "1 of 4 places left")).toBeVisible();
      await slot(page, DOCK, "8:00 to 8:30 am", "1 of 4 places left").click();
      await expect(page.getByTestId("check-ok")).toBeVisible();
      await page.getByRole("button", { name: `Book ${DOCK}`, exact: true }).click();
      await expect(page.getByTestId("booked-note")).toBeVisible();
    } finally {
      for (const name of [...who, "Julien Moreau"]) await cancelAll(page, name, DOCK);
    }
  });

  test("a member sees only 'Full' on a full slot, never who holds the places; staff see the names", async ({ page }) => {
    const people = ["Amara Okonkwo", "Chidi Okonkwo", "Camille Moreau"];
    try {
      for (const [i, name] of people.entries()) await bookEight(page, name, GYM, 3 - i, 3);
      await actAs(page, "Walter Pemberton");
      await bookPage(page, "Gym Space");
      const full = page.locator(`[aria-label="${GYM}, 8:00 to 8:30 am, 0 of 3 places left"]`);
      await expect(full).toContainText("Full");
      await expect(full).not.toHaveAttribute("title", /./);
      for (const name of people) await expect(page.locator(`[data-testid="item-card"][data-item="${GYM}"]`)).not.toContainText(name);
      await actAs(page, "Test staff");
      await bookPage(page, "Gym Space");
      const staffFull = page.locator(`[aria-label="${GYM}, 8:00 to 8:30 am, 0 of 3 places left"]`);
      for (const name of people) await expect(staffFull).toHaveAttribute("title", new RegExp(name));
    } finally {
      for (const name of people) await cancelAll(page, name, GYM);
    }
  });

  test("the booking form says in words that the pool is shared and counted, and that it is one place at a time", async ({ page }) => {
    await actAs(page, "Alex Brooks");
    await bookPage(page, "Dock Space");
    await slot(page, DOCK, "9:00 to 9:30 am", "4 of 4 places left").click();
    await expect(page.getByText(`${DOCK} has 4 places, shared by everyone. You book a time and the club counts how many places are left; you are not given a place number. You can hold one place at a time.`)).toBeVisible();
  });

  test("on a phone the day view fits the screen and a place can still be tapped", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await actAs(page, "Alex Brooks");
    await bookPage(page, "Dock Space");
    const target = slot(page, DOCK, "10:00 to 10:30 am", "4 of 4 places left");
    await expect(target).toBeVisible();
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(36);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
