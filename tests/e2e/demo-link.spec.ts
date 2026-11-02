import { expect, test } from "@playwright/test";

/**
 * The live site with the demo's address set (port 3105): the dashboard menu gets a CCS System link that goes to the demo on its
 * own address, and nothing of the reservation system runs on the live site itself. (The sample switch and the demo password are
 * both set on this server on purpose: neither may change what the live site answers.)
 */
const BASE = "http://localhost:3105";
const DEMO = "https://demo.example.org";

test.describe("the live dashboard's link to the demo", () => {
  test("the menu is told about the demo, with its address", async () => {
    const res = await fetch(`${BASE}/api/nav-extras`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ extras: ["system"], systemHref: `${DEMO}/club/start` });
  });

  test("CCS System is the first item, opens the demo in a new tab, and the rest of the menu is as before", async ({ page, context }) => {
    // The demo's address is not reachable from here, so a stand-in page answers for it.
    await context.route(`${DEMO}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>demo stand-in</title><h1>Demo stand-in</h1>" }));
    await page.goto(`${BASE}/`);
    const nav = page.getByRole("navigation", { name: "Dashboard sections" });
    await expect(nav.getByRole("link")).toHaveText(["CCS System", "Summary", "Goals"]);
    await expect(nav.getByRole("button")).toHaveText(["Usage", "Board Materials"]);
    const link = nav.getByRole("link", { name: "CCS System" });
    await expect(link).toHaveAttribute("href", `${DEMO}/club/start`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    const [tab] = await Promise.all([context.waitForEvent("page"), link.click()]);
    await expect(tab).toHaveURL(`${DEMO}/club/start`);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("Demo stand-in");
    // The dashboard stays where it was.
    await expect(page).toHaveURL(`${BASE}/`);
    await nav.getByRole("button", { name: "Board Materials" }).click();
    await expect(nav.getByRole("menu", { name: "Board Materials" }).getByRole("menuitem")).toHaveText(["Email", "Membership", "Financials"]);
  });

  test("an address the server should never send is not drawn as the demo link", async ({ page }) => {
    // Defence in depth: even if the menu were told something unsafe, it falls back to this site's own landing page link.
    for (const systemHref of ["javascript:alert(1)", "http://demo.example.org/club/start", "data:text/html,hi", 42]) {
      await page.route(`${BASE}/api/nav-extras`, (route) => route.fulfill({ json: { extras: ["system"], systemHref } }));
      await page.goto(`${BASE}/`);
      const link = page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "CCS System" });
      await expect(link, String(systemHref)).toHaveAttribute("href", "/club/start");
      await expect(link, String(systemHref)).not.toHaveAttribute("target", "_blank");
      await page.unroute(`${BASE}/api/nav-extras`);
    }
  });

  test("the link is on every dashboard page", async ({ page }) => {
    for (const path of ["/goals", "/visits", "/membership"]) {
      await page.goto(`${BASE}${path}`);
      await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "CCS System" })).toHaveAttribute("href", `${DEMO}/club/start`);
    }
  });

  test("the live site itself still has no reservation system, no keypad and no redirect to one", async () => {
    for (const path of ["/club", "/club/start", "/club/admin", "/club/sign-in", "/site", "/site/request-a-tour", "/demo", "/demo?next=/club/start", "/api/club/import/template"]) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("location"), path).toBeNull();
      expect(await res.text(), path).not.toMatch(/Try the club system|Open the demo|Test member view|Abernathy|Staff office/i);
    }
    for (const path of ["/api/demo/unlock", "/api/demo/lock", "/api/club/act-as"]) {
      const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", body: new URLSearchParams({ password: "playwright-only-demo-0001", actor: "staff" }) });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("set-cookie"), path).toBeNull();
    }
  });
});
