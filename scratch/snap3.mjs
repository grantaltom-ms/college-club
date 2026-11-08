import { chromium } from "@playwright/test";
const base = "http://localhost:3100";
const browser = await chromium.launch();
for (const [w, h, tag] of [[390, 844, "phone"], [1180, 900, "desk"]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(base + "/club/act-as"); await page.getByRole("button", { name: "Act as Nora Abernathy", exact: true }).click(); await page.waitForSelector('[data-testid="acting-as"]');
  await page.goto(base + "/club/book?what=gym"); await page.screenshot({ path: `/home/claude/shots/pick-gym-${tag}.png`, fullPage: true });
  await page.goto(base + "/club/book?what=shell&kind=single&hour=14"); await page.screenshot({ path: `/home/claude/shots/pick-shell-${tag}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
