import { expect, test } from "@playwright/test";

// Plain fetch carries no cookies, like a stranger who has only the link.
test.describe("what the public site shows", () => {
  test("the data endpoints carry no member names", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(550);
    expect(body.members.every((m: { name: string; joined: string | null }) => m.name === "" && m.joined === null)).toBe(true);
  });

  test("the Members page and its addresses are gone", async ({ baseURL, page }) => {
    for (const path of ["/members", "/api/members", "/api/members/login", "/api/members/logout"]) {
      const res = await fetch(`${baseURL}${path}`);
      expect(res.status, path).toBe(404);
    }
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Dashboard sections" });
    await expect(nav.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link")).toHaveText(["Overview", "Timing", "Shells", "Reservations", "Email", "Goals"]);
  });

  test("every page opens without a password", async ({ page }) => {
    for (const path of ["/", "/timing", "/shells", "/reservations", "/email", "/goals"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByLabel("Password")).toHaveCount(0);
    }
  });
});
