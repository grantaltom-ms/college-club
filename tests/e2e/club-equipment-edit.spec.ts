import { expect, test, type Page } from "@playwright/test";
import { slot, pickSlot } from "./helpers";

/**
 * Fixing and retiring equipment that is already in the club, as staff do it: find an item, open it, fix its name, size, skill level or
 * places, retire it after reading what stays in place, and bring it back. Every test makes its own items through the equipment upload
 * (the tests share one server), so nothing here touches the sample boats the other specs use, and only invented names are used.
 */

const HEADER = "Name,Type,Seats,Skill level needed,Owned by,In service,Places,Notes,Owner emails";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A row in the column order: Name, Type, Seats, Skill level needed, Owned by, In service, Places. */
const row = (name: string, type: string, seats = "", skill = "", places = "") => [name, type, seats, skill, "Club", "", places, "", ""].join(",");

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Staff load these items through the upload screen, as they will on the real list. */
async function addItems(page: Page, ...rows: string[]): Promise<void> {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/equipment-import");
  await page.locator("#equip-file").setInputFiles({ name: "equipment.csv", mimeType: "text/csv", buffer: Buffer.from([HEADER, ...rows].join("\r\n") + "\r\n") });
  await page.getByTestId("equip-check").click();
  await page.getByTestId("equip-add").click();
  await expect(page.getByTestId("equip-done")).toContainText(`Added ${rows.length} item`);
}

const equipmentRow = (page: Page, name: string) => page.locator(`[data-testid="equipment-row"][data-item="${name}"]`);
const retiredRow = (page: Page, name: string) => page.locator(`[data-testid="retired-row"][data-item="${name}"]`);

/** Opens the item's own page from the Equipment list, the way staff do, and returns its address. */
async function openItem(page: Page, name: string, find: string): Promise<string> {
  await page.goto(`/club/equipment?find=${encodeURIComponent(find)}`);
  await equipmentRow(page, name).getByTestId("equipment-edit-link").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  return new URL(page.url()).pathname;
}

const editForm = (page: Page) => page.getByTestId("edit-item-form");
const save = async (page: Page) => {
  await editForm(page).getByRole("button", { name: "Save changes" }).click();
};

test.describe("who can open an item", () => {
  test("only staff: a member gets page not found, and someone signed out is asked to sign in", async ({ page, browser, baseURL }) => {
    const t = tag();
    const name = `Pw edit ${t}`;
    await addItems(page, row(name, "Shell", "1"));
    const path = await openItem(page, name, t);
    await actAs(page, "Nora Abernathy");
    expect((await page.goto(path))?.status()).toBe(404);
    expect((await page.goto("/club/equipment"))?.status()).toBe(404);
    const context = await browser.newContext({ baseURL });
    const stranger = await context.newPage();
    await stranger.goto(path);
    await expect(stranger.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(stranger.getByTestId("edit-item-form")).toHaveCount(0);
    await context.close();
  });

  test("a made-up address, or one that is not an item, is page not found for staff too", async ({ page }) => {
    await actAs(page, "Test staff");
    expect((await page.goto("/club/equipment/00000000-0000-4000-8000-0000000fffff"))?.status()).toBe(404);
    expect((await page.goto("/club/equipment/not-an-id"))?.status()).toBe(404);
  });
});

test.describe("finding an item", () => {
  test("the find box narrows the list by the first letters of any word of a name, says how many are shown, and keeps the word typed", async ({ page }) => {
    const t = tag();
    await addItems(page, row(`Pw find ${t} Alpha`, "Shell", "1"), row(`Pw find ${t} Beta`, "Kayak", "1"));
    await page.goto("/club/equipment");
    await expect(page.getByTestId("equipment-count")).toHaveText(/^\d+ items\.$/);
    await page.getByLabel("Find by name").fill(t);
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByTestId("equipment-row")).toHaveCount(2);
    await expect(page.getByTestId("equipment-count")).toHaveText(/^Showing 2 of \d+ items\.$/);
    await expect(page.getByLabel("Find by name")).toHaveValue(t);
    // Longer than any tag, so no name in the club can start with it (a shorter made-up word could match another test's items).
    await page.getByLabel("Find by name").fill(`${t}zzz`);
    await page.getByRole("button", { name: "Find" }).click();
    await expect(page.getByTestId("equipment-row")).toHaveCount(0);
    await expect(page.getByText("Nothing has a name starting that way.")).toBeVisible();
    await page.getByRole("link", { name: "Show everything" }).click();
    await expect(page.getByTestId("equipment-count")).toHaveText(/^\d+ items\.$/);
  });

  test("each card says what kind of thing it is, and the sample's retired boat is on the retired list with its reason", async ({ page }) => {
    const t = tag();
    await addItems(page, row(`Pw kind ${t}`, "Shell", "2"), row(`Pw pool ${t}`, "Dock Space", "", "", "9"));
    await page.goto(`/club/equipment?find=${t}`);
    await expect(equipmentRow(page, `Pw kind ${t}`).getByTestId("equipment-kind")).toHaveText("Shell · Double, 2 seats");
    await expect(equipmentRow(page, `Pw pool ${t}`).getByTestId("equipment-kind")).toHaveText("Dock Space · Dock space, pool of 9 places");
    await page.goto("/club/equipment?find=gannet");
    await expect(page.getByTestId("equipment-row")).toHaveCount(0);
    await expect(retiredRow(page, "Gannet")).toContainText("Retired");
    await expect(retiredRow(page, "Gannet")).toContainText("Sold to another club");
  });
});

test.describe("fixing an item", () => {
  test("renames it, and the new name is on its page, the Book page and its file, with who did it", async ({ page }) => {
    const t = tag();
    const name = `Pw rename ${t}`;
    await addItems(page, row(name, "Shell", "1", "None"));
    await openItem(page, name, t);
    await expect(page.getByTestId("item-file-empty")).toBeVisible();
    await editForm(page).getByLabel("Name").fill(`Pw renamed ${t}`);
    await save(page);
    await expect(page.getByTestId("action-ok")).toHaveText(`Saved: name from ${name} to Pw renamed ${t}.`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Pw renamed ${t}`);
    const line = page.getByTestId("item-file-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`Changed by Test staff: name from "${name}" to "Pw renamed ${t}".`);
    await page.goto("/club/book?day=2026-11-04&what=shell&kind=single&hour=7");
    await expect(slot(page, `Pw renamed ${t}`, "7:00 to 7:30 am", "free")).toHaveCount(1);
    await expect(page.locator(`[aria-label^="${name}, "]`)).toHaveCount(0);
  });

  test("changes the seats and the skill level, says what changed, and the item behaves as the new kind of boat", async ({ page }) => {
    const t = tag();
    const name = `Pw seats ${t}`;
    await addItems(page, row(name, "Shell", "1"));
    await openItem(page, name, t);
    await expect(page.getByTestId("item-skill")).toHaveText("Skill level needed: Sculling level 1 (placeholder) (usual for this kind of boat)");
    await editForm(page).getByLabel("Seats").selectOption("2");
    await save(page);
    await expect(page.getByTestId("action-ok")).toContainText("Saved: seats from Single (1 seat) to Double (2 seats).");
    await expect(page.getByTestId("action-ok")).toContainText("Its skill level follows the kind of boat, so it goes from Sculling level 1 (placeholder) to Sculling level 2 (placeholder).");
    await expect(page.getByTestId("item-skill")).toHaveText("Skill level needed: Sculling level 2 (placeholder) (usual for this kind of boat)");
    await expect(page.getByTestId("item-summary")).toContainText("Shell · Double · 2 seats");

    await editForm(page).getByLabel("Skill level needed").selectOption("none");
    await save(page);
    await expect(page.getByTestId("action-ok")).toContainText("skill level needed from Sculling level 2 (placeholder) (usual for this kind of boat) to None needed");
    await expect(page.getByTestId("item-skill")).toHaveText("Skill level needed: None needed");
    await expect(page.getByTestId("item-file-line")).toHaveCount(2);
  });

  test("says when nothing changed, and names a clash with another item's name in the engine's own words", async ({ page }) => {
    const t = tag();
    const a = `Pw clash ${t} A`;
    const b = `Pw clash ${t} B`;
    await addItems(page, row(a, "Kayak", "1"), row(b, "Kayak", "1"));
    await openItem(page, a, t);
    await save(page);
    await expect(page.getByTestId("action-error")).toHaveText(`Nothing was changed: what you entered is what ${a} already has.`);
    await editForm(page).getByLabel("Name").fill(b.toUpperCase());
    await save(page);
    await expect(page.getByTestId("action-error")).toHaveText(`There is already an item called "${b}". Names have to be different, even for a retired item.`);
    await expect(page.getByTestId("item-file-empty")).toBeVisible();
  });

  test("resizes a pool, and the Book page shows the new number of places", async ({ page }) => {
    const t = tag();
    const name = `Pw docks ${t}`;
    await addItems(page, row(name, "Dock Space", "", "", "5"));
    await openItem(page, name, t);
    await expect(editForm(page).getByLabel("Places in this pool")).toHaveValue("5");
    await expect(editForm(page).getByLabel("Seats")).toHaveCount(0);
    await editForm(page).getByLabel("Places in this pool").fill("3");
    await save(page);
    await expect(page.getByTestId("action-ok")).toHaveText("Saved: places from 5 to 3.");
    await expect(page.getByTestId("item-summary")).toContainText("3 places, counted rather than numbered");
    await expect(page.getByTestId("item-file-line")).toContainText("places from 5 to 3");
    await page.goto("/club/book?day=2026-11-04&type=Dock+Space");
    await expect(slot(page, name, "7:00 to 7:30 am", "3 of 3 places left")).toContainText("3 left");
  });

  test("an item with one size offers no seats, and a boat that is not a pool offers no places", async ({ page }) => {
    const t = tag();
    const name = `Pw board ${t}`;
    await addItems(page, row(name, "Paddle Board"));
    await openItem(page, name, t);
    await expect(editForm(page).getByLabel("Name")).toBeVisible();
    await expect(editForm(page).getByLabel("Seats")).toHaveCount(0);
    await expect(editForm(page).getByLabel("Places in this pool")).toHaveCount(0);
    await expect(editForm(page).getByLabel("Skill level needed")).toBeVisible();
  });
});

test.describe("retiring an item", () => {
  test("reads what stays in place first, retires it with a reason, and the item disappears from everything but staff's retired list", async ({ page }) => {
    const t = tag();
    const name = `Pw retire ${t}`;
    await addItems(page, row(name, "Shell", "1", "None"));

    // A member books it, so there is something to stay in place.
    await actAs(page, "Rafael Castellanos");
    const day = "/club/book?day=2026-11-10&what=shell&kind=single&hour=6";
    await page.goto(day);
    await pickSlot(page, name, "6:00 to 6:30 am", "free");
    await expect(page.getByTestId("check-ok")).toBeVisible();
    await page.getByRole("button", { name: `Book ${name}`, exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();

    await actAs(page, "Test staff");
    await openItem(page, name, t);
    const left = page.getByTestId("left-in-place");
    await expect(left).toHaveAttribute("data-count", "1");
    await expect(left.getByTestId("left-booking")).toContainText("Rafael Castellanos (booker,");
    await expect(page.getByText("Nothing is cancelled for you; contact the people")).toBeVisible();

    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("Sold to a club in Tacoma");
    await page.getByRole("button", { name: `Retire ${name}` }).click();
    await expect(page.getByTestId("action-ok")).toHaveText(`${name} is retired. 1 booking, class or practice stays in place: the list below says who to contact.`);

    // The page now says it is retired, lists who still holds it, and offers to bring it back.
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "retired");
    await expect(page.getByTestId("item-status")).toContainText("by Test staff: Sold to a club in Tacoma");
    await expect(page.getByTestId("left-in-place").getByTestId("left-booking")).toContainText("Rafael Castellanos");
    await expect(page.getByRole("button", { name: `Bring ${name} back` })).toBeVisible();
    await expect(page.getByTestId("item-file-line").first()).toContainText("Retired by Test staff. Reason: Sold to a club in Tacoma. 1 upcoming booking was left in place");

    // Staff's list moves it to the retired section, with the booking still counted.
    await page.goto(`/club/equipment?find=${t}`);
    await expect(equipmentRow(page, name)).toHaveCount(0);
    await expect(retiredRow(page, name)).toContainText("Sold to a club in Tacoma");
    await expect(retiredRow(page, name).getByTestId("retired-upcoming")).toHaveText("1 upcoming booking still on it.");

    // Nobody is offered it. The member who booked it still sees the booking, with the boat's name.
    await actAs(page, "Rafael Castellanos");
    await page.goto(day);
    await expect(page.locator(`[aria-label^="${name}, "]`)).toHaveCount(0);
    await page.goto("/club/my-bookings");
    await expect(page.getByText(name).first()).toBeVisible();
    await page.getByRole("button", { name: /^Cancel / }).first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  });

  test("needs a reason", async ({ page }) => {
    const t = tag();
    const name = `Pw reason ${t}`;
    await addItems(page, row(name, "Kayak", "1"));
    await openItem(page, name, t);
    // The reason box is required, so the browser itself stops the form and points at the box; nothing is retired.
    await page.getByRole("button", { name: `Retire ${name}` }).click();
    await expect(page.getByTestId("retire-form").getByLabel("Why is it being retired?")).toBeFocused();
    await expect(page.getByTestId("action-ok")).toHaveCount(0);
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "in_service");
    // A reason of only spaces gets past the browser and is refused in the engine's own words.
    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("   ");
    await page.getByRole("button", { name: `Retire ${name}` }).click();
    await expect(page.getByTestId("action-error")).toHaveText("Say why it is being retired, for the record.");
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "in_service");
  });

  test("a retired item can only be renamed, and renaming it frees nothing: its name stays taken", async ({ page }) => {
    const t = tag();
    const a = `Pw only ${t} A`;
    const b = `Pw only ${t} B`;
    await addItems(page, row(a, "Shell", "2"), row(b, "Shell", "1"));
    await openItem(page, a, t);
    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("Written off");
    await page.getByRole("button", { name: `Retire ${a}` }).click();
    await expect(page.getByTestId("action-ok")).toContainText(`${a} is retired. Nothing was booked on it.`);
    await expect(editForm(page).getByLabel("Name")).toBeVisible();
    await expect(editForm(page).getByLabel("Seats")).toHaveCount(0);
    await expect(editForm(page).getByLabel("Skill level needed")).toHaveCount(0);
    await expect(page.getByText("A retired item can only be renamed.")).toBeVisible();

    // Its name is still taken by the retired item, until the retired item is renamed.
    await page.goto(`/club/equipment?find=${t}`);
    await equipmentRow(page, b).getByTestId("equipment-edit-link").click();
    await editForm(page).getByLabel("Name").fill(a);
    await save(page);
    await expect(page.getByTestId("action-error")).toHaveText(`There is already an item called "${a}" (retired). Names have to be different, even for a retired item.`);

    await page.goto(`/club/equipment?find=${t}`);
    await retiredRow(page, a).getByRole("link", { name: `Open retired ${a}` }).click();
    await editForm(page).getByLabel("Name").fill(`${a} (old)`);
    await save(page);
    await expect(page.getByTestId("action-ok")).toContainText(`name from ${a} to ${a} (old)`);
  });

  test("a retired pool offers its name and nothing else: no number of places to change", async ({ page }) => {
    const t = tag();
    const name = `Pw retired docks ${t}`;
    await addItems(page, row(name, "Dock Space", "", "", "5"));
    await openItem(page, name, t);
    // While it is in use the pool offers its places...
    await expect(editForm(page).getByLabel("Places in this pool")).toHaveValue("5");
    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("Dock removed");
    await page.getByRole("button", { name: `Retire ${name}` }).click();
    await expect(page.getByTestId("action-ok")).toContainText(`${name} is retired. Nothing was booked on it.`);
    // ...and once retired, only the name can be changed.
    await expect(editForm(page).getByLabel("Name")).toBeVisible();
    await expect(editForm(page).getByLabel("Places in this pool")).toHaveCount(0);
    await expect(editForm(page).getByLabel("Skill level needed")).toHaveCount(0);
    await expect(page.getByText("A retired item can only be renamed.")).toBeVisible();
  });
});

test.describe("bringing an item back", () => {
  test("it is offered and bookable again, and its file keeps both lines, newest first", async ({ page }) => {
    const t = tag();
    const name = `Pw back ${t}`;
    await addItems(page, row(name, "Shell", "1", "None"));
    const path = await openItem(page, name, t);
    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("Sold");
    await page.getByRole("button", { name: `Retire ${name}` }).click();
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "retired");
    await page.goto("/club/book?day=2026-11-04&what=shell&kind=single&hour=7");
    await expect(page.locator(`[aria-label^="${name}, "]`)).toHaveCount(0);

    await page.goto(path);
    await page.getByRole("button", { name: `Bring ${name} back` }).click();
    await expect(page.getByTestId("action-ok")).toHaveText(`${name} is back. It can be booked again.`);
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "in_service");
    await expect(page.getByTestId("item-file-line")).toHaveCount(2);
    await expect(page.getByTestId("item-file-line").first()).toContainText("Brought back by Test staff. It can be booked again.");
    await expect(page.getByTestId("item-file-line").nth(1)).toContainText("Retired by Test staff. Reason: Sold. Nothing was booked on it.");
    await expect(page.getByRole("button", { name: `Retire ${name}` })).toBeVisible();
    await page.goto("/club/book?day=2026-11-04&what=shell&kind=single&hour=7");
    await expect(slot(page, name, "7:00 to 7:30 am", "free")).toHaveCount(1);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("the item page does not scroll sideways, even with a very long name, and its buttons are big enough to tap", async ({ page }) => {
    const t = tag();
    const name = `Pw phone ${t} ${"WM".repeat(18)}`;
    await addItems(page, row(name, "Shell", "1"));
    const path = await openItem(page, name, t);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(wide).toBeLessThanOrEqual(0);
    for (const button of [page.getByRole("button", { name: "Save changes" }), page.getByRole("button", { name: /^Retire / })]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.goto(`/club/equipment?find=${t}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // The boat is a club boat, so a coach's set-up form offers it with a tick box: that page must wrap the name too.
    await page.goto("/club/practices/new");
    await expect(page.getByTestId("practice-boats").getByText(name)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // Leave the shared server as it was: a boat with a name like that must not stay on other specs' pages.
    await page.goto(path);
    await page.getByTestId("retire-form").getByLabel("Why is it being retired?").fill("Test clean-up");
    await page.getByRole("button", { name: /^Retire / }).click();
    await expect(page.getByTestId("item-summary")).toHaveAttribute("data-status", "retired");
  });
});
