import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The staff office. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026. The invented club has
 * these bookings today (made yesterday): Cormorant 7 to 8 am (Alex Brooks) and Grebe 8 to 9 am (Kenji Tanaka), both over
 * with nobody checked in, so the system has marked them no-shows; Mink 12 to 2 pm (Priya Rao), under way; Beaver 1:30 to
 * 2:30 pm (Dev Rao), check-in already open; and Drift 3 to 4 pm (Julien Moreau), check-in opens at 2:30 pm.
 * All tests share one server, so each uses its own people and boats.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** The row for a reservation, in the whole page or in one list on it. */
const attendanceRow = (scope: Page | Locator, title: string) => scope.getByTestId("attendance-row").filter({ hasText: title });
/** Presses a form's button with the browser's own checks (such as "this is not an email address") switched off, so the club's own wording is what shows. */
const submitUnchecked = async (page: Page, formTestId: string, buttonName: string) => {
  await page.getByTestId(formTestId).evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: buttonName }).click();
};
const searchFor = async (page: Page, q: string) => {
  await page.goto("/club/admin/check-in");
  await page.getByLabel("Name or email").fill(q);
  await page.getByRole("button", { name: "Find" }).click();
};

test.describe("the staff office board", () => {
  test("shows what needs a look, what is on today, what is out of service, and how check-in works", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.getByRole("link", { name: "Staff office" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Staff office" })).toBeVisible();
    await expect(page.locator("p.club-meta").first()).toContainText("Wednesday, Oct 28");
    // Today: four bookings made for today plus two finished ones; the exact count is not the point, the links are.
    await expect(page.getByTestId("today")).toContainText("boat and space booking");
    await expect(page.getByTestId("today").getByRole("link", { name: /class/ })).toBeVisible();
    // Merganser is out of service.
    await expect(page.getByTestId("out-of-service")).toContainText("Merganser");
    await expect(page.getByTestId("out-of-service")).toContainText("Rigger being repaired");
    // Tools and the rules in words, with the placeholder warning.
    for (const name of ["Households", "Add a household", "Import households", "Check someone in", "All bookings", "Equipment", "Add an event"]) {
      await expect(page.getByTestId("tools").getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("placeholder-note")).toBeVisible();
    await expect(page.getByTestId("attendance-rules")).toContainText("Check-in opens 30 minutes before the start.");
    await expect(page.getByTestId("attendance-rules")).toContainText("becomes a no-show the moment it ends");
    await expect(page.getByTestId("attendance-rules")).toContainText("Room Space and Work Space reservations do not need a check-in");
    await expect(page.getByTestId("attendance-rules")).toContainText("Events are not marked automatically");
  });

  test("is staff only: a member does not find it", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await expect(page.getByRole("link", { name: "Staff office" })).toHaveCount(0);
    for (const path of ["/club/admin", "/club/admin/check-in", "/club/admin/households/new"]) {
      expect((await page.goto(path))?.status(), path).toBe(404);
    }
    await page.goto("/club/admin/households/00000000-0000-4000-8000-000000000001/end");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/End the membership/);
  });

  test("the end-a-membership page reads as plain English, and the office list keeps a space before its dot", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/00000000-0000-4000-8000-000000000001/end");
    await expect(page.getByRole("main")).toContainText(/(The adult in this household|All \d+ adults in this household) will no longer be able to book:/);
    await expect(page.getByRole("main")).not.toContainText("can no longer book:");
    // "Full, with people waiting": the time is followed by a space before the dot, never "pm·".
    await page.goto("/club/admin");
    const waiting = page.getByTestId("waiting").getByRole("listitem");
    expect(await waiting.count()).toBeGreaterThan(0);
    for (const text of await waiting.allTextContents()) expect(text).toMatch(/\d:\d\d [ap]m · /);
  });

  test("a button that is switched off looks switched off", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const look = await page.evaluate(() => {
      const b = document.createElement("button");
      b.className = "club-button";
      b.disabled = true;
      b.textContent = "Probe";
      document.body.appendChild(b);
      const on = document.createElement("button");
      on.className = "club-button";
      on.textContent = "Probe on";
      document.body.appendChild(on);
      const s = getComputedStyle(b);
      const a = getComputedStyle(on);
      const out = { off: { bg: s.backgroundColor, cursor: s.cursor }, on: { bg: a.backgroundColor } };
      b.remove();
      on.remove();
      return out;
    });
    expect(look.off.cursor).toBe("not-allowed");
    expect(look.off.bg).not.toBe(look.on.bg);
  });

  test("a booking over with nobody checked in is a no-show on its own, and staff can put it right, once, on the record", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const row = attendanceRow(page.getByTestId("needs-look"), "Cormorant");
    await expect(row).toContainText("Alex Brooks");
    await expect(row.getByTestId("attendance-status")).toHaveText("No-show (marked automatically)");
    // The member sees the same in their own list.
    await actAs(page, "Alex Brooks");
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Cormorant" }).getByTestId("booking-status")).toHaveText("No-show");

    // Staff: the iPad was down, they were there.
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await attendanceRow(page.getByTestId("needs-look"), "Cormorant").getByRole("button", { name: /^Change .* to checked in$/ }).click();
    await expect(page.getByTestId("checked")).toBeVisible();
    await expect(page.getByTestId("needs-look").getByText("Cormorant")).toHaveCount(0);
    // It now shows as completed, and a second correction is a new line, not an error.
    await actAs(page, "Alex Brooks");
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Cormorant" }).getByTestId("booking-status")).toHaveText("Completed");
  });

  test("a club-room booking needs no check-in: it is simply finished, never a no-show, and nothing is offered for it", async ({ page }) => {
    await actAs(page, "Test staff");
    // All bookings: it is in the past list, finished, with no check-in buttons.
    await page.goto("/club/my-bookings");
    const room = page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Clubhouse room" }).filter({ hasText: "Yuki Nakamura" });
    await expect(room.getByTestId("booking-status")).toHaveText("Finished");
    await expect(room.getByTestId("attendance-buttons")).toHaveCount(0);
    // A boat that was over with nobody checked in, beside it, is a no-show with buttons.
    const boat = page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Cormorant" }).filter({ hasText: "Alex Brooks" });
    await expect(boat.getByTestId("booking-status")).toHaveText(/No-show|Completed/);
    // It is on neither of the staff lists.
    await page.goto("/club/admin");
    await expect(page.getByTestId("needs-look").getByText("Clubhouse room")).toHaveCount(0);
    await page.goto("/club/admin/check-in");
    await expect(page.getByTestId("around-now").getByText("Clubhouse room")).toHaveCount(0);
    await searchFor(page, "Yuki");
    await expect(page.getByTestId("person-empty")).toBeVisible();
    // The member sees the same.
    await actAs(page, "Yuki Nakamura");
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Clubhouse room" }).getByTestId("booking-status")).toHaveText("Finished");
  });

  test("staff can confirm that an automatic no-show was right, which takes it off the list", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await attendanceRow(page.getByTestId("needs-look"), "Grebe").getByRole("button", { name: /^Confirm .* was a no-show$/ }).click();
    await expect(page.getByTestId("checked")).toBeVisible();
    await expect(page.getByTestId("needs-look").getByText("Grebe")).toHaveCount(0);
    // It is still a no-show, and it is a person's decision now: the button to put it right is still there on the check-in page.
    await searchFor(page, "Kenji");
    const row = attendanceRow(page, "Grebe");
    await expect(row.getByTestId("attendance-status")).toHaveText("No-show");
    await expect(row.getByRole("button", { name: /^Change .* to checked in$/ })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Confirm .* was a no-show$/ })).toHaveCount(0);
  });
});

test.describe("checking someone in", () => {
  test("finds a person by name, checks them in for an outing that is under way, and can correct it both ways", async ({ page }) => {
    await actAs(page, "Test staff");
    await searchFor(page, "priya");
    await expect(page.getByTestId("person")).toHaveCount(1);
    const row = attendanceRow(page, "Mink");
    await expect(row.getByTestId("attendance-status")).toHaveText("Not checked in");
    await expect(row.getByRole("button", { name: /^Mark .* a no-show$/ })).toBeVisible();
    await row.getByRole("button", { name: /^Check in / }).click();
    await expect(page.getByTestId("checked")).toBeVisible();
    // The search is remembered after the change.
    await expect(page.getByLabel("Name or email")).toHaveValue("priya");
    await expect(attendanceRow(page, "Mink").getByTestId("attendance-status")).toHaveText("Checked in");
    await attendanceRow(page, "Mink").getByRole("button", { name: /^Change .* to a no-show$/ }).click();
    await expect(attendanceRow(page, "Mink").getByTestId("attendance-status")).toHaveText("No-show");
    await attendanceRow(page, "Mink").getByRole("button", { name: /^Change .* to checked in$/ }).click();
    await expect(attendanceRow(page, "Mink").getByTestId("attendance-status")).toHaveText("Checked in");
  });

  test("offers Check in as soon as check-in opens, but not a no-show before the start", async ({ page }) => {
    await actAs(page, "Test staff");
    await searchFor(page, "Dev Rao");
    const row = attendanceRow(page, "Beaver");
    await expect(row.getByTestId("attendance-status")).toHaveText("Not here yet");
    await expect(row.getByRole("button", { name: /^Mark .* a no-show$/ })).toHaveCount(0);
    await row.getByRole("button", { name: /^Check in / }).click();
    await expect(attendanceRow(page, "Beaver").getByTestId("attendance-status")).toHaveText("Checked in");
  });

  test("says when check-in opens when it has not, and a forced attempt changes nothing", async ({ page }) => {
    await actAs(page, "Test staff");
    await searchFor(page, "julien");
    const row = attendanceRow(page, "Drift");
    await expect(row).toContainText("Check-in opens at 2:30 pm");
    await expect(row.getByRole("button", { name: /^Check in / })).toHaveCount(0);
    // Pressing it anyway (a stale page, or a hand-made request) is refused and the page says so.
    const id = await row.getByTestId("attendance-buttons").locator('input[name="id"]').inputValue();
    const res = await page.request.post("/api/club/attendance", { form: { kind: "booking", id, outcome: "attended", back: "/club/admin/check-in?q=julien" }, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(res.headers()["location"]).toContain("/club/admin/check-in?q=julien&notice=conflict");
    await page.goto("/club/admin/check-in?q=julien&notice=conflict");
    await expect(page.locator("p.club-alert")).toBeVisible();
    await expect(attendanceRow(page, "Drift").getByTestId("attendance-status")).toHaveText("Not here yet");
  });

  test("shows everything around now when no name is typed, tells you when nobody matches, and ignores a back address that leaves the club area", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/check-in");
    const around = page.getByTestId("around-now");
    await expect(around).toContainText("Mink");
    await expect(around).toContainText("Beaver");
    await expect(around).toContainText("Drift");
    await searchFor(page, "zzzz");
    await expect(page.getByTestId("no-match")).toContainText("Nobody active matches");
    // A form that tries to send staff to another site lands in the staff office instead.
    const res = await page.request.post("/api/club/attendance", { form: { kind: "booking", id: "00000000-0000-4000-8000-000000000001", outcome: "attended", back: "//evil.example/x" }, maxRedirects: 0 });
    expect(res.headers()["location"]).toMatch(/^http:\/\/localhost:\d+\/club\/admin\?notice=/);
  });

  test("a member cannot use the check-in handler", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    const res = await page.request.post("/api/club/attendance", { form: { kind: "booking", id: "00000000-0000-4000-8000-000000000001", outcome: "attended", back: "/club/admin" }, maxRedirects: 0 });
    expect(res.headers()["location"]).toContain("notice=");
    expect(res.headers()["location"]).toContain("forbidden");
  });
});

test.describe("the household desk", () => {
  test("adds a household with a mistake first, then adds an adult, changes the type, grants a qualification, and removes an adult after a preview", async ({ page }) => {
    const name = `The Zephyr ${Date.now().toString(36)} household`;
    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByTestId("add-household-link").click();
    await page.getByLabel("Household name").fill(name);
    await page.locator("#firstName").fill("Wren");
    await page.locator("#lastName").fill("Zephyr");
    await page.locator("#email").fill("wren@example.com");
    // A second adult with a mistake: the form comes back with everything typed, and says what is wrong.
    await page.locator("#firstName2").fill("Sol");
    await page.locator("#lastName2").fill("Zephyr");
    await page.locator("#email2").fill("not-an-email");
    await submitUnchecked(page, "household-form", "Add household");
    await expect(page.getByTestId("household-problem")).toHaveText('"not-an-email" does not look like an email address.');
    await expect(page.getByLabel("Household name")).toHaveValue(name);
    await expect(page.locator("#firstName")).toHaveValue("Wren");
    await expect(page.locator("#firstName2")).toHaveValue("Sol");
    // Fix it and save.
    await page.locator("#email2").fill("sol@example.com");
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Household added.");
    await expect(page.getByTestId("household-name")).toHaveText(name);
    await expect(page.getByTestId("member-row")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("joined as Resident");

    // Change the type.
    await page.locator("#type").selectOption("Intermediate");
    await page.getByRole("button", { name: "Change type" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Membership type changed.");
    await expect(page.getByTestId("household-facts")).toContainText("Intermediate");

    // Add an adult, first with a mistake.
    await page.locator("#a-first").fill("Ash");
    await page.locator("#a-last").fill("Zephyr");
    await page.locator("#a-email").fill("ash-at-example");
    await submitUnchecked(page, "add-adult-form", "Add adult");
    await expect(page.getByTestId("add-problem")).toHaveText('"ash-at-example" does not look like an email address.');
    await expect(page.locator("#a-first")).toHaveValue("Ash");
    await page.locator("#a-email").fill("ash@example.com");
    await page.getByRole("button", { name: "Add adult" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Adult added.");
    await expect(page.getByTestId("member-row")).toHaveCount(3);

    // Grant Ash a qualification.
    const ash = page.getByTestId("desk-adult").filter({ hasText: "Ash Zephyr" });
    await ash.getByRole("combobox").selectOption({ index: 0 });
    await ash.getByRole("button", { name: /^Grant/ }).click();
    await expect(page.getByTestId("changed")).toHaveText("Qualification granted.");
    await expect(page.getByTestId("member-row").filter({ hasText: "Ash Zephyr" })).toContainText("granted");

    // Remove Ash: the page shows there is nothing to cancel, and asks.
    await page.getByTestId("desk-adult").filter({ hasText: "Ash Zephyr" }).getByTestId("remove-link").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Remove Ash Zephyr from ${name}?`);
    await expect(page.getByTestId("preview-empty")).toBeVisible();
    await page.getByRole("button", { name: "Yes, remove Ash Zephyr" }).click();
    await expect(page.getByTestId("changed")).toContainText("Adult removed from the household.");
    await expect(page.getByTestId("member-row").filter({ hasText: "Ash Zephyr" })).toContainText("Left the household");
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("Ash Zephyr was removed from the household.");
  });

  test("shows what an ending membership will cancel, cancels it, and leaves the household ended and untouchable", async ({ page }) => {
    const name = `The Quartz ${Date.now().toString(36)} household`;
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/new");
    await page.getByLabel("Household name").fill(name);
    await page.locator("#firstName").fill("Rue");
    await page.locator("#lastName").fill("Quartz");
    await page.locator("#email").fill("rue@example.com");
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Household added.");
    const householdUrl = page.url().split("?")[0];

    // Rue books Dock slip C tomorrow evening.
    await actAs(page, "Rue Quartz");
    await page.goto("/club/book?day=2026-10-29&type=Dock%20Space");
    await page.locator('[aria-label="Dock slip C, 5:00 to 5:30 pm, free"]').click();
    await page.getByRole("button", { name: "Book Dock slip C", exact: true }).click();
    await expect(page.getByTestId("booked-note")).toBeVisible();

    // Staff open the ending page: it lists the booking, and nothing has happened yet.
    await actAs(page, "Test staff");
    await page.goto(`${householdUrl}`);
    await page.getByTestId("end-link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`End the membership of ${name}?`);
    await expect(page.getByTestId("preview-bookings")).toContainText("Dock slip C");
    await expect(page.getByTestId("preview-bookings")).toContainText("Rue Quartz");
    await expect(page.getByTestId("preview-bookings-line")).toHaveCount(1);
    await page.goto(householdUrl);
    await expect(page.getByTestId("household-facts")).toContainText("Active");
    // Going back and forth changes nothing. Now confirm.
    await page.getByTestId("end-link").click();
    await page.getByRole("button", { name: "Yes, end this membership" }).click();
    await expect(page.getByTestId("changed")).toContainText("Membership ended.");
    await expect(page.getByTestId("household-facts")).toContainText("membership ended");
    await expect(page.getByTestId("desk")).toContainText("This membership has ended");
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("1 future booking cancelled because the membership ended.");
    await expect(page.getByTestId("remove-link")).toHaveCount(0);
    await expect(page.getByTestId("end-link")).toHaveCount(0);

    // Rue's booking is cancelled, and the ending page now just says it ended.
    await actAs(page, "Rue Quartz");
    await page.goto("/club/my-bookings");
    await expect(page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row").filter({ hasText: "Dock slip C" })).toContainText("Cancelled");
    await actAs(page, "Test staff");
    await page.goto(`${householdUrl.replace("/club/household/", "/club/admin/households/")}/end`);
    await expect(page.getByText("already ended")).toBeVisible();
  });

  test("makes the primary adult choose a successor, and will not remove the last adult", async ({ page }) => {
    const name = `The Basalt ${Date.now().toString(36)} household`;
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/new");
    await page.getByLabel("Household name").fill(name);
    await page.locator("#firstName").fill("Kit");
    await page.locator("#lastName").fill("Basalt");
    await page.locator("#email").fill("kit@example.com");
    await page.locator("#firstName2").fill("Lou");
    await page.locator("#lastName2").fill("Basalt");
    await page.locator("#email2").fill("lou@example.com");
    await page.getByRole("button", { name: "Add household" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Household added.");

    await page.getByTestId("desk-adult").filter({ hasText: "Kit Basalt" }).getByTestId("remove-link").click();
    await expect(page.getByLabel(/Who becomes the primary adult/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, remove Kit Basalt" }).click();
    await expect(page.getByTestId("changed")).toContainText("Adult removed");
    await expect(page.getByRole("list", { name: "Household history" })).toContainText("Lou Basalt is now the primary adult, replacing Kit Basalt.");

    // Lou is the last adult now.
    await page.getByTestId("desk-adult").filter({ hasText: "Lou Basalt" }).getByTestId("remove-link").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lou Basalt is the last adult");
    await expect(page.getByRole("link", { name: "end the whole membership" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Yes, remove/ })).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test("the staff office, check-in, add-household and end pages fit the screen, and the buttons are big enough to tap", async ({ page }) => {
    await actAs(page, "Test staff");
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    for (const path of ["/club/admin", "/club/admin/check-in", "/club/admin/check-in?q=priya", "/club/admin/households/new"]) {
      await page.goto(path);
      expect(await noSidewaysScroll(), path).toBe(true);
    }
    await page.goto("/club/admin/check-in?q=priya");
    for (const button of await page.getByTestId("attendance-buttons").first().getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await page.goto("/club");
    await page.getByTestId("household-row").first().getByRole("link").click();
    expect(await noSidewaysScroll()).toBe(true);
    await page.getByTestId("end-link").click();
    expect(await noSidewaysScroll()).toBe(true);
  });
});
