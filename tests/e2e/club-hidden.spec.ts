import { expect, test } from "@playwright/test";

// Port 3101: a production build with the sample-data switch off, like the live site by default.
// Port 3102: the switch is on by mistake, but the deployment says it is the live production site.
// In both, the member area and the "act as this test member" picker must not exist at all.
const HIDDEN = {
  "production build, sample switch off": "http://localhost:3101",
  "live production site, sample switch on": "http://localhost:3102",
};

const FIRST_HOUSEHOLD = "00000000-0000-4000-8000-000000000001";

for (const [name, base] of Object.entries(HIDDEN)) {
  test.describe(name, () => {
    test("the member area answers 'page not found', not a login or a picker", async () => {
      for (const path of ["/club", "/club/act-as", `/club/household/${FIRST_HOUSEHOLD}`, "/club/anything-else"]) {
        const res = await fetch(`${base}${path}`);
        expect(res.status, path).toBe(404);
        const html = await res.text();
        expect(html, path).not.toMatch(/Act as|Test staff|Switch test member|Lindqvist|Abernathy|test build|invented|ccs_test_actor|club-button/i);
      }
    });

    test("the picker's request handler does nothing and sets no cookie", async () => {
      for (const actor of ["staff", `member:${FIRST_HOUSEHOLD}`, "none"]) {
        const res = await fetch(`${base}/api/club/act-as`, {
          method: "POST",
          redirect: "manual",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ actor }),
        });
        expect(res.status, actor).toBe(404);
        expect(res.headers.get("set-cookie"), actor).toBeNull();
      }
    });

    test("a cookie for a test member opens nothing", async () => {
      const res = await fetch(`${base}/club`, { headers: { Cookie: "ccs_test_actor=staff" } });
      expect(res.status).toBe(404);
      expect(await res.text()).not.toMatch(/Households|Lindqvist/);
    });

    test("the rest of the site is untouched", async ({ page }) => {
      // Static dashboard pages still open (their data is loaded separately and is not part of this check).
      for (const path of ["/", "/visits", "/timing", "/shells", "/reservations", "/email", "/goals"]) {
        const res = await page.goto(`${base}${path}`);
        expect(res?.status(), path).toBe(200);
      }
    });
  });
}
