import { expect, test, type Page } from "@playwright/test";

/**
 * The list builder on the Email page, end to end, against a server whose Mailchimp and Claude are the stand-in in
 * scripts/fake-email-apis.ts (port 3107). Nothing here reaches the real Mailchimp or Claude, and every person is invented.
 */
const APP = "http://localhost:3106";
const FAKE = "http://localhost:3107";
const PASSWORD = "playwright-only-lists-0001";

test.use({ baseURL: APP });
test.describe.configure({ mode: "serial" });

interface FakeView {
  campaigns: { id: string; web_id: number; body: { settings: { title: string; subject_line: string }; recipients: { segment_opts: { saved_segment_id: number } } }; html?: string }[];
  segments: { id: number; name: string; members: string[] }[];
  calls: string[];
}
async function fakeState(page: Page): Promise<FakeView> {
  return (await page.request.get(`${FAKE}/fake/state`)).json();
}

async function unlock(page: Page) {
  await page.goto("/email");
  const card = page.getByRole("region", { name: "Build an email list" });
  await card.getByLabel("Password").fill(PASSWORD);
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByLabel("Describe the members you want")).toBeVisible();
  return card;
}

test.beforeAll(async ({ request }) => {
  await request.post(`${FAKE}/fake/reset`);
});

test("the list builder is locked until the list password is typed", async ({ page }) => {
  await page.goto("/email");
  const card = page.getByRole("region", { name: "Build an email list" });
  await expect(card.getByLabel("Describe the members you want")).toHaveCount(0);
  await expect(card).not.toContainText("Sample ");
  // The server refuses too, not just the page.
  const api = await page.request.post("/api/email-lists/preview", { data: { rule: { joinedWithinMonths: 3 } }, headers: { origin: APP } });
  expect(api.status()).toBe(401);

  await card.getByLabel("Password").fill("not-the-password");
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByRole("alert")).toContainText("That password is not right");
  await card.getByLabel("Password").fill(PASSWORD);
  await card.getByRole("button", { name: "Unlock" }).click();
  await expect(card.getByLabel("Describe the members you want")).toBeVisible();

  // The campaign figures are still below, folded.
  await expect(page.getByRole("heading", { name: "How the emails are doing" })).toBeVisible();
});

test("describe members, check who they are, save the list, then draft the email in Mailchimp", async ({ page }) => {
  const card = await unlock(page);
  await card.getByLabel("Describe the members you want").fill("Members that joined within the last three months that indicated interest in rowing");
  await card.getByRole("button", { name: "Find members" }).click();

  const words = card.getByTestId("lists-words");
  await expect(words).toContainText("Joined in the last 3 months");
  await expect(words).toContainText("Said they are interested in rowing");
  const who = card.getByRole("table", { name: "Who will get the email" });
  for (const name of ["Sample Avery Lindqvist", "Sample Brooke Okafor", "Sample Casey Moreau", "Sample Finley Brooks"]) {
    await expect(who).toContainText(name);
  }
  await expect(who).not.toContainText("Sample Emery Tanaka");
  await expect(card.getByTestId("lists-count")).toContainText("1 has no subscribed email address");

  // Brooke got the Watercooler yesterday: warned, and can be left out.
  const recent = card.getByTestId("lists-recent");
  await expect(recent).toContainText("1 of them got a campaign in the last 7 days");
  await recent.getByLabel(/Leave out anyone who got a campaign/).click();
  await expect(card.getByTestId("lists-recent")).toContainText("1 household is left out");
  await expect(card.getByRole("table", { name: "Who will get the email" })).not.toContainText("Sample Brooke Okafor");
  await recent.getByLabel(/Leave out anyone who got a campaign/).click();
  await expect(card.getByRole("table", { name: "Who will get the email" })).toContainText("Sample Brooke Okafor");

  await card.getByLabel("Name for this list").fill("Erg class interest");
  await card.getByRole("button", { name: "Save as a Mailchimp list" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Saved." })).toContainText('tag in Mailchimp called "Auto: Erg class interest"');

  const tag = (await fakeState(page)).segments.find((s) => s.name === "Auto: Erg class interest")!;
  expect(tag.members).toContain("avery.lindqvist@example.org");
  expect(tag.members).toContain("brooke.okafor@example.org");
  expect(tag.members).not.toContain("emery.tanaka@example.org");

  const saved = card.getByRole("article", { name: "Saved list: Erg class interest" });
  await saved.getByLabel("What should the email say?").fill("trying to put together a member organized erg workout class that gets together once or twice per week");
  await saved.getByRole("button", { name: "Draft the email in Mailchimp" }).click();
  const draft = saved.getByLabel("Draft email");
  await expect(draft).toContainText("Nothing has been sent.");
  await expect(draft).toContainText("A member erg class, once or twice a week");
  const link = draft.getByRole("link", { name: "Open the draft in Mailchimp" });
  await expect(link).toHaveAttribute("href", /^https:\/\/us1\.admin\.mailchimp\.com\/campaigns\/edit\?id=\d+$/);

  const state = await fakeState(page);
  const campaign = state.campaigns.at(-1)!;
  expect(campaign.body.recipients.segment_opts.saved_segment_id).toBe(tag.id);
  expect(campaign.html).toContain("&lt;every week&gt;");
  expect(campaign.html).toContain("*|UNSUB|*");
  expect(state.calls.some((c) => /\/actions\/(send|schedule)/.test(c))).toBe(false);
});

test("a description with a part no filter covers says so, and the filters can be changed by hand", async ({ page }) => {
  const card = await unlock(page);
  await card.getByLabel("Describe the members you want").fill("intermediate members who joined in the last 6 months and are left-handed");
  await card.getByRole("button", { name: "Find members" }).click();
  await expect(card.getByRole("note").filter({ hasText: "Not used" })).toContainText("left-handed");
  await expect(card.getByTestId("lists-words")).toContainText("Membership type: Intermediate");
  await card.getByText("Change the filters by hand").click();
  await card.getByRole("checkbox", { name: "Resident", exact: true }).check();
  await card.getByRole("button", { name: "Show members for these filters" }).click();
  await expect(card.getByTestId("lists-words")).toContainText("Membership type: Intermediate or Resident");
});

test("a list can be built with the filters alone, with no description and no Claude", async ({ page }) => {
  const card = await unlock(page);
  const claudeBefore = (await fakeState(page)).calls.filter((c) => /messages/.test(c)).length;
  await card.getByRole("button", { name: "Set the filters by hand instead" }).click();
  const filters = card.getByRole("region", { name: "Filters set by hand" }).or(card.getByLabel("Filters set by hand"));
  await filters.getByRole("checkbox", { name: "Intermediate", exact: true }).check();
  await filters.getByRole("button", { name: "Show members for these filters" }).click();
  await expect(card.getByTestId("lists-words")).toContainText("Membership type: Intermediate");
  await expect(card.getByRole("table", { name: "Who will get the email" })).toBeVisible();
  await card.getByLabel("Name for this list").fill("Intermediate by hand");
  await card.getByRole("button", { name: "Save as a Mailchimp list" }).click();
  await expect(card.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(card.getByRole("article", { name: "Saved list: Intermediate by hand" })).toBeVisible();
  expect((await fakeState(page)).calls.filter((c) => /messages/.test(c)).length).toBe(claudeBefore);
});

test("saving several lists and drafting to each keeps working (repeated use)", async ({ page }) => {
  const card = await unlock(page);
  const before = (await fakeState(page)).campaigns.length;
  for (let i = 1; i <= 3; i++) {
    await card.getByLabel("Describe the members you want").fill(`members who joined in the last ${i + 2} months`);
    await card.getByRole("button", { name: "Find members" }).click();
    await expect(card.getByTestId("lists-words")).toContainText(`Joined in the last ${i + 2} months`);
    await card.getByLabel("Name for this list").fill(`Repeat list ${i}`);
    await card.getByRole("button", { name: "Save as a Mailchimp list" }).click();
    await expect(card.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    const saved = card.getByRole("article", { name: `Saved list: Repeat list ${i}` });
    await saved.getByLabel("What should the email say?").fill(`a note to the repeat list number ${i}`);
    await saved.getByRole("button", { name: "Draft the email in Mailchimp" }).click();
    await expect(saved.getByLabel("Draft email")).toContainText("Nothing has been sent.");
    await saved.getByRole("button", { name: "Refresh now" }).click();
    await expect(saved.getByRole("status").filter({ hasText: "Refreshed:" })).toContainText("0 added, 0 taken off");
  }
  // A second list with the same name is refused.
  await card.getByLabel("Describe the members you want").fill("members who joined in the last 3 months");
  await card.getByRole("button", { name: "Find members" }).click();
  await card.getByLabel("Name for this list").fill("Repeat list 1");
  await card.getByRole("button", { name: "Save as a Mailchimp list" }).click();
  await expect(card.getByRole("alert")).toContainText('There is already a list called "Repeat list 1"');
  expect((await fakeState(page)).campaigns.length).toBe(before + 3);
  // The page still opens cleanly with every list on it.
  await page.reload();
  await expect(page.getByRole("article", { name: /^Saved list: / })).toHaveCount(5);
});

test("the nightly refresh needs its secret", async ({ request }) => {
  expect((await request.get(`${APP}/api/email-lists/refresh-all`)).status()).toBe(401);
  const ok = await request.get(`${APP}/api/email-lists/refresh-all`, { headers: { authorization: "Bearer playwright-only-cron-secret-0001" } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.failed).toBe(0);
  expect(body.refreshed).toBeGreaterThanOrEqual(1);
});

test("locking the list builder hides it again", async ({ page }) => {
  const card = await unlock(page);
  await card.getByRole("button", { name: "Lock the list builder on this device" }).click();
  await expect(card.getByRole("status")).toContainText("The list builder is locked on this device.");
  await expect(card.getByLabel("Describe the members you want")).toHaveCount(0);
});
