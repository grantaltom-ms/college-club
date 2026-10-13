import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { E2E_PASSWORD } from "../../playwright.config";
import { sampleData } from "../../src/lib/sample";

/** Serve the invented sample club from the data endpoint, so no test touches the real database. */
export async function mockDashboard(page: Page) {
  const body = JSON.stringify(sampleData());
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

/** Opens the members page and signs in with the test password. */
export async function openMembers(page: Page) {
  await page.goto("/members");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Show members" }).click();
  await expect(page.getByText("Showing 1–25 of 550 members")).toBeVisible();
}
