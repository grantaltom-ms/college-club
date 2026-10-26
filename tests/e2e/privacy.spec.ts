import { expect, test } from "@playwright/test";

// Plain fetch carries no cookies, like a stranger who has only the link.
test.describe("what the public site shows", () => {
  test("the data endpoints carry no member names", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(497);
    expect(body.members.every((m: { name: string; joined: string | null }) => m.name === "" && m.joined === null)).toBe(true);
    // Type, creation date and the not-started flag travel with each member, but never a name.
    expect(body.members.every((m: { memberType: string; qbCreatedOn: string; notStarted: boolean }) => ["Resident", "Intermediate", "Non-Resident"].includes(m.memberType) && /^\d{4}-\d{2}-\d{2}$/.test(m.qbCreatedOn) && typeof m.notStarted === "boolean")).toBe(true);
    expect(body.members.filter((m: { notStarted: boolean }) => m.notStarted)).toHaveLength(11);
    expect(JSON.stringify(body)).not.toMatch(/qb_name|usage_member_name|qb_member_number/);
  });

  test("the Members page and its addresses are gone", async ({ baseURL, page }) => {
    for (const path of ["/members", "/api/members", "/api/members/login", "/api/members/logout"]) {
      const res = await fetch(`${baseURL}${path}`);
      expect(res.status, path).toBe(404);
    }
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Dashboard sections" });
    await expect(nav.getByRole("link", { name: "Members", exact: true })).toHaveCount(0);
    // Visits, Timing and Reservations live under the Usage menu, not as top-level links.
    await expect(nav.getByRole("link")).toHaveText(["Summary", "Shells", "Email", "Membership", "Goals"]);
    await expect(nav.getByRole("button", { name: "Usage" })).toBeVisible();
    await nav.getByRole("button", { name: "Usage" }).click();
    await expect(nav.getByRole("menu", { name: "Usage" }).getByRole("menuitem")).toHaveText(["Visits", "Timing", "Reservations"]);
  });

  test("every page opens without a password", async ({ page }) => {
    for (const path of ["/", "/visits", "/timing", "/shells", "/reservations", "/email", "/membership", "/goals"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(page.getByLabel("Password")).toHaveCount(0);
    }
  });
});
