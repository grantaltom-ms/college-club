import type { Page } from "@playwright/test";
import { sampleData } from "../../src/lib/sample";
import { sampleShells } from "../../src/lib/shells";
import { sampleEmail } from "../../src/lib/mailchimp";

/** Serve the invented sample club from the data endpoint, so no test touches the real database. */
export async function mockDashboard(page: Page) {
  const body = JSON.stringify(sampleData());
  await page.route("**/api/dashboard", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body }),
  );
}

/** Serve invented shell outings and emails too, for the summary page that reads every source. */
export async function mockAll(page: Page) {
  await mockDashboard(page);
  const shells = JSON.stringify(sampleShells());
  const email = JSON.stringify(sampleEmail());
  await page.route("**/api/shells", (route) => route.fulfill({ status: 200, contentType: "application/json", body: shells }));
  await page.route("**/api/email", (route) => route.fulfill({ status: 200, contentType: "application/json", body: email }));
}
