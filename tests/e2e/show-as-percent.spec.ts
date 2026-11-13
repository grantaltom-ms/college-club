import { expect, test, type Locator, type Page } from "@playwright/test";
import { sampleShells } from "../../src/lib/shells";
import { sampleReservations } from "../../src/lib/reservations";
import { sampleMembership } from "../../src/lib/membership";
import { formatShare, readCell } from "../../src/lib/percent-table";
import { mockDashboard } from "./helpers";

/** Invented sample data only, so no test touches the real database. */
async function mockAll(page: Page) {
  const serve = (pattern: string, data: unknown) =>
    page.route(pattern, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }));
  await serve("**/api/shells*", sampleShells());
  await serve("**/api/reservations", sampleReservations());
  await serve("**/api/membership", sampleMembership());
}

/** The table's body cells as text, one list per row. */
const cells = (card: Locator) =>
  card
    .getByRole("table")
    .locator("tbody tr")
    .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())));

const percentButton = (card: Locator) => card.getByRole("button", { name: "Show as %" });
const numbersButton = (card: Locator) => card.getByRole("button", { name: "Show numbers" });

test("Show as % turns a column of outings into each hour's share, and back, again and again", async ({ page }) => {
  await mockAll(page);
  await page.goto("/shells");
  const card = page.locator(".card", { hasText: "By the hour each outing started" });
  await card.getByRole("button", { name: "View as table" }).click();
  const numbers = await cells(card);
  expect(numbers.length).toBeGreaterThan(2);
  const counts = numbers.map((r) => readCell(r[1])!.value);
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = numbers.map((r, i) => [r[0], formatShare(counts[i], total)]);

  for (let i = 0; i < 4; i++) {
    await percentButton(card).click();
    await expect(numbersButton(card)).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("Each start hour's share of the year's outings.")).toBeVisible();
    expect(await cells(card)).toEqual(expected);
    // The shares add up to about 100 (rounding can move it a point or two per row).
    const sum = expected.reduce((s, r) => s + (r[1] === "<1%" ? 0 : Number(r[1].replace("%", ""))), 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(expected.length);

    await numbersButton(card).click();
    await expect(percentButton(card)).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByText("Each start hour's share of the year's outings.")).toHaveCount(0);
    expect(await cells(card)).toEqual(numbers);
  }

  // Back to the chart: the % button goes with the table.
  await card.getByRole("button", { name: "View as chart" }).click();
  await expect(card.getByRole("button", { name: /Show as %|Show numbers/ })).toHaveCount(0);
});

test("on the reservations type table each type becomes its share of the row's total", async ({ page }) => {
  await mockAll(page);
  await page.goto("/reservations");
  const card = page.locator(".card", { hasText: "Reservations peak in" });
  await card.getByRole("button", { name: "View as table" }).click();
  const numbers = await cells(card);
  await percentButton(card).click();
  const shares = await cells(card);
  for (let r = 0; r < numbers.length; r++) {
    const row = numbers[r];
    const total = readCell(row.at(-1)!)!.value;
    expect(shares[r][0]).toBe(row[0]);
    for (let c = 1; c < row.length; c++) expect(shares[r][c]).toBe(formatShare(readCell(row[c])!.value, total));
    if (total > 0) expect(shares[r].at(-1)).toBe("100%");
  }
});

test("months with no reason split stay a dash, never 0%", async ({ page }) => {
  await mockAll(page);
  await page.goto("/membership");
  const card = page.locator(".card", { has: page.getByRole("heading", { name: "Why members leave" }) });
  await card.getByRole("button", { name: "View as table" }).click();
  const numbers = await cells(card);
  await percentButton(card).click();
  const shares = await cells(card);
  expect(shares.length).toBe(numbers.length);
  for (let r = 0; r < numbers.length; r++) {
    for (let c = 1; c <= 3; c++) {
      if (numbers[r][c] === "—") expect(shares[r][c]).toBe("—");
      else expect(shares[r][c]).toMatch(/^(<1|\d+)%$/);
    }
  }
  expect(numbers.some((r) => r[1] === "—")).toBe(true);
});

test("tables where a share means nothing do not offer it", async ({ page }) => {
  await mockAll(page);
  await page.goto("/membership");
  for (const name of ["Paying members over time", "Waitlist over time"]) {
    const card = page.locator(".card", { has: page.getByRole("heading", { name, exact: true }) });
    await card.getByRole("button", { name: "View as table" }).click();
    await expect(card.getByRole("table")).toBeVisible();
    await expect(percentButton(card)).toHaveCount(0);
  }
});

test("on the join cohort table only Under 1 a month becomes a share; Not started yet stays a count", async ({ page }) => {
  await mockDashboard(page);
  await page.goto("/visits");
  const card = page.getByRole("region", { name: /are the quietest/ });
  await card.getByRole("button", { name: "View as table" }).click();
  const numbers = await cells(card);
  await percentButton(card).click();
  await expect(card.getByText(/Not started yet stays a count/)).toBeVisible();
  const shares = await cells(card);
  for (let r = 0; r < numbers.length; r++) {
    const members = readCell(numbers[r][1])!.value;
    expect(shares[r][1]).toBe(numbers[r][1]);
    expect(shares[r][2]).toBe(formatShare(readCell(numbers[r][2])!.value, members));
    expect(shares[r][3]).toBe(numbers[r][3]);
    expect(shares[r][4]).toBe(numbers[r][4]);
  }
});
