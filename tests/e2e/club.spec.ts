import { expect, test, type Page } from "@playwright/test";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

test("a visitor with no test member chosen is pointed to the picker", async ({ page }) => {
  await page.goto("/club");
  await expect(page).toHaveTitle("College Club Seattle: members (test build)");
  await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  await expect(page.getByRole("banner").getByRole("link", { name: "College Club Seattle" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Every household, member and booking here is invented");
  await page.getByRole("link", { name: "Choose a test member" }).click();
  await expect(page).toHaveURL("/club/act-as");
});

test("acting as a member shows their household, the adults in it, their qualifications and the household history", async ({ page }) => {
  await actAs(page, "Erik Lindqvist");
  await expect(page).toHaveURL("/club");
  await expect(page.getByTestId("household-name")).toHaveText("The Lindqvist household");
  await expect(page.getByTestId("household-facts")).toContainText("Resident · joined May 14, 2011");
  const rows = page.getByTestId("member-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Erik Lindqvist");
  await expect(rows.first()).toContainText("Primary adult");
  await expect(rows.first().getByRole("list", { name: "Qualifications for Erik Lindqvist" })).toContainText("Sculling level 3 (placeholder)");
  await expect(rows.first().getByRole("list", { name: "Qualifications for Erik Lindqvist" })).toContainText("by Test staff");
  await expect(rows.nth(1)).toContainText("Maren Lindqvist");
  await expect(rows.nth(1)).toContainText("Additional adult");
  await expect(rows.first().getByTestId("booking-status")).toHaveText("Can make new bookings.");
  // A member does not see the staff-only link slots.
  await expect(page.getByLabel("Linked accounts for Erik Lindqvist")).toHaveCount(0);
  const history = page.getByRole("list", { name: "Household history" });
  await expect(history.getByRole("listitem")).toHaveCount(5); // joined, 2 adults added, 2 qualifications
  await expect(history.getByRole("listitem").last()).toContainText("The Lindqvist household joined as Resident.");
});

test("a household whose membership ended shows every adult as blocked, with the reason", async ({ page }) => {
  await actAs(page, "Colm Fitzgerald");
  await expect(page.getByTestId("household-facts")).toContainText("membership ended");
  const rows = page.getByTestId("member-row");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute("data-status", "household_ended");
    await expect(row.getByTestId("booking-status")).toContainText("Cannot book: This household's membership ended on");
  }
  await expect(page.getByRole("list", { name: "Household history" }).getByRole("listitem").first()).toContainText("Membership ended on");
});

test("partners can share an email address and a three-adult household lists all three", async ({ page }) => {
  await actAs(page, "Camille Moreau");
  await expect(page.getByText("moreau.family@example.com")).toHaveCount(2);
  await actAs(page, "Hollis Whitcombe");
  await expect(page.getByTestId("member-row")).toHaveCount(3);
});

test("staff see every household and can open any of them, with the staff-only records", async ({ page }) => {
  await actAs(page, "Test staff");
  await expect(page.getByRole("heading", { level: 1, name: "Households" })).toBeVisible();
  // The 14 invented households, plus any that other tests on this shared server have added through the staff desk.
  expect(await page.getByTestId("household-row").count()).toBeGreaterThanOrEqual(14);
  await expect(page.getByRole("link", { name: "The Lindqvist household" })).toBeVisible();
  await page.getByRole("link", { name: "The Nakamura household" }).click();
  await expect(page.getByTestId("household-name")).toHaveText("The Nakamura household");
  await expect(page.getByLabel("Household records")).toContainText("QuickBooks ID");
  await expect(page.getByLabel("Linked accounts for Yuki Nakamura")).toContainText("Brivo credential");
  await expect(page.getByLabel("Linked accounts for Yuki Nakamura")).toContainText("not linked yet");
});

test("a member can open their own household's address but not anyone else's", async ({ page }) => {
  await actAs(page, "Test staff");
  await page.goto("/club");
  const links = await page.getByTestId("household-row").getByRole("link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href")!));
  expect(links.length).toBeGreaterThanOrEqual(14); // the 14 invented ones, plus any other tests have added
  await actAs(page, "Erik Lindqvist");
  // Every address is asked for directly (with this member's cookie) instead of being opened in the browser. The staff list also holds
  // every household that other tests have added, hundreds by the end of a full run, and opening each in a browser took almost the
  // whole time limit. The one that answers is then opened in the browser to check it is the right household.
  const answers: { href: string; status: number }[] = [];
  for (let i = 0; i < links.length; i += 10) {
    answers.push(...(await Promise.all(links.slice(i, i + 10).map(async (href) => ({ href, status: (await page.request.get(href)).status() })))));
  }
  const open = answers.filter((a) => a.status === 200);
  expect(answers.filter((a) => a.status !== 200 && a.status !== 404), "every address answers 200 or 404").toEqual([]);
  expect(open).toHaveLength(1);
  await page.goto(open[0].href);
  await expect(page.getByTestId("household-name")).toHaveText("The Lindqvist household");
});

test("switching between test members again and again always shows the right person and household", async ({ page }) => {
  const who: [string, string][] = [
    ["Erik Lindqvist", "The Lindqvist household"],
    ["Tomas Vandermeer", "The Vandermeer household"],
    ["Kenji Tanaka", "The Tanaka-Brooks household"],
    ["Walter Pemberton", "The Pemberton household"],
    ["Yuki Nakamura", "The Nakamura household"],
    ["Aoife Fitzgerald", "The Fitzgerald household"],
  ];
  for (let round = 0; round < 4; round++) {
    for (const [name, household] of who) {
      await actAs(page, name);
      await expect(page.getByTestId("household-name")).toHaveText(household);
    }
  }
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: "Stop acting as anyone" }).click();
  await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  await expect(page.getByRole("button", { name: "Stop acting as anyone" })).toHaveCount(0);
});

test("the picker lists every household and adult, and the active ones can all be chosen", async ({ page }) => {
  await page.goto("/club/act-as");
  // The 14 invented households have 24 adults; tests that add households through the staff desk only ever add more.
  expect(await page.getByTestId("act-as-household").count()).toBeGreaterThanOrEqual(14);
  expect(await page.getByRole("button", { name: /^Act as / }).count()).toBeGreaterThanOrEqual(1 + 24); // test staff + the 24 invented adults
});

test("a forged or broken test-member cookie is treated as nobody", async ({ page, context, baseURL }) => {
  for (const value of ["admin", "member:not-an-id", "member:11111111-1111-4111-8111-111111111111", "STAFF", "staff-extra"]) {
    await context.addCookies([{ name: "ccs_test_actor", value, url: baseURL! }]);
    const res = await page.goto("/club");
    expect(res?.status(), value).toBe(200);
    await expect(page.getByTestId("acting-as")).toHaveText("Not acting as anyone.");
  }
});

test("the member area has its own header and none of the dashboard's navigation, and the dashboard has no member links", async ({ page }) => {
  await page.goto("/club");
  await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Member area" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Dashboard sections" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Member area" })).toHaveCount(0);
  await expect(page.getByText("Test build.")).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("the picker, the household page and the staff list fit without sideways scrolling", async ({ page }) => {
    const noSidewaysScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await page.goto("/club/act-as");
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Hollis Whitcombe");
    expect(await noSidewaysScroll()).toBe(true);
    await actAs(page, "Test staff");
    expect(await noSidewaysScroll()).toBe(true);
    // Buttons are big enough to tap.
    await page.goto("/club/act-as");
    const box = await page.getByRole("button", { name: "Act as Test staff" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
