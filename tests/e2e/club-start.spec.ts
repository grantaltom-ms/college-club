import { expect, test } from "@playwright/test";
import { dashboardNav } from "./helpers";

/**
 * The CCS System landing page: where the dashboard's "CCS System" link goes. Four ways into the test build of the reservation
 * system: a test member, test staff, the snack bar iPad and the check-in iPad. It only exists in test builds (the hidden-site
 * checks in club-hidden.spec.ts prove it is "page not found" on the live site).
 */

const VIEWS = ["Test member view", "Test staff view", "Test iPad: honor snack bar", "Test iPad: check-in"];

test.describe("the CCS System landing page", () => {
  test("the dashboard's CCS System link opens it, and it offers the four views", async ({ page }) => {
    await page.goto("/");
    await dashboardNav(page).getByRole("link", { name: "CCS System" }).click();
    await expect(page).toHaveURL(/\/club\/start$/);
    await expect(page.getByRole("heading", { level: 1, name: "CCS System" })).toBeVisible();
    await expect(page.getByText("running on invented people and bookings")).toBeVisible();
    await expect(page.getByRole("list", { name: "Views to try" }).getByRole("heading", { level: 2 })).toHaveText(VIEWS);
    // It is a launcher: nobody is signed in as anyone yet, so it shows no member menu and no "acting as" line.
    await expect(page.getByTestId("acting-as")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Member area" })).toHaveCount(0);
  });

  test("the test member view signs in as an invented member and opens their household", async ({ page }) => {
    await page.goto("/club/start");
    await expect(page.getByTestId("start-member")).toContainText("You will be signed in as Nora Abernathy");
    await page.getByTestId("start-member-open").click();
    await expect(page).toHaveURL(/\/club$/);
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Nora Abernathy.");
    await expect(page.getByTestId("household-name")).toContainText("Abernathy");
  });

  test("the test staff view acts as Test staff and opens Today at the Club, where every member of staff lands", async ({ page }) => {
    await page.goto("/club/start");
    await page.getByTestId("start-staff-open").click();
    await expect(page).toHaveURL(/\/club\/today$/);
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
    await expect(page.getByRole("heading", { level: 1, name: "Today at the Club" })).toBeVisible();
  });

  test("going back and forth between the member and staff views, again and again, always lands on the right person", async ({ page }) => {
    for (let lap = 0; lap < 3; lap++) {
      await page.goto("/club/start");
      await page.getByTestId("start-member-open").click();
      await expect(page.getByTestId("acting-as")).toHaveText("Acting as Nora Abernathy.");
      await page.goto("/club/start");
      await page.getByTestId("start-staff-open").click();
      await expect(page.getByTestId("acting-as")).toHaveText("Acting as Test staff.");
      await expect(page).toHaveURL(/\/club\/today$/);
    }
  });

  test("the snack bar and check-in views open the real iPad screens in a new tab, and the landing page stays put", async ({ page }) => {
    await page.goto("/club/start");
    const addresses: string[] = [];
    for (const [testId, pattern, heading] of [
      ["start-snacks-open", /^\/club\/snacks\/[A-Za-z0-9_-]{43}$/, "Honor snack bar"],
      ["start-checkin-open", /^\/club\/ipad\/[A-Za-z0-9_-]{43}$/, "Who is checking in?"],
    ] as const) {
      const link = page.getByTestId(testId);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("href", pattern);
      addresses.push((await link.getAttribute("href"))!);
      const [tab] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
      await expect(tab.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      // The iPad screens have no menu and no way out, which is why they open apart from this page.
      await expect(tab.getByRole("navigation")).toHaveCount(0);
      await tab.close();
    }
    // Two different addresses: one leaking would not open the other.
    expect(new Set(addresses).size).toBe(2);
    await expect(page).toHaveURL(/\/club\/start$/);
  });

  test("a different test member can be picked, and the way back to the dashboard works", async ({ page }) => {
    await page.goto("/club/start");
    await page.getByTestId("start-member-other").click();
    await expect(page).toHaveURL(/\/club\/act-as$/);
    await expect(page.getByRole("heading", { level: 1, name: "Act as a test member" })).toBeVisible();
    await page.goto("/club/start");
    await page.getByTestId("start-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(dashboardNav(page)).toBeVisible();
  });

  test("on a phone nothing scrolls sideways and every button is big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/club/start");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const id of ["start-member-open", "start-staff-open", "start-snacks-open", "start-checkin-open"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("where the test picker sends you afterwards", () => {
  const post = (request: import("@playwright/test").APIRequestContext, form: Record<string, string>) =>
    request.post("/api/club/act-as", { form, maxRedirects: 0 });

  test("to a page inside the club, and never anywhere else", async ({ request, baseURL }) => {
    const here = new URL(baseURL!).origin;
    const inside = await post(request, { actor: "staff", next: "/club/admin" });
    expect(inside.status()).toBe(303);
    expect(new URL(inside.headers()["location"])).toMatchObject({ origin: here, pathname: "/club/admin" });
    expect(inside.headers()["set-cookie"]).toContain("ccs_test_actor=staff");

    // No page given, another site, a look-alike address, a page outside the club: all land on the club's home.
    for (const next of [undefined, "", "https://evil.example/x", "//evil.example/x", "/dashboard", "club/admin", "/clubhouse"]) {
      const res = await post(request, next === undefined ? { actor: "staff" } : { actor: "staff", next });
      expect(res.status(), String(next)).toBe(303);
      expect(new URL(res.headers()["location"]), String(next)).toMatchObject({ origin: here, pathname: "/club" });
    }
  });

  test("a made-up person is sent back to the picker whatever page was asked for", async ({ request, baseURL }) => {
    const res = await post(request, { actor: "member:00000000-0000-4000-8000-0000000fffff", next: "/club/admin" });
    expect(res.status()).toBe(303);
    expect(new URL(res.headers()["location"], baseURL!).pathname).toBe("/club/act-as");
    expect(res.headers()["set-cookie"] ?? "").not.toContain("ccs_test_actor");
  });
});
