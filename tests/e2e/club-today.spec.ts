import { expect, test, type Page } from "@playwright/test";

/**
 * The staff landing page, Today at the Club, and the search-first Households page. The invented club's day, on the test clock (1 pm
 * Pacific, Wed Oct 28, 2026): people under way, someone checked in, people still to come, a rare visitor and a new member.
 *
 * Tests share one server and some of them tick people off or mark no-shows on the invented bookings under way, so these look only
 * at people nobody else touches (Britta Eriksen, Declan Halloran, Walter Pemberton, Amara Okonkwo and Yuki Nakamura) and never at
 * exact totals.
 */

const SENT = "If that address belongs to a member or to club staff, a sign-in link is on its way. It works once, and it stops working in 15 minutes. If it does not arrive, check your spam folder.";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Asks for a sign-in link, opens the one in the test outbox and presses the button: a real sign-in, as the link says. */
async function signIn(page: Page, email: string, button: string) {
  await page.goto("/club/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByTestId("link-sent")).toHaveText(SENT);
  await page.goto("/club/outbox");
  await page.getByTestId("outbox-message").filter({ hasText: `To ${email}` }).first().getByTestId("outbox-link").click();
  await page.getByRole("button", { name: button, exact: true }).click();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Member area" });
const here = (page: Page) => page.getByTestId("today-here");
const upcoming = (page: Page) => page.getByTestId("today-upcoming");
const toggle = (section: ReturnType<typeof here>) => section.getByRole("button");
const row = (section: ReturnType<typeof here>, name: string) => section.getByTestId("today-row").filter({ hasText: name });

/** Opens both lists, which start folded. */
async function openBoth(page: Page) {
  for (const section of [here(page), upcoming(page)]) {
    if ((await toggle(section).getAttribute("aria-expanded")) !== "true") await toggle(section).click();
    await expect(toggle(section)).toHaveAttribute("aria-expanded", "true");
  }
}

const HELLO_RARE = "Say hello — first visit in a while";
const HELLO_NEW = "New member — say hello";

test.describe("Today at the Club", () => {
  test("shows the day, a one-line summary and the time it is as of, and nothing else before the lists", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today at the Club" })).toBeVisible();
    await expect(page.getByTestId("today-date")).toHaveText("Wednesday, October 28");
    // Biggest first, in the club's own categories: "14 reservations today — 7 boats, 2 dock, 2 class places, 2 room, 1 gym" on a fresh club.
    await expect(page.getByTestId("today-summary")).toHaveText(/^\d+ reservations today — \d+ (boats?|gym|dock|class places?|room|work spaces?)(, \d+ (boats?|gym|dock|class places?|room|work spaces?))*$/);
    const asOf = page.getByTestId("today-asof");
    await expect(asOf).toHaveText("1:00 pm");
    await expect(asOf).toHaveAttribute("datetime", "2026-10-28T20:00:00.000Z");
    await expect(page.getByRole("main")).toContainText("This page updates itself every 2 minutes.");
    await expect(page.getByTestId("today-placeholder")).toContainText("placeholders until club staff confirm");
  });

  test("starts with both lists folded: a title and a count, and no names", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    for (const [section, title] of [[here(page), "Who's here now?"], [upcoming(page), "Upcoming reservations"]] as const) {
      await expect(toggle(section)).toHaveAttribute("aria-expanded", "false");
      await expect(section.getByRole("heading", { level: 2 })).toContainText(title);
      await expect(toggle(section)).toContainText(/— \d+ members?$/);
    }
    await expect(page.getByTestId("today-row")).toHaveCount(0);
    // None of the invented people are on the page at all, not even out of sight.
    const text = await page.getByRole("main").innerText();
    for (const name of ["Britta Eriksen", "Declan Halloran", "Walter Pemberton", "Amara Okonkwo", "Yuki Nakamura"]) expect(text).not.toContain(name);
  });

  test("opens to names and what each person is here for, and folds again", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await toggle(here(page)).click();
    await expect(toggle(here(page))).toHaveAttribute("aria-expanded", "true");
    // The list holds as many rows as the count says.
    const count = Number((await here(page).getByTestId("today-here-count").innerText()).match(/\d+/)![0]);
    await expect(here(page).getByTestId("today-row")).toHaveCount(count);
    // Someone on a dock slip, and someone checked in to the weight room: name, what for, and the kind of thing it is.
    await expect(row(here(page), "Britta Eriksen")).toContainText("Dock slip B");
    await expect(row(here(page), "Britta Eriksen")).toContainText("Dock");
    await expect(row(here(page), "Declan Halloran")).toContainText("Weight room");
    await expect(row(here(page), "Declan Halloran")).toContainText("Gym");
    await expect(row(here(page), "Walter Pemberton")).toContainText("Clubhouse room");
    // The other list is still folded.
    await expect(toggle(upcoming(page))).toHaveAttribute("aria-expanded", "false");
    await expect(upcoming(page).getByTestId("today-row")).toHaveCount(0);
    await toggle(here(page)).click();
    await expect(here(page).getByTestId("today-row")).toHaveCount(0);
    await expect(toggle(here(page))).toHaveAttribute("aria-expanded", "false");
  });

  test("lists who is still to come, and leaves out people whose reservation is already over", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await openBoth(page);
    await expect(row(upcoming(page), "Yuki Nakamura")).toContainText("Dock slip C");
    // Yuki's club room booking this morning is over: it is not listed, and she is not in "here now".
    await expect(row(upcoming(page), "Yuki Nakamura")).not.toContainText("Clubhouse room");
    await expect(row(here(page), "Yuki Nakamura")).toHaveCount(0);
    // Alex Brooks and Kenji Tanaka had boats this morning, which ended with nobody checked in: they are in neither list.
    for (const name of ["Alex Brooks", "Kenji Tanaka"]) {
      await expect(row(here(page), name)).toHaveCount(0);
      await expect(row(upcoming(page), name)).toHaveCount(0);
    }
    // No "already happened" list and no no-show tracking on this page.
    await expect(page.getByRole("main")).not.toContainText(/no-show|already happened|checked out|finished/i);
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(2);
  });

  test("marks people the desk has not seen in a while, or has not met, with warm words and never a number", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await openBoth(page);
    await expect(row(here(page), "Amara Okonkwo").getByTestId("today-hello")).toHaveText(HELLO_RARE);
    await expect(row(here(page), "Walter Pemberton").getByTestId("today-hello")).toHaveText(HELLO_RARE);
    await expect(row(upcoming(page), "Yuki Nakamura").getByTestId("today-hello")).toHaveText(HELLO_NEW);
    // Regulars carry no note.
    await expect(row(here(page), "Britta Eriksen").getByTestId("today-hello")).toHaveCount(0);
    await expect(row(here(page), "Declan Halloran").getByTestId("today-hello")).toHaveCount(0);
    for (const note of await page.getByTestId("today-hello").allInnerTexts()) {
      expect([HELLO_RARE, HELLO_NEW]).toContain(note);
      expect(note).not.toMatch(/\d/);
    }
    expect(await page.getByRole("main").innerText()).not.toMatch(/at.risk|score|visits?\b.*\d|churn|inactive/i);
  });

  test("shows no clock time of any reservation, only the time the figures are as of", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    for (const folded of [true, false]) {
      if (!folded) await openBoth(page);
      const asOf = await page.getByTestId("today-asof").innerText();
      const text = (await page.locator("body").innerText()).replace(asOf, "");
      expect(text, folded ? "folded" : "open").not.toMatch(/\b\d{1,2}:\d{2}\b/);
      expect(text, folded ? "folded" : "open").not.toMatch(/\d\s?(am|pm)\b/i);
      expect(text, folded ? "folded" : "open").not.toMatch(/\b(am|pm)\b/i);
      expect(await page.title()).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });

  test("is the same page for every member of staff, signed in or acting as the test staff member", async ({ browser, baseURL }) => {
    const pages: Page[] = [];
    const contexts = [];
    for (const [email, button] of [["sam.deskwell@example.org", "Sign in as Sam Deskwell (club staff)"], ["alex.staffer@example.org", "Sign in as Alex Staffer (club staff)"]] as const) {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, email, button);
      // Signing in as staff lands on Today at the Club, not on the household list and not on the Staff office.
      await expect(page).toHaveURL(/\/club\/today$/);
      await expect(page.getByRole("heading", { level: 1, name: "Today at the Club" })).toBeVisible();
      pages.push(page);
    }
    const picker = await browser.newContext({ baseURL });
    contexts.push(picker);
    const third = await picker.newPage();
    await actAs(third, "Test staff");
    await third.goto("/club/today");
    pages.push(third);

    await expect(pages[0].getByTestId("acting-as")).toHaveText("Signed in as Sam Deskwell.");
    await expect(pages[1].getByTestId("acting-as")).toHaveText("Signed in as Alex Staffer.");
    for (const page of pages) await openBoth(page);
    const texts = await Promise.all(pages.map((p) => p.getByRole("main").innerText()));
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toBe(texts[2]);
    for (const context of contexts) await context.close();
  });

  test("is only for staff: a member is told there is no such page, a visitor is asked to sign in", async ({ page, context }) => {
    await actAs(page, "Nora Abernathy");
    const refused = await page.goto("/club/today");
    expect(refused?.status()).toBe(404);
    expect(await page.content()).not.toMatch(/Who&#x27;s here now|Upcoming reservations|Say hello|New member — say hello/);
    await context.clearCookies();
    await page.goto("/club/today");
    await expect(page.getByRole("heading", { level: 1, name: "Choose a test member" })).toBeVisible();
    await expect(page.getByTestId("today-date")).toHaveCount(0);
  });

  test("members never see a hello note anywhere", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    for (const path of ["/club", "/club/book", "/club/my-bookings", "/club/classes", "/club/events", "/club/my-bill", "/club/my-boats", "/club/my-history"]) {
      await page.goto(path);
      const html = await page.content();
      expect(html, path).not.toContain("Say hello");
      expect(html, path).not.toContain("New member — say hello");
      expect(html, path).not.toContain("today-hello");
    }
    // Not even for members who are rare visitors or new: the page they would be flagged on is staff's alone.
    for (const who of ["Amara Okonkwo", "Walter Pemberton", "Yuki Nakamura"]) {
      await actAs(page, who);
      for (const path of ["/club", "/club/my-bookings"]) {
        await page.goto(path);
        expect(await page.content(), `${who} ${path}`).not.toContain("Say hello");
        expect(await page.content(), `${who} ${path}`).not.toContain("New member — say hello");
      }
    }
  });

  test("refreshes itself every couple of minutes and keeps whatever is open", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.clock.install();
    await page.goto("/club/today");
    await expect(page.locator("[data-refresh-seconds]")).toHaveAttribute("data-refresh-seconds", "120");
    expect(Number(await page.locator("[data-refresh-seconds]").getAttribute("data-refresh-seconds"))).toBeLessThanOrEqual(300);
    await toggle(here(page)).click();
    await expect(here(page).getByTestId("today-row").first()).toBeVisible();

    const refreshes: string[] = [];
    page.on("request", (r) => {
      const h = r.headers();
      if (h["rsc"] === "1" && !h["next-router-prefetch"] && new URL(r.url()).pathname === "/club/today") refreshes.push(r.url());
    });
    await page.clock.runFor(60_000);
    expect(refreshes).toHaveLength(0);
    await page.clock.runFor(70_000);
    await expect.poll(() => refreshes.length).toBeGreaterThan(0);
    // The list that was open is still open after the page asked for fresh figures.
    await expect(toggle(here(page))).toHaveAttribute("aria-expanded", "true");
    await expect(here(page).getByTestId("today-row").first()).toBeVisible();
    await expect(page.getByTestId("today-asof")).toHaveText("1:00 pm");
  });

  test("is staff's home: Today comes first in the menu, is marked while open, and the logo goes there", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    // The text as written (the menu draws capitals with a style, which innerText would pick up).
    const links = await nav(page).getByRole("link").allTextContents();
    expect(links.slice(0, 3)).toEqual(["Today", "Households", "Book"]);
    await expect(nav(page).getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Households", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("banner").getByRole("link", { name: "College Club Seattle" })).toHaveAttribute("href", "/club/today");
    await page.goto("/club");
    await expect(nav(page).getByRole("link", { name: "Households", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Today", exact: true })).not.toHaveAttribute("aria-current", "page");
    // The Households link is marked on its own address only, not on every page under /club.
    await page.goto("/club/admin");
    await expect(nav(page).getByRole("link", { name: "Households", exact: true })).not.toHaveAttribute("aria-current", "page");
    await expect(nav(page).getByRole("link", { name: "Staff office", exact: true })).toHaveAttribute("aria-current", "page");
    // Staff reach the Staff office's board as before: it is its own page.
    await expect(page.getByRole("heading", { level: 1, name: "Staff office" })).toBeVisible();
  });

  test("a member's menu and logo are unchanged: no Today, the logo goes to their household", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    await expect(nav(page).getByRole("link", { name: "Today" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "College Club Seattle" })).toHaveAttribute("href", "/club");
  });

  test("works on a phone: nothing scrolls sideways and the buttons that open the lists are big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await openBoth(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const section of [here(page), upcoming(page)]) {
      const box = await toggle(section).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Households is search-first", () => {
  const cards = (page: Page) => page.getByTestId("household-row");
  const search = async (page: Page, typed: string) => {
    await page.getByLabel("Search households").fill(typed);
    await page.getByRole("button", { name: "Search" }).click();
  };

  test("starts with only a search box and the Add a household button: no list, no cards", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club");
    await expect(page.getByRole("heading", { level: 1, name: "Households" })).toBeVisible();
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByLabel("Search households")).toBeVisible();
    await expect(page.getByTestId("add-household-link")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole("list", { name: /households/i })).toHaveCount(0);
    await expect(page.getByTestId("no-household-match")).toHaveCount(0);
    expect(await page.getByRole("main").innerText()).not.toMatch(/Lindqvist|Nakamura|Abernathy|Pemberton/);
    // A search that was never sent (an empty or blank one) runs nothing.
    for (const q of ["", "%20%20%20"]) {
      await page.goto(`/club?q=${q}`);
      await expect(cards(page)).toHaveCount(0);
      await expect(page.getByTestId("no-household-match")).toHaveCount(0);
    }
  });

  test("finds a household by its name, by a member's name, by an email address and by a phone number", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club");
    const found = async (typed: string, household: string) => {
      await search(page, typed);
      await expect(page).toHaveURL(/\/club\?q=/);
      await expect(page.getByRole("link", { name: household, exact: true }), typed).toBeVisible();
    };
    await found("pemberton", "The Pemberton household"); // household name
    await found("The Tanaka-Brooks", "The Tanaka-Brooks household"); // a hyphenated name
    await found("amara", "The Okonkwo household"); // a member's first name
    await found("Rafael Castellanos", "The Castellanos household"); // a member's whole name
    await found("walter.pemberton@example.com", "The Pemberton household"); // an email address
    await found("pemberton@", "The Pemberton household"); // part of an address
    await found("206-555-0169", "The Pemberton household"); // Walter Pemberton's number
    await found("(206) 555 0169", "The Pemberton household"); // written another way
    await found("2065550169", "The Pemberton household");
    await found("colm", "The Fitzgerald household"); // a household that has ended is still found
  });

  test("shows the same household cards as before, each linking to its household", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club?q=lindqvist");
    await expect(cards(page)).toHaveCount(1);
    const card = cards(page).first();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText("The Lindqvist household");
    await expect(card).toContainText("Resident · 2 active adults");
    await expect(page.getByTestId("household-count")).toHaveText("1 household matches.");
    await page.goto("/club?q=fitzgerald");
    await expect(cards(page).first()).toContainText(/Resident · ended /);
    await page.goto("/club?q=pemberton");
    await expect(cards(page).first()).toContainText("1 active adult");
    await cards(page).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/club\/household\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("household-name")).toHaveText("The Pemberton household");
  });

  test("says plainly when nothing matches", async ({ page }) => {
    await actAs(page, "Test staff");
    for (const typed of ["zzzznothing", "999-999-9999", "no.such@example.com", "@@@", "<script>alert(1)</script>"]) {
      await page.goto(`/club?q=${encodeURIComponent(typed)}`);
      await expect(page.getByTestId("no-household-match"), typed).toHaveText("No household matches that search.");
      await expect(cards(page)).toHaveCount(0);
      await expect(page.locator('main a[href^="/club/household/"]')).toHaveCount(0);
    }
    // The search box keeps what was typed, as typed text and not as markup.
    await expect(page.getByLabel("Search households")).toHaveValue("<script>alert(1)</script>");
  });

  test("a very long search is cut down and answered, not refused", async ({ page }) => {
    await actAs(page, "Test staff");
    const res = await page.goto(`/club?q=${"x".repeat(5000)}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("no-household-match")).toBeVisible();
    expect((await page.getByLabel("Search households").inputValue()).length).toBeLessThanOrEqual(100);
  });

  test("a search that finds many shows the first 50 and says so", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club?q=household");
    const n = await cards(page).count();
    expect(n).toBeGreaterThanOrEqual(14);
    expect(n).toBeLessThanOrEqual(50);
    if (n === 50) await expect(page.getByTestId("household-count")).toContainText("Showing the first 50. Type more of the name to narrow it down.");
  });

  test("a member's view is unchanged: only their own household, no search box, and a search in the address changes nothing", async ({ page }) => {
    await actAs(page, "Erik Lindqvist");
    for (const path of ["/club", "/club?q=nakamura", "/club?q=household"]) {
      await page.goto(path);
      await expect(page.getByTestId("household-name")).toHaveText("The Lindqvist household");
      await expect(page.getByRole("search")).toHaveCount(0);
      await expect(cards(page)).toHaveCount(0);
      expect(await page.getByRole("main").innerText(), path).not.toContain("Nakamura");
    }
    await expect(page.getByTestId("member-row")).toHaveCount(2);
  });

  test("fits a phone, with a search box and buttons big enough to tap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await actAs(page, "Test staff");
    await page.goto("/club?q=household");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const target of [page.getByRole("button", { name: "Search" }), page.getByLabel("Search households"), page.getByTestId("add-household-link")]) {
      expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("a staff member signed in by email reaches the search from the menu", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/today");
    await nav(page).getByRole("link", { name: "Households", exact: true }).click();
    await expect(page).toHaveURL(/\/club$/);
    await expect(page.getByLabel("Search households")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
  });
});
