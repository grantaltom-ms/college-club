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

/* ---------- The Reservations screen's start-time dropdowns (Nov 7) ---------- */

/**
 * One start time in an item's dropdown, found by the words a screen reader gives it: "Heron, 9:00 to 9:30 am, free",
 * "Dock slip A, 8:00 to 8:30 am, 4 of 4 places left", "Boathouse gym, 7:00 to 7:30 pm, Core class". It is an <option>, so a
 * free one is enabled and anything else is disabled; its text carries what holds it ("7:00 am · Sasha Bellweather" for staff).
 */
export const slot = (page: Page, item: string, range: string, words: string) => page.locator(`option[aria-label="${item}, ${range}, ${words}"]`);

/** The dropdown form for one item on the Reservations screen. */
export const startPick = (page: Page, item: string) => page.locator(`[data-testid="start-pick"][data-item="${item}"]`);

/** Choose that start time in the item's dropdown and press Book, as a member would. Ends on the booking form. */
export async function pickSlot(page: Page, item: string, range: string, words = "free") {
  const value = await slot(page, item, range, words).getAttribute("value");
  if (!value) throw new Error(`no start time "${item}, ${range}, ${words}" to choose`);
  const form = startPick(page, item);
  await form.locator("select").selectOption(value);
  await form.getByRole("button", { name: `Book ${item} at the chosen time` }).click();
  // The form is a plain GET, a full page load rather than a client-side hop, so wait until the booking form is really there.
  await page.waitForURL(/\/club\/book\/new\?/);
}

/** The booking form's own address for that start time: exactly where pressing Book would go. */
export async function slotHref(page: Page, item: string, range: string, words = "free"): Promise<string> {
  const value = await slot(page, item, range, words).getAttribute("value");
  const itemId = await startPick(page, item).locator('input[name="item"]').getAttribute("value");
  if (!value || !itemId) throw new Error(`no start time "${item}, ${range}, ${words}" to open`);
  return `/club/book/new?${new URLSearchParams({ item: itemId, start: value }).toString()}`;
}
