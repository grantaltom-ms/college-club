import { expect, test } from "@playwright/test";
import { E2E_PASSWORD } from "../../playwright.config";
import { openMembers } from "./helpers";

// Plain fetch carries no cookies, like a stranger who has only the link.
test.describe("members sign-in", () => {
  test("the public data has no member names", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/api/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(550);
    expect(body.members.every((m: { name: string; joined: string | null }) => m.name === "" && m.joined === null)).toBe(true);
  });

  test("the names endpoint refuses strangers and bad cookies", async ({ baseURL }) => {
    expect((await fetch(`${baseURL}/api/members`)).status).toBe(401);
    const forged = await fetch(`${baseURL}/api/members`, { headers: { cookie: "ccs_members=9999999999.deadbeef" } });
    expect(forged.status).toBe(401);
    const expired = await fetch(`${baseURL}/api/members`, { headers: { cookie: "ccs_members=1.deadbeef" } });
    expect(expired.status).toBe(401);
  });

  test("login rejects a wrong password and accepts the right one", async ({ baseURL }) => {
    const post = (password: string) =>
      fetch(`${baseURL}/api/members/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    expect((await post("wrong")).status).toBe(401);
    const ok = await post(E2E_PASSWORD);
    expect(ok.status).toBe(200);
    const cookie = ok.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const names = await fetch(`${baseURL}/api/members`, { headers: { cookie: cookie.split(";")[0] } });
    expect(names.status).toBe(200);
    const body = await names.json();
    expect(body.members[0].name).not.toBe("");
  });

  test("the other pages stay open without a password", async ({ page }) => {
    for (const path of ["/", "/timing"]) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
    }
    await expect(page.getByRole("heading", { level: 1, name: "When people come." })).toBeVisible();
  });

  test("the members page shows a password form, then the list, and signing out locks it again, several times", async ({ page }) => {
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Member names are private." })).toBeVisible();
    await expect(page.getByText("Showing 1–25")).toHaveCount(0);

    await page.getByLabel("Password").fill("not-it");
    await page.getByRole("button", { name: "Show members" }).click();
    await expect(page.locator(".status-error")).toContainText("not right");

    for (let i = 0; i < 3; i++) {
      await openMembers(page);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("heading", { name: "Member names are private." })).toBeVisible();
    }
  });

  test("a signed-in visit survives a reload", async ({ page }) => {
    await openMembers(page);
    await page.reload();
    await expect(page.getByText("Showing 1–25 of 550 members")).toBeVisible();
  });
});
