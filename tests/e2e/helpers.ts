import type { Page } from "@playwright/test";
import { sampleData } from "../../src/lib/sample";
import { sampleShells } from "../../src/lib/shells";
import { sampleEmail } from "../../src/lib/mailchimp";
import { sampleMembership } from "../../src/lib/membership";

/** Serve the invented sample club from the data endpoint, so no test touches the real database. */
export async function mockDashboard(page: Page) {
  const body = JSON.stringify(sampleData());
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

/** Serve invented shell outings, emails and membership counts too, for the summary page that reads every source. */
export async function mockAll(page: Page) {
  await mockDashboard(page);
  const shells = JSON.stringify(sampleShells());
  const email = JSON.stringify(sampleEmail());
  const membership = JSON.stringify(sampleMembership());
  await page.route("**/api/shells", (route) => route.fulfill({ status: 200, contentType: "application/json", body: shells }));
  await page.route("**/api/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: email }));
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body: membership }));
}

/** The test server's Financials password (playwright.config.ts). */
export const FINANCIALS_PASSWORD = "playwright-only-financials-0001";

/** Type the Financials password, as a board member would, and land on the unlocked page. */
export async function unlockFinancials(page: Page) {
  await page.goto("/financials");
  await page.getByLabel("Password").fill(FINANCIALS_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.waitForURL("**/financials");
}
