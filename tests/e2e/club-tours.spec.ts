import { expect, test, type Page } from "@playwright/test";

/**
 * The public Request a tour form and the staff's list of what visitors left (the design refresh, Oct 2026). Every test uses
 * its own invented name and address, so nothing here depends on, or disturbs, the other specs. The test server's clock stands
 * still, so the whole site can save at most 30 requests "an hour" for the whole run (and one address 3 a day): this file saves
 * only a handful.
 */

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAsStaff = async (page: Page) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: "Act as Test staff", exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
};

/** Fills in the public form (only the boxes given) and presses Send request. */
async function request(page: Page, who: { name?: string; email?: string; phone?: string; note?: string }) {
  await page.goto("/site/request-a-tour");
  if (who.name !== undefined) await page.getByLabel("Your name").fill(who.name);
  if (who.email !== undefined) await page.getByLabel("Email", { exact: true }).fill(who.email);
  if (who.phone !== undefined) await page.getByLabel(/^Phone/).fill(who.phone);
  if (who.note !== undefined) await page.getByLabel(/^Anything we should know/).fill(who.note);
  await page.getByRole("button", { name: "Send request" }).click();
}

/**
 * What the staff list says about the open requests, read from one moment of the page: the sentence's own count and how many
 * cards say "New". The list is shared by every test running at once, so a count can only be compared with the cards beside it,
 * never with an earlier visit.
 */
const openCounts = (page: Page) =>
  page.evaluate(() => ({
    said: Number((document.querySelector('[data-testid="tour-counts"]')?.textContent ?? "").split(" ")[0]),
    cards: [...document.querySelectorAll('[data-testid="tour-status"]')].filter((el) => el.textContent === "New").length,
  }));

const cardFor = (page: Page, name: string) => page.getByTestId("tour-request").filter({ has: page.getByRole("heading", { level: 3, name }) });

test.describe("the Request a tour page", () => {
  test("has one heading, labelled boxes with the optional ones marked, a Send request button, and the phone and email to use instead", async ({ page }) => {
    await page.goto("/site/request-a-tour");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request a tour");
    await expect(page.getByText("Tell us a little about yourself and the membership team will get back to you to arrange a visit.")).toBeVisible();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("type", "email");
    await expect(page.getByLabel(/^Phone/)).toHaveAttribute("type", "tel");
    await expect(page.getByText("(optional)")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
    await expect(page.getByText("Prefer to talk?")).toContainText("(206) 622-0624");
    await expect(page.getByRole("link", { name: "(206) 622-0624" }).first()).toHaveAttribute("href", "tel:2066220624");
    // The hidden box for robots is there, but nobody can reach it by keyboard or screen reader.
    const trap = page.locator("#tour-website");
    await expect(trap).toHaveAttribute("tabindex", "-1");
    await expect(page.locator(".ds-trap")).toHaveAttribute("aria-hidden", "true");
    expect((await trap.boundingBox())!.x).toBeLessThan(0);
  });

  test("names every problem next to its box, and keeps what was typed so nothing has to be typed again", async ({ page }) => {
    await request(page, {});
    await expect(page.getByRole("alert").filter({ hasText: "Please tell us your name." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "That email address does not look right." })).toBeVisible();
    await expect(page.getByTestId("tour-sent")).toHaveCount(0);

    await page.getByLabel("Your name").fill("Ada Quill");
    await page.getByLabel("Email", { exact: true }).fill("not an email");
    await page.getByLabel(/^Phone/).fill("call me");
    await page.getByLabel(/^Anything we should know/).fill("Two of us, evenings.");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That email address does not look right." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "That phone number does not look right." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Please tell us your name." })).toHaveCount(0);
    await expect(page.getByLabel("Your name")).toHaveValue("Ada Quill");
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("not an email");
    await expect(page.getByLabel(/^Phone/)).toHaveValue("call me");
    await expect(page.getByLabel(/^Anything we should know/)).toHaveValue("Two of us, evenings.");
    // The boxes that are wrong say so to screen readers too.
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Your name")).not.toHaveAttribute("aria-invalid", "true");
    expect(await page.getByLabel("Email", { exact: true }).getAttribute("aria-describedby")).toBe("tour-email-error");
  });

  test("thanks the person by first name, saves the request for staff, emails the membership office, and lets staff mark it followed up once", async ({ page, browser, baseURL }) => {
    const name = `Pippa Test${tag()}`;
    const email = `pippa.${tag()}@example.com`;
    await request(page, { name, email, phone: "(206) 555-0142", note: "Two of us.\nEvenings are best." });
    await expect(page.getByTestId("tour-sent")).toHaveText(`Thanks, ${name.split(" ")[0]}. We have your request, and the membership team will be in touch to arrange a visit.`);
    await expect(page.getByTestId("tour-form")).toHaveCount(0);

    // Staff see it, with everything the visitor gave.
    const staffContext = await browser.newContext({ baseURL });
    const staff = await staffContext.newPage();
    await actAsStaff(staff);
    await staff.goto("/club/admin");
    await staff.getByRole("link", { name: "Tour requests" }).click();
    await expect(staff).toHaveURL(/\/club\/admin\/tours$/);
    await expect(staff.getByRole("heading", { level: 1 })).toHaveText("Tour requests");
    await expect(staff.getByTestId("placeholder-note")).toContainText("Placeholder numbers");
    const card = cardFor(staff, name);
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("link", { name: email })).toHaveAttribute("href", `mailto:${email}`);
    await expect(card.getByRole("link", { name: "(206) 555-0142" })).toHaveAttribute("href", "tel:2065550142");
    await expect(card).toContainText("Two of us.");
    await expect(card).toContainText("Evenings are best.");
    expect(await card.locator("p", { hasText: "Two of us." }).evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
    await expect(card).toContainText("Received Oct 28, 2026");
    await expect(card.getByTestId("tour-status")).toHaveText("New");
    await expect(staff.getByTestId("tour-counts")).toHaveText(/^\d+ to follow up, \d+ in all\.$/);
    const before = await openCounts(staff);
    expect(before.said).toBe(before.cards);
    expect(before.cards).toBeGreaterThanOrEqual(1);

    // The membership office is told (in a test build the "email" is on the test outbox page).
    await staff.goto("/club/outbox");
    const mail = staff.getByTestId("outbox-message").filter({ hasText: `Name: ${name}` });
    await expect(mail).toHaveCount(1);
    await expect(mail).toContainText("To membership@collegeclubseattle.com");
    await expect(mail).toContainText(`New tour request: ${name}`);
    await expect(mail).toContainText(`Email: ${email}`);

    // Marking it followed up happens once, says who, and takes the button away.
    await staff.goto("/club/admin/tours");
    await cardFor(staff, name).getByRole("button", { name: `Mark ${name} as followed up` }).click();
    // The list refreshes by itself and the button, with its little "marked" note, goes with it, so wait for the end state
    // rather than for a note that can already be gone.
    await expect(cardFor(staff, name).getByTestId("tour-status")).toHaveText(/^Followed up by Test staff on Oct 28, 2026/);
    await staff.goto("/club/admin/tours");
    await expect(cardFor(staff, name).getByTestId("tour-status")).toHaveText(/^Followed up by Test staff on Oct 28, 2026/);
    await expect(cardFor(staff, name).getByRole("button")).toHaveCount(0);
    // The count leaves this one out: it still equals the cards that say "New" (others may be saving at the same time).
    const after = await openCounts(staff);
    expect(after.said).toBe(after.cards);
    await staffContext.close();
  });

  test("thanks a robot (the hidden box filled in) the same way and saves nothing", async ({ page, browser, baseURL }) => {
    const name = `Robot${tag()} Test`;
    await page.goto("/site/request-a-tour");
    await page.getByLabel("Your name").fill(name);
    await page.getByLabel("Email", { exact: true }).fill(`robot.${tag()}@example.com`);
    await page.locator("#tour-website").evaluate((el: HTMLInputElement) => {
      el.value = "http://spam.example";
    });
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByTestId("tour-sent")).toContainText("We have your request");

    const staffContext = await browser.newContext({ baseURL });
    const staff = await staffContext.newPage();
    await actAsStaff(staff);
    await staff.goto("/club/admin/tours");
    await expect(cardFor(staff, name)).toHaveCount(0);
    await staff.goto("/club/outbox");
    await expect(staff.getByTestId("outbox-message").filter({ hasText: name })).toHaveCount(0);
    await staffContext.close();
  });

  test("saves one address at most three times in a day, and thanks it the same way every time", async ({ page, browser, baseURL }) => {
    const name = `Repeat${tag()} Test`;
    const email = `repeat.${tag()}@example.com`;
    for (let i = 0; i < 5; i += 1) {
      await request(page, { name, email });
      await expect(page.getByTestId("tour-sent"), `request ${i + 1}`).toContainText("We have your request");
    }
    const staffContext = await browser.newContext({ baseURL });
    const staff = await staffContext.newPage();
    await actAsStaff(staff);
    await staff.goto("/club/admin/tours");
    await expect(cardFor(staff, name)).toHaveCount(3);
    await staffContext.close();
  });

  test("a request carrying a very long note is refused in words, not lost or cut", async ({ page }) => {
    // The box itself stops typing at 5,000 characters; 501 to 5,000 is told plainly.
    await request(page, { name: "Long Note", email: `long.${tag()}@example.com`, note: "n".repeat(501) });
    await expect(page.getByRole("alert").filter({ hasText: "Please keep your note to 500 characters or fewer." })).toBeVisible();
    await expect(page.getByLabel(/^Anything we should know/)).toHaveValue("n".repeat(501));
  });
});

test.describe("the staff list of tour requests", () => {
  test("is for staff: a member gets 'page not found', and someone not signed in is asked to sign in", async ({ page }) => {
    await page.goto("/club/admin/tours");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a test member");
    await expect(page.getByText("with your email address to see this page.")).toBeVisible();
    await expect(page.getByTestId("tour-list")).toHaveCount(0);

    await page.goto("/club/act-as");
    await page.getByRole("button", { name: /^Act as (?!Test staff)/ }).first().click();
    expect((await page.goto("/club/admin/tours"))!.status()).toBe(404);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the form fits the screen, with big boxes and a big button, and the staff list fits too", async ({ page, browser, baseURL }) => {
    await page.goto("/site/request-a-tour");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for (const box of await page.locator(".ds-input, .ds-textarea").all()) {
      if ((await box.getAttribute("tabindex")) === "-1") continue;
      expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      expect(await box.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px"); // 16 keeps iPhones from zooming in
      expect(await box.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("12px");
    }
    const send = (await page.getByRole("button", { name: "Send request" }).boundingBox())!;
    expect(send.height).toBeGreaterThanOrEqual(48);
    expect(send.x + send.width).toBeLessThanOrEqual(390);

    const staffContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const staff = await staffContext.newPage();
    await actAsStaff(staff);
    await staff.goto("/club/admin/tours");
    expect(await staff.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await staffContext.close();
  });
});
