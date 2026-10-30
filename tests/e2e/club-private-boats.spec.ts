import { expect, test, type Page } from "@playwright/test";

/**
 * Private boats: a boat that belongs to members. Only its owners (named by staff) and the people an owner invites can see or book
 * it, and its skill level is not checked. Every test makes its own boat through the equipment upload, with its own unique name (the
 * tests share one server), and uses only invented members. The people used here are the Eriksen and Castellanos households and
 * Alex Brooks: Lars Eriksen holds sculling level 3, Britta Eriksen holds nothing, and Rafael Castellanos is never on any list.
 */

const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes,Owner emails";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n") + "\r\n";
/** A private boat row: Name, Type, Seats, Skill, Owned by, In service, Places, Notes, Owner emails (the owners, by full name, in one cell). */
const privateRow = (name: string, seats: string, owners = "") => [name, "Shell", seats, "", "Private", "", "", "", owners ? `"${owners}"` : ""].join(",");

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Staff load a private boat (or two) through the upload, as a real staff member would. */
async function upload(page: Page, ...rows: string[]) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  await page.locator("#equip-file").setInputFiles({ name: "boats.csv", mimeType: "text/csv", buffer: Buffer.from(csv(...rows)) });
  await page.getByTestId("equip-check").click();
  await page.getByTestId("equip-add").click();
  await expect(page.getByTestId("equip-done")).toContainText(/Added \d+ items?/);
}

const slot = (page: Page, item: string, range: string, state: string) => page.locator(`[aria-label="${item}, ${range}, ${state}"]`);
const card = (page: Page, item: string) => page.locator(`[data-testid="item-card"][data-item="${item}"]`);
const boatCard = (page: Page, item: string) => page.locator(`[data-testid="private-boat"][aria-label="${item}"]`);
const myBoat = (page: Page, item: string) => page.locator(`[data-testid="my-boat"][aria-label="${item}"]`);
const dayOf = (day: number) => `/club/book?day=2026-11-0${day}&type=Shell`;

/** The member searches for someone on their boat's invite form and presses Invite beside the first match. */
async function invite(page: Page, boat: string, typed: string, name: string) {
  await page.goto("/club/my-boats");
  const mine = myBoat(page, boat);
  await mine.getByLabel("Name of the member (at least 3 letters)").fill(typed);
  await mine.getByRole("button", { name: "Find" }).click();
  const person = mine.getByTestId("boat-person").filter({ hasText: name });
  await expect(person).toHaveCount(1);
  await person.getByRole("button", { name: `Invite ${name}` }).click();
  // The list refreshes by itself and the person moves from the matches to the invited list, taking the little "invited" note with
  // them, so wait for where they end up.
  await expect(mine.getByTestId("boat-invited")).toContainText(name);
}

test.describe("what members see", () => {
  test("a private boat is shown to its owner and to staff, and hidden from everyone else, including by its address", async ({ page }) => {
    const boat = `Playwright Private ${tag()}`;
    await upload(page, privateRow(boat, "1", "Lars Eriksen"));

    // Staff see it in the day view, marked Private. They also copy its booking address from a free slot.
    await page.goto(dayOf(3));
    await expect(card(page, boat).locator(".club-tag")).toHaveText("Private");
    const href = (await slot(page, boat, "7:00 to 7:30 am", "free").getAttribute("href"))!;
    expect(href).toContain("/club/book/new?item=");
    // Staff's "Booking for" list on a private boat is only the people on its list.
    await page.goto(href);
    const choices = (await page.getByLabel("Booking for").locator("option").allTextContents()).join("|");
    expect(choices).toContain("Lars Eriksen");
    expect(choices).not.toContain("Rafael Castellanos");

    // The owner sees it, with its free slots and no skill requirement mentioned.
    await actAs(page, "Lars Eriksen");
    await page.goto(dayOf(3));
    await expect(card(page, boat)).toBeVisible();
    await expect(card(page, boat)).not.toContainText("needs ");
    await expect(page.getByTestId("my-boats-link")).toContainText("You can use private boats");

    // Someone who is not on the list never sees the boat, and cannot open its booking form by its address.
    await actAs(page, "Rafael Castellanos");
    await page.goto(dayOf(3));
    await expect(page.getByTestId("item-card").first()).toBeVisible();
    await expect(card(page, boat)).toHaveCount(0);
    await expect(page.getByText(boat)).toHaveCount(0);
    await expect(page.getByTestId("my-boats-link")).toHaveCount(0);
    expect((await page.goto(href))?.status()).toBe(404);
    await page.goto("/club/my-boats");
    await expect(page.getByTestId("no-boats")).toHaveText("You are not an owner of a private boat, and no owner has invited you to one.");
    await expect(page.getByText(boat)).toHaveCount(0);
  });

  test("the booking form for a private boat says it is private and checks no skill level, so a member with no qualification can book it", async ({ page }) => {
    const boat = `Playwright Quad ${tag()}`;
    // A club quad needs level 3. Britta Eriksen holds no qualification at all.
    await upload(page, privateRow(boat, "4", "Britta Eriksen"));
    await actAs(page, "Britta Eriksen");
    await page.goto(dayOf(3));
    await slot(page, boat, "8:00 to 8:30 am", "free").click();
    await expect(page.getByTestId("check-ok")).toHaveText("This booking meets the rules.");
    await expect(page.getByRole("region", { name: "Rules" })).toContainText("This is a private boat. Its owners and the people an owner has invited can use it, and its skill level is not checked");
    await expect(page.getByRole("region", { name: "Rules" })).not.toContainText("You need");
    await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await page.getByRole("button", { name: /^Cancel / }).first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("on a private double only owners and invited people are offered as crew", async ({ page }) => {
    const boat = `Playwright Double ${tag()}`;
    await upload(page, privateRow(boat, "2", "Lars Eriksen; Britta Eriksen"));
    await actAs(page, "Lars Eriksen");
    await page.goto(dayOf(4));
    await slot(page, boat, "9:00 to 9:30 am", "free").click();
    const crew = page.locator("fieldset", { hasText: "Crew" });
    await expect(crew.getByLabel("Britta Eriksen")).toBeVisible();
    // Rafael Castellanos holds no qualification either, but the point is he is simply not on the list; Alex Brooks holds one and is not offered.
    await expect(crew.getByLabel("Rafael Castellanos")).toHaveCount(0);
    await expect(crew.getByLabel("Alex Brooks")).toHaveCount(0);
    await crew.getByLabel("Britta Eriksen").check();
    await page.getByRole("button", { name: "Check my choices" }).click();
    await expect(page.getByTestId("check-ok")).toBeVisible();
    await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await page.getByRole("button", { name: /^Cancel / }).first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });
});

test.describe("an owner invites and takes off", () => {
  test("an owner finds a member by name, invites them at once, they can book it, and taking them off cancels what they booked", async ({ page }) => {
    const boat = `Playwright Kestrel ${tag()}`;
    await upload(page, privateRow(boat, "1", "Lars Eriksen"));

    await actAs(page, "Lars Eriksen");
    await page.goto("/club/my-boats");
    await expect(myBoat(page, boat).getByTestId("boat-owners")).toHaveText("Lars Eriksen");
    await expect(myBoat(page, boat).getByTestId("boat-no-invited")).toBeVisible();

    // Fewer than three letters finds nothing, and the results never show an email address or a phone number.
    await myBoat(page, boat).getByLabel("Name of the member (at least 3 letters)").fill("br");
    await myBoat(page, boat).getByRole("button", { name: "Find" }).click();
    await expect(page.getByText("Type at least 3 letters of the name.")).toBeVisible();
    await invite(page, boat, "brit", "Britta Eriksen");
    await expect(myBoat(page, boat).getByTestId("boat-invited")).toContainText("Britta Eriksen");
    await expect(myBoat(page, boat)).not.toContainText("@");

    // The invited person finds it under "Boats you are invited to", books it, and cannot invite anyone.
    await actAs(page, "Britta Eriksen");
    await page.goto("/club/my-boats");
    await expect(page.getByTestId("invited-boats")).toContainText(boat);
    await expect(myBoat(page, boat)).toHaveCount(0);
    await page.goto(dayOf(4));
    await slot(page, boat, "7:00 to 7:30 am", "free").click();
    await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await expect(page.getByTestId("booking-row").filter({ hasText: boat })).toHaveCount(1);

    // The owner takes them off. The button says what that will do, and does it.
    await actAs(page, "Lars Eriksen");
    await page.goto("/club/my-boats");
    const take = myBoat(page, boat).getByRole("button", { name: "Take Britta Eriksen off the boat" });
    await expect(take).toHaveText("Take off (cancels 1 booking)");
    await take.click();
    await expect(myBoat(page, boat).getByTestId("boat-no-invited")).toBeVisible();

    // Britta's booking is cancelled, and she no longer sees the boat.
    await actAs(page, "Britta Eriksen");
    await page.goto("/club/my-bookings");
    await expect(page.locator(`[data-testid="booking-row"][data-item="${boat}"]`)).toHaveAttribute("data-status", "cancelled");
    await page.goto(dayOf(4));
    await expect(card(page, boat)).toHaveCount(0);
    await page.goto("/club/my-boats");
    await expect(page.getByText(boat)).toHaveCount(0);
  });

  test("a member who is only invited cannot reach the invite form, and a member is never shown staff's screen", async ({ page }) => {
    const boat = `Playwright Guest ${tag()}`;
    await upload(page, privateRow(boat, "1", "Lars Eriksen"));
    await actAs(page, "Lars Eriksen");
    await invite(page, boat, "brit", "Britta Eriksen");
    await actAs(page, "Britta Eriksen");
    await page.goto("/club/my-boats");
    await expect(page.getByTestId("invited-boats")).toContainText(boat);
    await expect(myBoat(page, boat)).toHaveCount(0);
    expect((await page.goto("/club/admin/boats"))?.status()).toBe(404);
    await actAs(page, "Test staff");
    await page.goto("/club/my-boats");
    await expect(page.getByRole("link", { name: "Private boats" })).toBeVisible();
    await expect(page.getByText(boat)).toHaveCount(0);
  });
});

test.describe("staff", () => {
  test("a boat uploaded with no owner is locked and on the staff office list; naming an owner unlocks it, and the owner can book it", async ({ page }) => {
    const boat = `Playwright Wren ${tag()}`;
    await upload(page, privateRow(boat, "1"));

    // Locked: staff see it on the office board and on the Private boats screen, and nobody can book it.
    await page.goto("/club/admin");
    await expect(page.getByTestId("locked-boats")).toContainText(boat);
    await page.goto("/club/admin/boats");
    await expect(boatCard(page, boat).getByTestId("boat-locked")).toHaveText("Locked");
    await expect(boatCard(page, boat).getByTestId("boat-no-owners")).toBeVisible();
    await page.goto(dayOf(3));
    await expect(card(page, boat).getByTestId("boat-locked-note")).toBeVisible();
    await expect(slot(page, boat, "7:00 to 7:30 am", "free")).not.toHaveAttribute("href", /.+/);

    // Staff find a member by name and make them an owner.
    await page.goto("/club/admin/boats");
    await boatCard(page, boat).getByLabel("Name of the member (at least 3 letters)").fill("alex br");
    await boatCard(page, boat).getByRole("button", { name: "Find" }).click();
    const person = boatCard(page, boat).getByTestId("boat-person").filter({ hasText: "Alex Brooks" });
    await person.getByRole("button", { name: "Make owner Alex Brooks" }).click();
    // The list refreshes by itself and the person moves from the matches to the owners.
    await expect(boatCard(page, boat).getByTestId("boat-owners")).toContainText("Alex Brooks");
    await expect(boatCard(page, boat).getByTestId("boat-locked")).toHaveCount(0);
    await expect(boatCard(page, boat).getByTestId("boat-log")).toContainText("Alex Brooks was made an owner by Test staff.");
    await page.goto("/club/admin");
    await expect(page.getByTestId("locked-boats")).not.toContainText(boat);

    // The new owner can book it at once.
    await actAs(page, "Alex Brooks");
    await page.goto(dayOf(4));
    await slot(page, boat, "7:00 to 7:30 am", "free").click();
    await page.getByRole("button", { name: `Book ${boat}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();
    await page.getByRole("button", { name: /^Cancel / }).first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("staff can take an owner off, which locks the boat again, and the record says who did what", async ({ page }) => {
    const boat = `Playwright Lock ${tag()}`;
    await upload(page, privateRow(boat, "1", "Alex Brooks"));
    await page.goto("/club/admin/boats");
    await expect(boatCard(page, boat).getByTestId("boat-owners")).toContainText("Alex Brooks");
    await boatCard(page, boat).getByRole("button", { name: "Take Alex Brooks off the boat" }).click();
    await expect(boatCard(page, boat).getByTestId("boat-locked")).toHaveText("Locked");
    await expect(boatCard(page, boat).getByTestId("boat-log")).toContainText("Alex Brooks is no longer an owner. Taken off by club staff.");
    await expect(page.getByTestId("boats-summary")).toContainText("locked with no owner");
  });

  test("only staff can open the Private boats screen, and someone not signed in is asked to sign in", async ({ page, browser, baseURL }) => {
    await actAs(page, "Rafael Castellanos");
    expect((await page.goto("/club/admin/boats"))?.status()).toBe(404);
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(page.getByTestId("tools").getByRole("link", { name: "Private boats" })).toBeVisible();
    const context = await browser.newContext({ baseURL });
    const anon = await context.newPage();
    await anon.goto("/club/admin/boats");
    await expect(anon.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(anon.getByTestId("private-boat")).toHaveCount(0);
    await anon.goto("/club/my-boats");
    await expect(anon.getByTestId("my-boat")).toHaveCount(0);
    await context.close();
  });
});

test.describe("the sample club", () => {
  test("has private boats that show the three states: owned, shared with a member who holds no skill, and locked", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/boats");
    await expect(boatCard(page, "Kestrel").getByTestId("boat-owners")).toContainText("Nora Abernathy");
    await expect(boatCard(page, "Kestrel").getByTestId("boat-invited")).toContainText("Tomas Vandermeer");
    await expect(boatCard(page, "Starling").getByTestId("boat-invited")).toContainText("Ines Castellanos");
    await expect(boatCard(page, "Wren").getByTestId("boat-locked")).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("My boats and the staff Private boats screen fit the screen", async ({ page }) => {
    const boat = `Playwright Phone ${"x".repeat(6)}${tag()}`;
    await upload(page, privateRow(boat, "1", "Lars Eriksen"));
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto("/club/admin/boats");
    await fits();
    await actAs(page, "Lars Eriksen");
    await invite(page, boat, "brit", "Britta Eriksen");
    await fits();
    const take = myBoat(page, boat).getByRole("button", { name: "Take Britta Eriksen off the boat" });
    await expect(take).toBeVisible();
    const box = await take.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });
});
