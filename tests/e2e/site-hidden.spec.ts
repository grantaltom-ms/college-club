import { expect, test } from "@playwright/test";

// Port 3101: a production build with the sample-data switch off, like the live site by default.
// Port 3102: the switch is on by mistake, but the deployment says it is the live production site.
// In both, the new public website under /site must not exist at all: until cutover only previews show it.
const HIDDEN = {
  "production build, sample switch off": "http://localhost:3101",
  "live production site, sample switch on": "http://localhost:3102",
};

for (const [name, base] of Object.entries(HIDDEN)) {
  test.describe(name, () => {
    test("every public page answers 'page not found' and shows none of its words", async () => {
      for (const path of ["/site", "/site/about", "/site/membership", "/site/programs", "/site/request-a-tour", "/site/contact", "/site/anything-else", "/site/membership?x=1"]) {
        const res = await fetch(`${base}${path}`);
        expect(res.status, path).toBe(404);
        const html = await res.text();
        expect(html, path).not.toMatch(/Your summer evenings|Three steps to the dock|Come see it for yourself|Request a tour|Our Programs|Member login|A Seattle institution|Photo: members on the deck|Send request|Join the club|\$103|\$154\.50|622-0624|11 East Allison|membership@collegeclubseattle|Caitlin|Julia Gamache|Rowing and fitness|Preview of the new club website|Intermediate|Resident/i);
        expect(html, path).not.toMatch(/<title>[^<]*College Club Seattle/i);
      }
    });

    test("the dashboard's home address is still the dashboard, not the public site", async () => {
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toMatch(/Your summer evenings|Preview of the new club website|Request a tour/i);
    });
  });
}
