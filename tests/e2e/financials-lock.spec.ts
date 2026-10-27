import { expect, test } from "@playwright/test";
import { FINANCIALS_PASSWORD, unlockFinancials } from "./helpers";

// The test server serves the invented sample figures (CCS_ALLOW_SAMPLE_DATA=1), so these tests use the real
// /api/financials endpoint, not a mock: the point is that the endpoint itself refuses a browser without the password.
const SWITCH_OFF = "http://localhost:3101";

test.describe("the Financials password", () => {
  test("a stranger with the link sees only the password box, and the figures endpoint refuses them", async ({ page, baseURL }) => {
    await page.goto("/financials");
    await expect(page.getByRole("heading", { level: 1, name: "Financials." })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByText("This device stays unlocked for 30 days.")).toBeVisible();
    await expect(page.getByTestId("finance-table")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Net income");
    // Plain fetch carries no cookies, like someone who has only the address.
    const res = await fetch(`${baseURL}/api/financials`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Financials is locked. Type the Financials password to see these figures." });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("a wrong password is refused in words and the page stays locked", async ({ page }) => {
    await page.goto("/financials");
    for (const wrong of ["guess", FINANCIALS_PASSWORD.toUpperCase(), `${FINANCIALS_PASSWORD}x`]) {
      await page.getByLabel("Password").fill(wrong);
      await page.getByRole("button", { name: "Unlock" }).click();
      await expect(page.locator("p.status-error[role=alert]")).toHaveText("That password is not right. Check it and try again.");
      await expect(page.getByTestId("finance-table")).toHaveCount(0);
    }
    expect((await page.context().cookies()).find((c) => c.name === "ccs_financials")).toBeUndefined();
  });

  test("the right password shows the figures, stays unlocked across visits, and Lock locks it again", async ({ page, context }) => {
    await unlockFinancials(page);
    await expect(page.getByTestId("finance-table")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);

    // The pass is a cookie scripts on the page cannot read, kept for 30 days.
    const pass = (await context.cookies()).find((c) => c.name === "ccs_financials");
    expect(pass?.httpOnly).toBe(true);
    expect(pass?.sameSite).toBe("Lax");
    const days = ((pass?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(await page.evaluate(() => document.cookie)).not.toContain("ccs_financials");

    // Coming back over and over, and to other pages and back, it stays open.
    for (let lap = 0; lap < 5; lap++) {
      await page.goto("/");
      await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Financials" }).click();
      await expect(page.getByTestId("finance-table")).toBeVisible();
    }
    expect((await page.request.get("/api/financials")).status()).toBe(200);

    await page.getByRole("button", { name: "Lock Financials on this device" }).click();
    await expect(page.getByText("Financials is locked on this device.")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByTestId("finance-table")).toHaveCount(0);
    expect((await page.request.get("/api/financials")).status()).toBe(401);
  });

  test("unlocking and locking many times keeps working", async ({ page }) => {
    for (let round = 0; round < 4; round++) {
      await unlockFinancials(page);
      await expect(page.getByTestId("finance-table")).toBeVisible();
      await page.getByRole("button", { name: "Lock Financials on this device" }).click();
      await expect(page.getByLabel("Password")).toBeVisible();
    }
  });

  test("a made-up or tampered pass opens nothing", async ({ page, context, baseURL }) => {
    for (const value of ["1", "yes", `${Date.now() + 86_400_000}.${"0".repeat(64)}`]) {
      await context.clearCookies();
      await context.addCookies([{ name: "ccs_financials", value, url: baseURL! }]);
      await page.goto("/financials");
      await expect(page.getByLabel("Password")).toBeVisible();
      expect((await page.request.get("/api/financials")).status()).toBe(401);
    }
  });

  test("a password form posted from another website is refused", async ({ baseURL }) => {
    for (const path of ["/api/financials/unlock", "/api/financials/lock"]) {
      const res = await fetch(`${baseURL}${path}`, {
        method: "POST",
        redirect: "manual",
        headers: { origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
        body: `password=${FINANCIALS_PASSWORD}`,
      });
      expect(res.status, path).toBe(403);
      expect(res.headers.get("set-cookie"), path).toBeNull();
    }
  });

  test("the password box fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto("/financials");
    await expect(page.getByLabel("Password")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByLabel("Password").fill(FINANCIALS_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByTestId("finance-table")).toBeVisible();
  });

  test("with no password set up, the page is locked for everyone and says how to set it up", async () => {
    // The switch-off server has no DASHBOARD_FINANCIALS_PASSWORD.
    const page = await (await fetch(`${SWITCH_OFF}/financials`)).text();
    expect(page).toContain("The Financials password has not been set up yet");
    expect(page).not.toContain('name="password"');
    expect((await fetch(`${SWITCH_OFF}/api/financials`)).status).toBe(401);
    const unlock = await fetch(`${SWITCH_OFF}/api/financials/unlock`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${FINANCIALS_PASSWORD}`,
    });
    expect(unlock.status).toBe(303);
    expect(unlock.headers.get("location")).toContain("/financials?wrong=1");
    expect(unlock.headers.get("set-cookie")).toBeNull();
  });
});
