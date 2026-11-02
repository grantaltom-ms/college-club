import { expect, test, type Page } from "@playwright/test";

/**
 * Incident reports: staff and coaches file one (what happened, when and where, who was involved and who was hurt, first aid, emergency
 * services); staff add what caused it and what will change, say who is following up, link a damage report and close it; a coach
 * sees only their own reports and never what staff wrote; nobody else can open any of it; and nothing about an incident shows on a
 * boat. Reports are never removed and the tests share one server, so every report carries its own unique words and each test finds
 * its own. Only invented members are used. The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026. Kenji
 * Tanaka is the sample club's coach; Dev Rao is never a coach; Britta Eriksen is named as someone involved.
 */

const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Waits for the page's scripts to have started, so a button pressed next is handled by the page and not sent as a plain form. */
const settled = (page: Page) => page.waitForLoadState("networkidle");

const yes = (page: Page, question: string) => page.getByRole("group", { name: question }).getByLabel("Yes").check();
const no = (page: Page, question: string) => page.getByRole("group", { name: question }).getByLabel("No").check();

/** Fills the short form the way a coach would, up to (not including) the button. */
async function fillForm(page: Page, what: string, opts: { hurtMember?: string; guest?: string; boat?: string; time?: string } = {}) {
  await page.goto("/club/incidents");
  await settled(page);
  await page.getByLabel("Time", { exact: true }).fill(opts.time ?? "10:30");
  await page.getByLabel("What happened?").fill(what);
  await page.getByLabel("Where? (optional)").fill("East dock");
  await yes(page, "Did it happen on the water?");
  if (opts.boat) await page.locator("#incident-boat-0").selectOption({ label: opts.boat });
  if (opts.hurtMember) {
    await page.getByTestId("incident-person-search").fill(opts.hurtMember.split(" ")[1]);
    await page.getByTestId("incident-person-result").filter({ hasText: opts.hurtMember }).click();
    await page.locator(`[data-testid="incident-person"][data-name="${opts.hurtMember}"]`).getByTestId("incident-hurt").check();
  }
  if (opts.guest) {
    await page.getByTestId("incident-typed-name").fill(opts.guest);
    await page.getByTestId("incident-add-typed").click();
  }
  await no(page, "Was first aid given?");
  await no(page, "Were emergency services called?");
}

/** A coach files a report, and the page says it was filed. */
async function fileAsCoach(page: Page, what: string, opts: Parameters<typeof fillForm>[2] = {}) {
  await actAs(page, "Kenji Tanaka");
  await fillForm(page, what, opts);
  await page.getByTestId("incident-submit").click();
  await expect(page.getByTestId("action-ok")).toContainText("The report is filed.");
}

const myReport = (page: Page, what: string) => page.locator(`[data-testid="my-incident"]`).filter({ hasText: what });
const queueRow = (page: Page, what: string) => page.locator(`[data-testid="incident-row"]`).filter({ hasText: what });

/** Staff open the report's own page from the open list. */
async function openAsStaff(page: Page, what: string) {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/incidents");
  await queueRow(page, what).getByRole("link").first().click();
  await expect(page.getByTestId("incident-report")).toContainText(what);
  await settled(page);
}

test.describe("filing a report", () => {
  test("a coach files with a member found by name, a typed guest, a boat and someone hurt; it shows on their list and on staff's queue, and the form clears", async ({ page }) => {
    const what = `Capsized off the dock ${tag()}`;
    const guest = `Guest${tag()} Example`;
    await actAs(page, "Kenji Tanaka");
    await fillForm(page, what, { hurtMember: "Britta Eriksen", guest, boat: "Pelican" });
    await expect(page.getByTestId("incident-person")).toHaveCount(2);
    await page.getByTestId("incident-submit").click();
    await expect(page.getByTestId("action-ok")).toHaveText("Thank you. The report is filed. Club staff will see it first because someone was hurt.");
    // The form clears, so the same report cannot be filed twice by a second press.
    await expect(page.getByLabel("What happened?")).toHaveValue("");
    await expect(page.getByTestId("incident-person")).toHaveCount(0);

    const mine = myReport(page, what);
    await expect(mine).toContainText("Open");
    await expect(mine).toContainText("East dock");
    await expect(mine).toContainText("Pelican");
    await expect(mine).toContainText("2 people named");

    await actAs(page, "Test staff");
    await page.goto("/club/admin/incidents");
    const row = queueRow(page, what);
    await expect(row).toContainText("1 hurt");
    await expect(row).toContainText("filed by Kenji Tanaka");
    await expect(row).toContainText("nobody following up");
    await row.getByRole("link").first().click();
    const report = page.getByTestId("incident-report");
    await expect(report).toContainText(what);
    await expect(report).toContainText("on the water");
    const britta = page.locator('[data-testid="incident-person"][data-name="Britta Eriksen"]');
    await expect(britta).toContainText("member");
    await expect(britta).toContainText("Hurt");
    await expect(page.locator(`[data-testid="incident-person"][data-name="${guest}"]`)).toContainText("not a member");
    await expect(page.getByTestId("incident-log")).toContainText("Reported by Kenji Tanaka. 1 person was hurt.");
  });

  test("the form says what is missing in the engine's own words, all at once, and keeps what was typed", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await settled(page);
    await page.getByLabel("Time", { exact: true }).fill("10:30");
    await page.getByLabel("What happened?").fill("   ");
    // The yes-or-no questions are required boxes, so the browser itself stops a form with one left blank; the engine's words are for
    // what the browser cannot know (here, a "what happened" of nothing but spaces).
    await yes(page, "Did it happen on the water?");
    await no(page, "Was first aid given?");
    await no(page, "Were emergency services called?");
    await page.getByTestId("incident-submit").click();
    await expect(page.getByTestId("action-error")).toHaveText("Say what happened.");
    await expect(page.getByLabel("Time", { exact: true })).toHaveValue("10:30");
    await expect(page.getByRole("group", { name: "Did it happen on the water?" }).getByLabel("Yes")).toBeChecked();
  });

  test("a form with a yes-or-no question left blank is stopped by the browser, and nothing is filed", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await settled(page);
    await page.getByLabel("Time", { exact: true }).fill("10:30");
    await page.getByLabel("What happened?").fill(`Never filed ${tag()}`);
    await page.getByTestId("incident-submit").click();
    await expect(page.getByTestId("action-ok")).toHaveCount(0);
    await expect(page.getByTestId("action-error")).toHaveCount(0);
    expect(await page.getByRole("group", { name: "Did it happen on the water?" }).getByLabel("Yes").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  });

  test("a member found by name is added once, a name can be taken off again, and the search wants three letters", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await settled(page);
    const search = page.getByTestId("incident-person-search");
    await search.fill("Br");
    await expect(page.getByTestId("incident-person-result")).toHaveCount(0);
    await search.fill("Britta");
    await page.getByTestId("incident-person-result").filter({ hasText: "Britta Eriksen" }).click();
    await expect(page.getByTestId("incident-person")).toHaveCount(1);
    // Someone already on the report is not offered again.
    await search.fill("Britta");
    await expect(page.getByText("No member found with that name.")).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("incident-person")).toHaveCount(0);
    // Taken off, she is offered again without typing the name again.
    await expect(page.getByTestId("incident-person-result").filter({ hasText: "Britta Eriksen" })).toHaveCount(1);
  });

  test("first aid and emergency notes only appear when the answer is yes", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await settled(page);
    await expect(page.getByLabel("Who gave it, and what was done? (optional)")).toHaveCount(0);
    await yes(page, "Was first aid given?");
    await expect(page.getByLabel("Who gave it, and what was done? (optional)")).toBeVisible();
    await no(page, "Was first aid given?");
    await expect(page.getByLabel("Who gave it, and what was done? (optional)")).toHaveCount(0);
    await yes(page, "Were emergency services called?");
    await expect(page.getByLabel("Which ones? (optional)")).toBeVisible();
  });

  test("staff can file one too, under their own name", async ({ page }) => {
    const what = `Cleat pulled out ${tag()}`;
    await actAs(page, "Test staff");
    await fillForm(page, what);
    await page.getByTestId("incident-submit").click();
    await expect(page.getByTestId("action-ok")).toHaveText("Thank you. The report is filed. Club staff will see it.");
    await page.goto("/club/admin/incidents");
    await expect(queueRow(page, what)).toContainText("filed by Test staff");
  });
});

test.describe("staff look into it", () => {
  test("staff record the cause, what will change and who is following up; the coach never sees it; staff close it and nothing more can change", async ({ page }) => {
    const what = `Near miss at the dock ${tag()}`;
    const cause = `Two boats came in together ${tag()}`;
    await fileAsCoach(page, what);

    await openAsStaff(page, what);
    const review = page.getByTestId("incident-review-form");
    await review.getByLabel("Cause", { exact: true }).fill(cause);
    await review.getByLabel("What will change so it does not happen again").fill("Post the dock rules.");
    await review.getByLabel("Who is following up").fill("Safety officer");
    await review.getByRole("button", { name: "Save what we found" }).click();
    await expect(review.getByTestId("action-ok")).toHaveText("Saved.");
    await expect(page.getByTestId("incident-log")).toContainText(`Reviewed by Test staff. Cause recorded: "${cause}".`);
    // A second save that changes nothing is refused in words.
    await review.getByRole("button", { name: "Save what we found" }).click();
    await expect(review.getByTestId("action-error")).toHaveText("Nothing was changed: what you gave is what the report already says.");
    await page.goto("/club/admin/incidents");
    await expect(queueRow(page, what)).toContainText("Safety officer is following up");

    // The coach reads their own report and none of what staff wrote.
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    const mine = myReport(page, what);
    await expect(mine).toBeVisible();
    for (const secret of [cause, "Post the dock rules.", "Safety officer"]) await expect(page.getByTestId("my-incident").filter({ hasText: what })).not.toContainText(secret);

    await openAsStaff(page, what);
    const close = page.getByTestId("incident-close-form");
    await close.getByLabel("What was done, or why nothing more is needed").fill("Dock rules posted.");
    await close.getByRole("button", { name: "Close the report" }).click();
    // The page refreshes and the close form goes with it, so the test waits for where the report ends up, not for the form's own note.
    await expect(page.getByTestId("incident-closed")).toContainText("Dock rules posted.");
    await expect(page.getByTestId("incident-review-form")).toHaveCount(0);
    await expect(page.getByTestId("incident-close-form")).toHaveCount(0);
    await expect(page.getByTestId("incident-log")).toContainText("Closed by Test staff: Dock rules posted.");

    // It moves to the closed list.
    await page.goto("/club/admin/incidents");
    await expect(queueRow(page, what)).toHaveCount(0);
    await page.goto("/club/admin/incidents?show=closed");
    await expect(queueRow(page, what)).toHaveAttribute("data-status", "closed");

    // The coach sees it as closed and can no longer add to it.
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await expect(myReport(page, what)).toHaveAttribute("data-status", "closed");
    await expect(myReport(page, what).getByTestId("incident-note-form")).toHaveCount(0);
  });

  test("staff link a damage report to an incident and take the link off again", async ({ page }) => {
    const what = `Bow cracked in a collision ${tag()}`;
    await fileAsCoach(page, what, { boat: "Pelican" });
    await openAsStaff(page, what);
    const review = page.getByTestId("incident-review-form");
    await review.getByLabel("Damage report this led to (optional)").selectOption({ index: 1 });
    await review.getByRole("button", { name: "Save what we found" }).click();
    await expect(review.getByTestId("action-ok")).toHaveText("Saved.");
    await expect(page.getByTestId("incident-damage-link")).toContainText("Damage report:");
    await expect(page.getByTestId("incident-log")).toContainText("Linked to the damage report on");
    await review.getByLabel("Damage report this led to (optional)").selectOption({ label: "None" });
    await review.getByRole("button", { name: "Save what we found" }).click();
    await expect(review.getByTestId("action-ok")).toHaveText("Saved.");
    await expect(page.getByTestId("incident-damage-link")).toHaveCount(0);
    await expect(page.getByTestId("incident-log")).toContainText("Link to the damage report removed.");
  });
});

test.describe("notes", () => {
  test("the coach who filed a report adds to it while it is open, and staff see the note in the log under the coach's name", async ({ page }) => {
    const what = `Rower felt dizzy ${tag()}`;
    const note = `The rower is fine now ${tag()}`;
    await fileAsCoach(page, what);
    await page.goto("/club/incidents");
    await settled(page);
    const mine = myReport(page, what);
    await mine.getByLabel("Add something to this report").fill(note);
    await mine.getByRole("button", { name: "Add note" }).click();
    await expect(mine.getByTestId("action-ok")).toHaveText("Note added.");
    await expect(mine).toContainText(note);
    // The form clears after it works.
    await expect(mine.getByLabel("Add something to this report")).toHaveValue("");

    await openAsStaff(page, what);
    await expect(page.getByTestId("incident-log")).toContainText(`${note}`);
    await expect(page.getByTestId("incident-log")).toContainText("Kenji Tanaka,");
    await page.getByLabel("A note for the log").fill("Spoke to the rower.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByTestId("incident-log")).toContainText("Spoke to the rower.");
  });
});

test.describe("who can open what", () => {
  test("an ordinary member, and a member who is not signed in, never reach any incident screen", async ({ page }) => {
    const what = `Hidden from members ${tag()}`;
    await fileAsCoach(page, what);
    await actAs(page, "Dev Rao");
    expect((await page.goto("/club/incidents"))?.status()).toBe(404);
    expect((await page.goto("/club/admin/incidents"))?.status()).toBe(404);
    expect((await page.goto("/club/admin/incidents/00000000-0000-4000-8000-0000000000ff"))?.status()).toBe(404);
    await page.goto("/club");
    await expect(page.getByRole("link", { name: "Report an incident" })).toHaveCount(0);
    expect(await page.content()).not.toContain(what);
    await page.context().clearCookies();
    await page.goto("/club/incidents");
    await expect(page.getByText("Sign in", { exact: false }).first()).toBeVisible();
    expect(await page.content()).not.toContain(what);
  });

  test("a coach reaches the form but not staff's list, and sees the menu link; staff reach both", async ({ page }) => {
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club");
    await expect(page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Report an incident" })).toBeVisible();
    expect((await page.goto("/club/incidents"))?.status()).toBe(200);
    await expect(page.getByRole("main")).toContainText("call 911 first and fill this in afterwards");
    expect((await page.goto("/club/admin/incidents"))?.status()).toBe(404);
    expect((await page.goto("/club/admin/incidents/00000000-0000-4000-8000-0000000000ff"))?.status()).toBe(404);
    await actAs(page, "Test staff");
    expect((await page.goto("/club/incidents"))?.status()).toBe(200);
    expect((await page.goto("/club/admin/incidents"))?.status()).toBe(200);
    expect((await page.goto("/club/admin/incidents/00000000-0000-4000-8000-0000000000ff"))?.status()).toBe(404);
  });

  test("another coach does not see a report Kenji filed, and an incident never shows on the boat's page", async ({ page }) => {
    const what = `Only for Kenji and staff ${tag()}`;
    await fileAsCoach(page, what, { boat: "Pelican" });
    await actAs(page, "Dev Rao");
    await page.goto("/club/book?day=2026-10-30&type=Shell");
    expect(await page.content()).not.toContain(what);
    await page.goto("/club/my-bookings");
    expect(await page.content()).not.toContain(what);
  });
});

test.describe("the staff office", () => {
  test("shows the incident board with what is open and who is hurt, and links to the list and the form", async ({ page }) => {
    const what = `Hurt wrist ${tag()}`;
    await fileAsCoach(page, what, { hurtMember: "Britta Eriksen" });
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const board = page.getByTestId("incident-board");
    await expect(board).toContainText("Incident reports");
    await expect(board).toContainText(/\d+ (is|are) open|\d+ open/);
    await expect(board).toContainText("with someone hurt");
    await expect(page.getByTestId("incident-top").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Incident reports", exact: true }).first()).toHaveAttribute("href", "/club/admin/incidents");
    await expect(page.getByRole("link", { name: "Report an incident", exact: true }).first()).toHaveAttribute("href", "/club/incidents");
  });

  test("the sample club has its three invented reports: a capsize with someone hurt, a dock incident, and a closed near-miss", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin/incidents");
    const capsize = queueRow(page, "The double flipped in a gust");
    await expect(capsize).toContainText("1 hurt");
    await expect(capsize).toContainText("Safety officer is following up");
    await expect(queueRow(page, "A cleat pulled out of the wood")).toContainText("nobody following up");
    await page.goto("/club/admin/incidents?show=closed");
    await expect(queueRow(page, "A launch came close to a kayak")).toHaveAttribute("data-status", "closed");
  });
});

test.describe("phone", () => {
  test("a phone-sized screen fits: no sideways scrolling on the form, the list and a report, and the buttons are big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/incidents");
    await settled(page);
    // A long name must not push the page sideways either.
    await page.getByTestId("incident-typed-name").fill("Maximilian-Alexander Wolfeschlegelsteinhausenbergerdorff");
    await page.getByTestId("incident-add-typed").click();
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await wide()).toBeLessThanOrEqual(0);
    expect((await page.getByTestId("incident-submit").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.getByRole("button", { name: "Remove" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await actAs(page, "Test staff");
    await page.goto("/club/admin/incidents");
    expect(await wide()).toBeLessThanOrEqual(0);
    await queueRow(page, "The double flipped in a gust").getByRole("link").first().click();
    await settled(page);
    expect(await wide()).toBeLessThanOrEqual(0);
    expect((await page.getByRole("button", { name: "Save what we found" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
