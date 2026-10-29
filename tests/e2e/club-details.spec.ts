import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Staff correcting a person's details (name, email, phone). Every test makes its own household with its own addresses, so
 * nothing here depends on, or disturbs, the other specs' people. The test server's clock stands still, so one address can ask
 * for at most 5 sign-in links in "an hour" for the whole run: each test asks only a few times.
 */

const SENT = "If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in 15 minutes. If it does not arrive, check your spam folder.";
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAsStaff = async (page: Page) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: "Act as Test staff", exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
};

const submitUnchecked = async (page: Page, formTestId: string, buttonName: string) => {
  await page.getByTestId(formTestId).evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: buttonName }).click();
};

/** Staff add a household with one or two adults; returns the household page's address. */
async function addHousehold(page: Page, name: string, adults: { first: string; last: string; email: string }[]): Promise<string> {
  await page.goto("/club/admin/households/new");
  await page.getByLabel("Household name").fill(name);
  await page.locator("#firstName").fill(adults[0].first);
  await page.locator("#lastName").fill(adults[0].last);
  await page.locator("#email").fill(adults[0].email);
  if (adults[1]) {
    await page.locator("#firstName2").fill(adults[1].first);
    await page.locator("#lastName2").fill(adults[1].last);
    await page.locator("#email2").fill(adults[1].email);
  }
  await page.getByRole("button", { name: "Add household" }).click();
  await expect(page.getByTestId("changed")).toHaveText("Household added.");
  return new URL(page.url()).pathname;
}

/** The person's card on a household page. */
const card = (page: Page, fullName: string) => page.getByTestId("desk-adult").filter({ hasText: fullName });
const openEdit = async (page: Page, fullName: string) => {
  await card(page, fullName).getByTestId("edit-link").click();
  await expect(page.getByRole("heading", { level: 1, name: `Change details for ${fullName}` })).toBeVisible();
};

/** Asks for a link, opens it from the test outbox and presses the one button: signed in as the only person that address opens. */
async function signInByLink(page: Page, email: string, button: string) {
  await page.goto("/club/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByTestId("link-sent")).toHaveText(SENT);
  await page.goto("/club/outbox");
  await page.getByTestId("outbox-message").filter({ hasText: `To ${email}` }).first().getByTestId("outbox-link").click();
  await page.getByRole("button", { name: button, exact: true }).click();
}

const memberBrowser = async (browser: Browser, baseURL: string | undefined) => {
  const context = await browser.newContext({ baseURL });
  return { context, page: await context.newPage() };
};

test.describe("correcting a mistyped email", () => {
  test("staff fix it, the person is signed out everywhere, the old address stops working and the new one works", async ({ browser, baseURL, page }) => {
    const t = tag();
    const oldEmail = `ottoline.${t}@example.com`;
    const newEmail = `ottoline.${t}.fixed@example.com`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Pennywhistle ${t} household`, [{ first: "Ottoline", last: `Pennywhistle${t}`, email: oldEmail }]);
    const fullName = `Ottoline Pennywhistle${t}`;

    // The member signs in on two devices.
    const phone = await memberBrowser(browser, baseURL);
    const laptop = await memberBrowser(browser, baseURL);
    await signInByLink(phone.page, oldEmail, `Sign in as ${fullName}`);
    await expect(phone.page.getByTestId("acting-as")).toHaveText(`Signed in as ${fullName}.`);
    await signInByLink(laptop.page, oldEmail, `Sign in as ${fullName}`);
    await expect(laptop.page.getByTestId("acting-as")).toHaveText(`Signed in as ${fullName}.`);

    // Staff open the edit page: it shows what is on file, and says what a change of email does.
    await page.goto(household);
    await openEdit(page, fullName);
    await expect(page.getByLabel("First name")).toHaveValue("Ottoline");
    await expect(page.getByLabel("Email")).toHaveValue(oldEmail);
    await expect(page.locator("form")).toContainText("signed out of every device");

    // A mistake comes back with everything typed, and the club's own words.
    await page.getByLabel("Email").fill("ottoline-at-example");
    await page.getByLabel("Phone (optional)").fill("206-555-0147");
    await submitUnchecked(page, "edit-adult-form", "Save details");
    await expect(page.getByTestId("edit-problem")).toHaveText('"ottoline-at-example" does not look like an email address.');
    await expect(page.getByLabel("Email")).toHaveValue("ottoline-at-example");
    await expect(page.getByLabel("Phone (optional)")).toHaveValue("206-555-0147");
    // Nothing was saved and nobody was signed out by the mistake.
    await phone.page.goto("/club");
    await expect(phone.page.getByTestId("acting-as")).toHaveText(`Signed in as ${fullName}.`);

    // Fix it and save.
    await page.getByLabel("Email").fill(newEmail);
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByTestId("changed")).toContainText("Details saved");
    await expect(page.getByTestId("changed")).toContainText("signed out of every device");
    await expect(page.getByTestId("member-row").filter({ hasText: fullName })).toContainText(`${newEmail} · 206-555-0147`);
    const history = page.getByRole("list", { name: "Household history" });
    await expect(history).toContainText(`Details changed for ${fullName}: email from ${oldEmail} to ${newEmail}; phone from no number to 206-555-0147.`);

    // Both of their devices are signed out at once.
    for (const device of [phone.page, laptop.page]) {
      await device.goto("/club");
      await expect(device.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
      await expect(device.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Sign in" })).toBeVisible();
    }

    // The old address opens nothing: the page says the same as for anyone, and no new email appears (the two sent earlier stay).
    await phone.page.goto("/club/outbox");
    const sentBefore = await phone.page.getByTestId("outbox-message").filter({ hasText: `To ${oldEmail}` }).count();
    expect(sentBefore).toBe(2);
    await phone.page.goto("/club/sign-in");
    await phone.page.getByLabel("Email", { exact: true }).fill(oldEmail);
    await phone.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(phone.page.getByTestId("link-sent")).toHaveText(SENT);
    await phone.page.goto("/club/outbox");
    await expect(phone.page.getByTestId("outbox-message").filter({ hasText: `To ${oldEmail}` })).toHaveCount(sentBefore);

    // The new address works.
    await signInByLink(phone.page, newEmail, `Sign in as ${fullName}`);
    await expect(phone.page.getByTestId("acting-as")).toHaveText(`Signed in as ${fullName}.`);
    await phone.context.close();
    await laptop.context.close();
  });

  test("a sign-in link already sent to the old address stops working when the email is fixed", async ({ browser, baseURL, page }) => {
    const t = tag();
    const oldEmail = `perpetua.${t}@example.com`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Quillfeather ${t} household`, [{ first: "Perpetua", last: `Quillfeather${t}`, email: oldEmail }]);
    const fullName = `Perpetua Quillfeather${t}`;

    const member = await memberBrowser(browser, baseURL);
    await member.page.goto("/club/sign-in");
    await member.page.getByLabel("Email", { exact: true }).fill(oldEmail);
    await member.page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await member.page.goto("/club/outbox");
    const link = await member.page.getByTestId("outbox-message").filter({ hasText: `To ${oldEmail}` }).first().getByTestId("outbox-link").getAttribute("href");

    await page.goto(household);
    await openEdit(page, fullName);
    await page.getByLabel("Email").fill(`perpetua.${t}.fixed@example.com`);
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByTestId("changed")).toContainText("Details saved");

    await member.page.goto(link!);
    await expect(member.page.getByRole("button", { name: `I am ${fullName}`, exact: true })).toHaveCount(0);
    await expect(member.page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await member.context.close();
  });
});

test.describe("correcting a name or phone", () => {
  test("keeps the person signed in, shows the new details everywhere, and writes the old and new to the file", async ({ browser, baseURL, page }) => {
    const t = tag();
    const email = `rosalind.${t}@example.com`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Fennimore ${t} household`, [{ first: "Rosalind", last: `Fennimore${t}`, email }]);
    const member = await memberBrowser(browser, baseURL);
    await signInByLink(member.page, email, `Sign in as Rosalind Fennimore${t}`);

    await page.goto(household);
    await openEdit(page, `Rosalind Fennimore${t}`);
    await page.getByLabel("First name").fill("Roz");
    await page.getByLabel("Phone (optional)").fill("206-555-0166");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByTestId("changed")).toHaveText("Details saved. The change is in the household's file.");
    await expect(page.getByTestId("changed")).not.toContainText("signed out");
    await expect(page.getByTestId("member-row")).toContainText(`Roz Fennimore${t}`);
    await expect(page.getByRole("list", { name: "Household history" })).toContainText(`Details changed for Rosalind Fennimore${t}: name from Rosalind Fennimore${t} to Roz Fennimore${t}; phone from no number to 206-555-0166.`);

    // Still signed in, now under the new name, on their own pages.
    await member.page.goto("/club");
    await expect(member.page.getByTestId("acting-as")).toHaveText(`Signed in as Roz Fennimore${t}.`);
    await expect(member.page.getByTestId("household-facts")).toBeVisible();
    await member.context.close();
  });

  test("says so, and writes nothing, when nothing was changed", async ({ page }) => {
    const t = tag();
    await actAsStaff(page);
    const household = await addHousehold(page, `The Oddsworth ${t} household`, [{ first: "Barnaby", last: `Oddsworth${t}`, email: `barnaby.${t}@example.com` }]);
    await page.goto(household);
    await openEdit(page, `Barnaby Oddsworth${t}`);
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByTestId("edit-notice")).toHaveText("Nothing was changed: those are already the details on file.");
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Household history" })).not.toContainText("Details changed");
  });

  test("works again and again: five corrections in a row are all on the file, in order, and the person can still sign in", async ({ browser, baseURL, page }) => {
    const t = tag();
    const email = `thaddeus.${t}@example.com`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Merriweather ${t} household`, [{ first: "Thaddeus", last: `Merriweather${t}`, email }]);
    const fullName = `Thaddeus Merriweather${t}`;
    for (let i = 1; i <= 5; i++) {
      await page.goto(household);
      await openEdit(page, fullName);
      await page.getByLabel("Phone (optional)").fill(`206-555-010${i}`);
      await page.getByRole("button", { name: "Save details" }).click();
      await expect(page.getByTestId("changed")).toContainText("Details saved");
    }
    const lines = page.getByRole("list", { name: "Household history" }).getByText(/^Details changed for/);
    await expect(lines).toHaveCount(5);
    await expect(lines.first()).toContainText("phone from 206-555-0104 to 206-555-0105");
    await expect(lines.last()).toContainText("phone from no number to 206-555-0101");
    const member = await memberBrowser(browser, baseURL);
    await signInByLink(member.page, email, `Sign in as ${fullName}`);
    await expect(member.page.getByTestId("acting-as")).toHaveText(`Signed in as ${fullName}.`);
    await member.context.close();
  });
});

test.describe("two partners on one address", () => {
  test("fixing one partner's email signs out only that partner", async ({ browser, baseURL, page }) => {
    const t = tag();
    const shared = `hargreaves.${t}@example.com`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Hargreaves ${t} household`, [
      { first: "Imogen", last: `Hargreaves${t}`, email: shared },
      { first: "Jasper", last: `Hargreaves${t}`, email: shared },
    ]);
    const imogenName = `Imogen Hargreaves${t}`;
    const jasperName = `Jasper Hargreaves${t}`;
    const imogen = await memberBrowser(browser, baseURL);
    const jasper = await memberBrowser(browser, baseURL);
    await signInByLink(imogen.page, shared, `I am ${imogenName}`);
    await signInByLink(jasper.page, shared, `I am ${jasperName}`);

    await page.goto(household);
    await openEdit(page, jasperName);
    await page.getByLabel("Email").fill(`jasper.${t}@example.com`);
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByTestId("changed")).toContainText("signed out of every device");

    await imogen.page.goto("/club");
    await expect(imogen.page.getByTestId("acting-as")).toHaveText(`Signed in as ${imogenName}.`);
    await jasper.page.goto("/club");
    await expect(jasper.page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
    await imogen.context.close();
    await jasper.context.close();
  });
});

test.describe("who can do it", () => {
  test("only staff: a member finds neither the link nor the page nor the handler", async ({ page }) => {
    const t = tag();
    await actAsStaff(page);
    const household = await addHousehold(page, `The Abernethy ${t} household`, [
      { first: "Cordelia", last: `Abernethy${t}`, email: `cordelia.${t}@example.com` },
      { first: "Dominic", last: `Abernethy${t}`, email: `dominic.${t}@example.com` },
    ]);
    await page.goto(household);
    const editHref = await card(page, `Cordelia Abernethy${t}`).getByTestId("edit-link").getAttribute("href");
    const members = await page.getByTestId("desk-adult").evaluateAll((els) => els.length);
    expect(members).toBe(2);
    const memberId = editHref!.split("/").at(-2)!;
    const householdId = household.split("/").pop()!;

    await page.goto("/club/act-as");
    await page.getByRole("button", { name: "Act as Nora Abernathy", exact: true }).click();
    // The page is not found, the household is not even theirs to see, and a forged post is refused and changes nothing.
    expect((await page.goto(editHref!))?.status()).toBe(404);
    const forged = await page.request.post("/api/club/households/update-member", {
      form: { household: householdId, member: memberId, firstName: "Cordelia", lastName: `Abernethy${t}`, email: "hijack@example.com", phone: "" },
      maxRedirects: 0,
    });
    expect(forged.status()).toBe(303);
    expect(forged.headers()["location"]).toContain("notice=forbidden");

    await actAsStaff(page);
    await page.goto(household);
    await expect(page.getByTestId("member-row").filter({ hasText: `Cordelia Abernethy${t}` })).toContainText(`cordelia.${t}@example.com`);
    await expect(page.getByRole("list", { name: "Household history" })).not.toContainText("Details changed");
  });

  test("a person who has left, or whose household ended, cannot be edited", async ({ page }) => {
    const t = tag();
    await actAsStaff(page);
    const household = await addHousehold(page, `The Wickersham ${t} household`, [
      { first: "Evangeline", last: `Wickersham${t}`, email: `evangeline.${t}@example.com` },
      { first: "Fitzroy", last: `Wickersham${t}`, email: `fitzroy.${t}@example.com` },
    ]);
    await page.goto(household);
    const fitzEdit = await card(page, `Fitzroy Wickersham${t}`).getByTestId("edit-link").getAttribute("href");
    const evangelineEdit = await card(page, `Evangeline Wickersham${t}`).getByTestId("edit-link").getAttribute("href");

    await card(page, `Fitzroy Wickersham${t}`).getByTestId("remove-link").click();
    await page.getByRole("button", { name: `Yes, remove Fitzroy Wickersham${t}` }).click();
    await expect(page.getByTestId("changed")).toContainText("Adult removed");
    await page.goto(fitzEdit!);
    await expect(page.getByText("is no longer on this household's membership, so their details cannot be changed.")).toBeVisible();
    await expect(page.getByTestId("edit-adult-form")).toHaveCount(0);

    await page.goto(`${household.replace("/club/household/", "/club/admin/households/")}/end`);
    await page.getByRole("button", { name: /^Yes, end/ }).click();
    await expect(page.getByTestId("changed")).toContainText("Membership ended");
    await page.goto(evangelineEdit!);
    await expect(page.getByText("This membership has ended, so nothing in it can be changed.")).toBeVisible();
    await expect(page.getByTestId("edit-adult-form")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test("the edit page fits a narrow screen with big fields and no sideways scrolling", async ({ browser, baseURL, page }) => {
    // A long, wide surname on purpose (the tag ends up in it): a name that cannot break must not push the page sideways.
    const t = `wmwmwm${tag()}`;
    await actAsStaff(page);
    const household = await addHousehold(page, `The Pemberley ${t} household`, [{ first: "Gwendolyn", last: `Pemberley${t}`, email: `gwendolyn.${t}@example.com` }]);
    await page.goto(household);
    const href = await card(page, `Gwendolyn Pemberley${t}`).getByTestId("edit-link").getAttribute("href");
    const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 700 } });
    const small = await context.newPage();
    await small.goto("/club/act-as");
    await small.getByRole("button", { name: "Act as Test staff", exact: true }).click();
    await small.goto(href!);
    await expect(small.getByLabel("Email")).toBeVisible();
    const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await small.getByRole("button", { name: "Save details" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    await context.close();
  });
});
