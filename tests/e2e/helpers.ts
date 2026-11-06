import type { Page } from "@playwright/test";
import { sampleData } from "../../src/lib/sample";
import { sampleShells } from "../../src/lib/shells";
import { sampleEvents } from "../../src/lib/events";
import { sampleEmail } from "../../src/lib/mailchimp";
import { sampleMembership } from "../../src/lib/membership";
import { sampleReservations } from "../../src/lib/reservations";

/** Serve the invented sample club from the data endpoint, so no test touches the real database. */
export async function mockDashboard(page: Page) {
  const body = JSON.stringify(sampleData());
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

/** Serve invented shell outings, reservations, emails, membership counts and events too, for the summary page that reads every source. */
export async function mockAll(page: Page) {
  await mockDashboard(page);
  const shells = JSON.stringify(sampleShells());
  const email = JSON.stringify(sampleEmail());
  const membership = JSON.stringify(sampleMembership());
  const reservations = JSON.stringify(sampleReservations());
  const events = JSON.stringify(sampleEvents());
  await page.route("**/api/shells", (route) => route.fulfill({ status: 200, contentType: "application/json", body: shells }));
  await page.route("**/api/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: email }));
  await page.route("**/api/membership", (route) => route.fulfill({ status: 200, contentType: "application/json", body: membership }));
  await page.route("**/api/reservations", (route) => route.fulfill({ status: 200, contentType: "application/json", body: reservations }));
  await page.route("**/api/events", (route) => route.fulfill({ status: 200, contentType: "application/json", body: events }));
}

/** The dashboard's menu bar. */
export const dashboardNav = (page: Page) => page.getByRole("navigation", { name: "Dashboard sections" });

/** Opens one of the two top-level menus (Usage, or Board Materials) and returns it, ready to pick a page from. */
export async function openNavMenu(page: Page, label: "Usage" | "Board Materials") {
  await dashboardNav(page).getByRole("button", { name: label }).click();
  return dashboardNav(page).getByRole("menu", { name: label });
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
