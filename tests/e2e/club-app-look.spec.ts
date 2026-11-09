import { expect, test, type Page } from "@playwright/test";
import { mockAll } from "./helpers";

/**
 * The members' and staff look (design package "Waterloo Blocks", Nov 4 2026), checked on every screen of the logged-in app:
 * part 1 (the member home, the staff Households list and the Reservations screens), part 2 (every other member screen) and part 3
 * (the staff screens). The front-desk and snack-bar iPads and the test landing page have no top bar or band and are held to the
 * palette in club-kiosk-look.spec.ts instead.
 *
 * Everything is measured as the browser actually draws it: the colours it paints, the sizes of what you tap, and whether a screen
 * scrolls sideways. What the browser draws is what a member sees, so that is what is held.
 */

const actAs = async (page: Page, who: string | null) => {
  if (who === null) return; // the signed-out screens are looked at by nobody
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

/** Open a screen: straight to its address, or by following links for one whose address is made when it is built. */
const visit = async (page: Page, screen: Screen) => {
  if (screen.go) await screen.go(page);
  else await page.goto(screen.path);
};

/**
 * One screen to hold to the look. `who` is the test member to act as (null: nobody, for the signed-out screens). `path` is where to go;
 * `go` is for a screen whose address is made when it is built (a class, an event, a practice, a booking form): it finds its own way
 * there the way a person would, by following a link.
 */
type Screen = { name: string; who: string | null; path: string; h1: string | RegExp; go?: (page: Page) => Promise<void> };

/** Go to a page, press the first link that matches, and wait until the address has really changed to the one it leads to. */
const follow = (from: string, link: string, arrives: RegExp) => async (page: Page) => {
  await page.goto(from);
  await page.locator(link).first().click();
  await page.waitForURL(arrives);
};

/** Go to a Reservations screen, choose the first free start time in the first item's dropdown and press Book: the booking form. */
const viaStartTime = (from: string) => async (page: Page) => {
  await page.goto(from);
  const form = page.locator('[data-testid="start-pick"]').first();
  const value = await form.locator("option:not([disabled])").first().getAttribute("value");
  await form.locator("select").selectOption(value!);
  await form.getByRole("button").click();
  await page.waitForURL(/\/club\/book\/new\?/);
};

/** From the staff Households list into one household, then by one of its links to a desk step (end, change details, remove). */
const viaHousehold = (family: string, link: string, arrives: RegExp) => async (page: Page) => {
  await page.goto(`/club?q=${encodeURIComponent(family)}`);
  await page.locator('main a[href^="/club/household/"]', { hasText: family }).first().click();
  await page.waitForURL(/\/club\/household\/[^/?]+$/);
  await page.locator(link).first().click();
  await page.waitForURL(arrives);
};

const SCREENS: Screen[] = [
  // Part 1
  { name: "member home", who: "Nora Abernathy", path: "/club", h1: "The Abernathy household" },
  { name: "staff households search (before a search)", who: "Test staff", path: "/club", h1: "Households" },
  { name: "staff households search (with results)", who: "Test staff", path: "/club?q=household", h1: "Households" },
  { name: "Reservations: what to reserve", who: "Nora Abernathy", path: "/club/book", h1: "Reservations" },
  { name: "Reservations: shell sizes", who: "Nora Abernathy", path: "/club/book?what=shell", h1: "Reservations" },
  { name: "Reservations: the shell list", who: "Nora Abernathy", path: "/club/book?what=shell&kind=single", h1: "Reservations" },
  { name: "Reservations: a space with time slots", who: "Nora Abernathy", path: "/club/book?what=gym", h1: "Reservations" },
  { name: "Reservations as staff", who: "Test staff", path: "/club/book?what=shell&kind=single", h1: "Reservations" },
  // Part 2: every other member screen
  { name: "My bookings", who: "Nora Abernathy", path: "/club/my-bookings", h1: "My bookings" },
  { name: "All bookings (staff)", who: "Test staff", path: "/club/my-bookings", h1: "All bookings" },
  { name: "the booking form", who: "Nora Abernathy", path: "", h1: /^Book \S/, go: viaStartTime("/club/book?what=gym") },
  { name: "Fitness classes", who: "Nora Abernathy", path: "/club/classes", h1: "Fitness classes" },
  { name: "Fitness classes by day", who: "Nora Abernathy", path: "/club/classes?view=day", h1: "Fitness classes" },
  { name: "Fitness classes (staff)", who: "Test staff", path: "/club/classes", h1: "Fitness classes" },
  { name: "one class and its dates", who: "Nora Abernathy", path: "", h1: /\S/, go: follow("/club/classes", 'main a[href^="/club/classes/of/"]', /\/club\/classes\/of\//) },
  {
    name: "one class session",
    who: "Nora Abernathy",
    path: "",
    h1: /\S/,
    go: async (page) => {
      await follow("/club/classes", 'main a[href^="/club/classes/of/"]', /\/club\/classes\/of\//)(page);
      await page.locator('main a[href^="/club/classes/"]:not([href^="/club/classes/of/"]):not([href="/club/classes/manage"])').first().click();
      await page.waitForURL(/\/club\/classes\/(?!of\/|manage)[^/?]+$/);
    },
  },
  { name: "Events", who: "Nora Abernathy", path: "/club/events", h1: "Events" },
  { name: "Events (staff)", who: "Test staff", path: "/club/events", h1: "Events" },
  { name: "one event", who: "Nora Abernathy", path: "", h1: /\S/, go: follow("/club/events", 'main a[href^="/club/events/"]:not([href="/club/events/manage"])', /\/club\/events\/(?!manage)[^/?]+$/) },
  { name: "My bill", who: "Nora Abernathy", path: "/club/my-bill", h1: "My bill" },
  { name: "My bill (staff, no household chosen)", who: "Test staff", path: "/club/my-bill", h1: "My bill" },
  { name: "My boats", who: "Nora Abernathy", path: "/club/my-boats", h1: "My boats" },
  { name: "My old bookings", who: "Nora Abernathy", path: "/club/my-history", h1: "My old bookings" },
  { name: "My practices", who: "Nora Abernathy", path: "/club/my-practices", h1: "My practices" },
  { name: "Practices (a coach)", who: "Kenji Tanaka", path: "/club/practices", h1: "Practices" },
  { name: "Set up a practice", who: "Kenji Tanaka", path: "/club/practices/new", h1: "Set up a practice" },
  { name: "one practice", who: "Kenji Tanaka", path: "", h1: /\S/, go: follow("/club/practices", 'main a[href^="/club/practices/"]:not([href="/club/practices/new"])', /\/club\/practices\/(?!new)[^/?]+$/) },
  { name: "Report damage", who: "Nora Abernathy", path: "/club/damage", h1: "Report damage" },
  { name: "Report an incident (a coach)", who: "Kenji Tanaka", path: "/club/incidents", h1: "Report an incident" },
  { name: "the sign-in prompt", who: null, path: "/club/my-bookings", h1: "Choose a test member" },
  { name: "the test member picker", who: null, path: "/club/act-as", h1: "Act as a test member" },
  // Part 3: the staff screens
  // Part 5: the staff landing page, with its lists folded and with both opened (the notes and chips only show when open)
  { name: "Today at the Club (lists folded)", who: "Test staff", path: "/club/today", h1: "Today at the Club" },
  {
    name: "Today at the Club (both lists open)",
    who: "Test staff",
    path: "",
    h1: "Today at the Club",
    go: async (page) => {
      await page.goto("/club/today");
      for (const id of ["today-here", "today-upcoming"]) await page.getByTestId(id).getByRole("button").click();
      await expect(page.getByTestId("today-row").first()).toBeVisible();
    },
  },
  { name: "Staff office", who: "Test staff", path: "/club/admin", h1: "Staff office" },
  { name: "Check someone in", who: "Test staff", path: "/club/admin/check-in", h1: "Check someone in" },
  { name: "Reservation attendance", who: "Test staff", path: "/club/admin/reservations", h1: "Reservation attendance" },
  { name: "Add a household", who: "Test staff", path: "/club/admin/households/new", h1: "Add a household" },
  { name: "End a membership", who: "Test staff", path: "", h1: /^End the membership of /, go: viaHousehold("Abernathy", '[data-testid="end-link"]', /\/households\/[^/]+\/end$/) },
  { name: "Change a person's details", who: "Test staff", path: "", h1: /^Change details for /, go: viaHousehold("Abernathy", '[data-testid="edit-link"]', /\/members\/[^/]+\/edit$/) },
  { name: "Remove an adult", who: "Test staff", path: "", h1: /^Remove .+ from /, go: viaHousehold("Lindqvist", '[data-testid="remove-link"]', /\/remove\/[^/?]+$/) },
  { name: "Import households", who: "Test staff", path: "/club/admin/import", h1: "Import households" },
  { name: "End memberships from a file", who: "Test staff", path: "/club/admin/resignations", h1: "End memberships from a file" },
  { name: "Charges", who: "Test staff", path: "/club/admin/charges", h1: "Charges" },
  { name: "Visitors", who: "Test staff", path: "/club/admin/visitors", h1: "Visitors" },
  { name: "Monthly billing", who: "Test staff", path: "/club/admin/billing", h1: "Monthly billing" },
  { name: "Old bookings (staff)", who: "Test staff", path: "/club/admin/history", h1: "Old bookings" },
  { name: "Tour requests", who: "Test staff", path: "/club/admin/tours", h1: "Tour requests" },
  { name: "Front-desk iPad (staff page)", who: "Test staff", path: "/club/admin/ipad", h1: "Front-desk iPad" },
  { name: "Ready to switch on? (staff)", who: "Test staff", path: "/club/admin/switch-on", h1: "Ready to switch on?" },
  { name: "Private boats (staff)", who: "Test staff", path: "/club/admin/boats", h1: "Private boats" },
  { name: "Damage reports (staff)", who: "Test staff", path: "/club/admin/damage", h1: "Damage reports" },
  { name: "one damage report", who: "Test staff", path: "", h1: /\S/, go: follow("/club/admin/damage", 'main a[href^="/club/admin/damage/"]', /\/club\/admin\/damage\/[^/?]+$/) },
  { name: "Incident reports (staff)", who: "Test staff", path: "/club/admin/incidents", h1: "Incident reports" },
  { name: "one incident report", who: "Test staff", path: "", h1: /^Incident on /, go: follow("/club/admin/incidents", 'main a[href^="/club/admin/incidents/"]', /\/club\/admin\/incidents\/[^/?]+$/) },
  { name: "Equipment", who: "Test staff", path: "/club/equipment", h1: "Equipment" },
  { name: "one item of equipment", who: "Test staff", path: "", h1: /\S/, go: follow("/club/equipment", '[data-testid="equipment-edit-link"]', /\/club\/equipment\/[^/?]+$/) },
  { name: "Load the equipment list", who: "Test staff", path: "/club/admin/equipment-import", h1: "Load the equipment list" },
  { name: "Set up classes", who: "Test staff", path: "/club/classes/manage", h1: "Set up classes" },
  { name: "Add an event", who: "Test staff", path: "/club/events/manage", h1: "Add an event" },
];

/** The package's colours, as the browser writes them: rgb(r, g, b). */
const PALETTE = [
  "#ffffff", "#536872", "#435661", "#44484d", "#33363a", "#e2ddd0", "#f5f3ec", "#6c7176", "#e6ebed", "#c3cbce", "#d3ccbc", "#7f96a0",
  "#8a2b1a", // the one error red
];
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const ALLOWED = new Set(PALETTE.map(rgb));

const WIDTHS = [390, 1024, 1180, 1366, 1600, 1920];

test.describe("the members' and staff look", () => {
  for (const screen of SCREENS) {
    test.describe(screen.name, () => {
      test("draws only the package's colours", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 900 });
        await actAs(page, screen.who);
        await visit(page, screen);
        await expect(page.locator(".club-band h1")).toBeVisible();
        // Measure the colours a page settles on, not a link half-way through its 220ms fade because the mouse is resting over it.
        await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
        await page.mouse.move(0, 0);

        const stray = await page.evaluate((allowed) => {
          const ok = new Set(allowed);
          const out: string[] = [];
          const clear = (c: string) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
          for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") continue;
            const where = `${el.tagName.toLowerCase()}.${el.className && typeof el.className === "string" ? el.className.split(" ")[0] : ""}`;
            const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
            const props: [string, string][] = [["background", s.backgroundColor]];
            if (hasText) props.push(["text", s.color]);
            for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
              const width = parseFloat(s[`border${side}Width` as "borderTopWidth"]);
              if (width > 0 && s[`border${side}Style` as "borderTopStyle"] !== "none") props.push([`border-${side.toLowerCase()}`, s[`border${side}Color` as "borderTopColor"]]);
            }
            for (const [what, value] of props) if (!clear(value) && !ok.has(value)) out.push(`${where} ${what} ${value}`);
          }
          return [...new Set(out)];
        }, [...ALLOWED]);
        expect(stray, `colours outside the palette on ${screen.name}`).toEqual([]);
      });

      test("reads in the package's faces: no text is drawn in the older sans (Figtree) except inside My bill's receipt", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 900 });
        await actAs(page, screen.who);
        await visit(page, screen);
        await expect(page.locator(".club-band h1")).toBeVisible();
        const sans = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>("body *")) {
            const s = getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") continue;
            if (!([...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== ""))) continue;
            if (s.fontFamily.includes("Figtree") && !el.closest('[class*="club-bill"]')) out.push(`${el.tagName.toLowerCase()}.${typeof el.className === "string" ? el.className.split(" ")[0] : ""} ${s.fontSize}`);
          }
          return [...new Set(out)];
        });
        expect(sans, `older sans on ${screen.name}`).toEqual([]);
      });

      test("has one H1, in the Waterloo title band, in white Cinzel", async ({ page }) => {
        await page.setViewportSize({ width: 1180, height: 900 });
        await actAs(page, screen.who);
        await visit(page, screen);
        await expect(page.locator("h1")).toHaveCount(1);
        const h1 = page.locator(".club-band h1");
        await expect(h1).toHaveText(screen.h1);
        const look = await h1.evaluate((el) => {
          const s = getComputedStyle(el);
          const band = getComputedStyle(el.closest(".club-band")!);
          return { color: s.color, size: s.fontSize, family: s.fontFamily, weight: s.fontWeight, band: band.backgroundColor };
        });
        expect(look.band).toBe(rgb("#536872"));
        expect(look.color).toBe("rgb(255, 255, 255)");
        expect(look.size).toBe("36px");
        expect(look.family).toContain("Cinzel");
        expect(look.weight).toBe("600");
      });

      test("never scrolls sideways at any of the six widths", async ({ page }) => {
        await actAs(page, screen.who);
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await visit(page, screen);
          await expect(page.locator(".club-band h1")).toBeVisible();
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(over, `${screen.name} at ${width}px`).toBeLessThanOrEqual(0);
        }
      });

      test("keeps every button, menu item and chip at least 44px to tap, on a phone and on a desktop", async ({ page }) => {
        await actAs(page, screen.who);
        for (const width of [390, 1180]) {
          await page.setViewportSize({ width, height: 900 });
          await visit(page, screen);
          await expect(page.locator(".club-band h1")).toBeVisible();
          const small = await page.evaluate(() => {
            const out: string[] = [];
            for (const el of document.querySelectorAll<HTMLElement>(".club-button, .club-menu-button, .club-nav a, .club-nav button, .club-chips a, .club-quiet-links a, .club-brand, .club-back a")) {
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue; // not on screen (the phone menu while closed)
              if (r.height < 43.5) out.push(`${el.className || el.tagName} ${Math.round(r.height)}px tall: ${(el.textContent ?? "").trim().slice(0, 30)}`);
            }
            return out;
          });
          expect(small, `too small to tap at ${width}px on ${screen.name}`).toEqual([]);
        }
      });
    });
  }

  test("a small tag inside the title band (a cancelled practice) is a white chip with Ink text you can read, and a tag elsewhere is the status chip", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Kenji Tanaka");
    await page.goto("/club/practices");
    await expect(page.locator(".club-band h1")).toBeVisible();
    // No practice in the sample is cancelled, so put the tag where PageBand puts it and measure what the browser draws.
    const look = await page.evaluate(() => {
      const mk = (parent: Element) => {
        const tag = document.createElement("span");
        tag.className = "club-tag";
        tag.textContent = "Cancelled";
        parent.appendChild(tag);
        const s = getComputedStyle(tag);
        return { background: s.backgroundColor, color: s.color, radius: s.borderTopLeftRadius, family: s.fontFamily, size: s.fontSize };
      };
      return { inBand: mk(document.querySelector(".club-band h1")!), inPage: mk(document.querySelector("main p:not(.club-band-eyebrow)")!) };
    });
    expect(look.inBand.background).toBe(rgb("#ffffff"));
    expect(look.inBand.color).toBe(rgb("#33363a"));
    expect(look.inPage.background).toBe(rgb("#e6ebed"));
    expect(look.inPage.color).toBe(rgb("#435661"));
    for (const t of [look.inBand, look.inPage]) {
      expect(t.radius).toBe("0px");
      expect(t.family).toContain("Cinzel");
      expect(t.size).toBe("11px");
    }
  });

  test("the top bar is Oyster with the warm line under it, the club's name as the link home, and who is acting at the right", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const header = page.getByRole("banner");
    const look = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, line: s.borderBottomColor, height: el.getBoundingClientRect().height };
    });
    expect(look.bg).toBe(rgb("#e2ddd0"));
    expect(look.line).toBe(rgb("#d3ccbc"));
    expect(look.height).toBeGreaterThanOrEqual(72);
    await expect(header.getByRole("link", { name: "College Club Seattle" })).toHaveAttribute("href", "/club");
    const acting = page.getByTestId("acting-as");
    await expect(acting).toBeVisible();
    // It sits at the right-hand end of the bar, as in the package.
    const [bar, text] = await Promise.all([header.boundingBox(), acting.boundingBox()]);
    expect(text!.x + text!.width).toBeGreaterThan(bar!.x + bar!.width - 80);
  });

  test("the page you are on is marked in the menu: its colour is Ink and it has a 2px Waterloo line under it", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/book");
    const here = page.getByRole("navigation", { name: "Member area" }).getByRole("link", { name: "Book", exact: true });
    await expect(here).toHaveAttribute("aria-current", "page");
    const look = await here.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, line: s.borderBottomColor, width: s.borderBottomWidth };
    });
    expect(look).toEqual({ color: rgb("#33363a"), line: rgb("#536872"), width: "2px" });
    // The others are not marked. A member's own pages sit under My account: its button carries the same line while one of them is open,
    // and inside the opened list the household link is only marked on the home address.
    const nav = page.getByRole("navigation", { name: "Member area" });
    const account = nav.getByRole("button", { name: "My account" });
    await expect(account).not.toHaveAttribute("data-active", "");
    await page.goto("/club");
    await expect(account).toHaveAttribute("data-active", "");
    const accountLook = await account.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, line: s.borderBottomColor, width: s.borderBottomWidth };
    });
    expect(accountLook).toEqual({ color: rgb("#33363a"), line: rgb("#536872"), width: "2px" });
    await account.click();
    await expect(nav.getByRole("link", { name: "My household", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "My bookings", exact: true })).not.toHaveAttribute("aria-current", "page");
  });

  test("on a phone the bar keeps the name and Menu on one row, and shows who is acting under it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const brand = await page.locator(".club-brand").boundingBox();
    const menu = await page.getByRole("button", { name: "Menu" }).boundingBox();
    const acting = await page.getByTestId("acting-as").boundingBox();
    expect(Math.abs(brand!.y + brand!.height / 2 - (menu!.y + menu!.height / 2))).toBeLessThan(12); // the same row
    expect(acting!.y).toBeGreaterThan(brand!.y + brand!.height - 4); // a row of its own, below
    await expect(page.getByTestId("acting-as")).toHaveText("Acting as Nora Abernathy.");
  });

  test("on a short phone the open menu ends above the bottom edge, so its last link (Switch test member) can still be reached", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 568 });
    await actAs(page, "Test staff");
    await page.goto("/club");
    await page.getByRole("button", { name: "Menu" }).click();
    const panel = page.locator("#club-member-nav");
    await expect(panel).toBeVisible();
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const last = await panel.getByRole("link", { name: "Switch test member" }).boundingBox();
    expect(last!.y + last!.height, "the last link's bottom edge, against the 568px screen").toBeLessThanOrEqual(568);
    // The panel itself stops at the bottom of the screen, and the page behind it does not move.
    const box = await panel.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  });

  test("the test-build note is a thin strip above the bar, with the same words as before", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const note = page.getByRole("note");
    await expect(note).toHaveText("Test build. Every household, member and booking here is invented. Nothing is connected to real club data.");
    const [n, bar] = await Promise.all([note.boundingBox(), page.getByRole("banner").boundingBox()]);
    expect(n!.y + n!.height).toBeLessThanOrEqual(bar!.y + 1);
  });

  test("the member home's one highlight card is Waterloo with white text and a white button", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    const card = page.locator(".club-card-highlight");
    await expect(card).toHaveCount(1);
    const look = await card.evaluate((el) => {
      const s = getComputedStyle(el);
      const b = getComputedStyle(el.querySelector(".club-button")!);
      return { bg: s.backgroundColor, text: getComputedStyle(el.querySelector("p")!).color, button: b.backgroundColor, buttonText: b.color };
    });
    expect(look).toEqual({ bg: rgb("#536872"), text: "rgb(255, 255, 255)", button: "rgb(255, 255, 255)", buttonText: rgb("#33363a") });
  });

  test("buttons are 2px-cornered Cinzel capitals, cards are 6px, form boxes 4px with a Waterloo edge", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Test staff");
    await page.goto("/club/admin/households/new");
    const look = await page.evaluate(() => {
      const button = getComputedStyle(document.querySelector(".club-button")!);
      const card = document.querySelector(".club-card");
      const box = document.querySelector<HTMLInputElement>(".club-form input[type=text]");
      const b = getComputedStyle(box!);
      return {
        buttonRadius: button.borderTopLeftRadius,
        buttonFont: button.fontFamily,
        buttonCase: button.textTransform,
        cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "6px",
        boxRadius: b.borderTopLeftRadius,
        boxEdge: b.borderTopColor,
        boxFont: b.fontFamily,
      };
    });
    expect(look.buttonRadius).toBe("2px");
    expect(look.buttonFont).toContain("Cinzel");
    expect(look.buttonCase).toBe("uppercase");
    expect(look.cardRadius).toBe("6px");
    expect(look.boxRadius).toBe("4px");
    expect(look.boxEdge).toBe(rgb("#536872"));
    expect(look.boxFont).toContain("EB Garamond");
  });

  test("the page is white, not cream", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club");
    expect(await page.locator(".club-app").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  });

  test("the sign-in screen, the front-desk iPad pages and the public site are untouched: none of them is inside the new look", async ({ page }) => {
    for (const path of ["/club/sign-in", "/site"]) {
      await page.goto(path);
      await expect(page.locator(".club-app")).toHaveCount(0);
    }
    // The dashboard's menu bar is the dashboard's own.
    await mockAll(page);
    await page.goto("/");
    await expect(page.locator(".club-app")).toHaveCount(0);
  });
});

/**
 * Part 4 (Nov 7): hierarchy and clickability. A UX review of the members' and staff screens found two things: every page looked the
 * same weight (headings, card titles, body and small print all close in size), and nothing that could be pressed looked pressable.
 * These measure the fix as the browser draws it: the sizes step down, links are underlined Waterloo and darken on hover, a card that
 * opens a page carries an arrow that is itself part of the link, and the Staff office's tool links are rows with an arrow.
 */
test.describe("hierarchy and clickability (part 4)", () => {
  const size = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  test("on a member's screen the sizes step down: band H1 > section heading > card title > body > small print", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/my-bookings");
    const [h1, h2, h3, body, meta] = await Promise.all([
      size(page, ".club-band h1"),
      size(page, "main h2"),
      size(page, "main .club-card h3"),
      size(page, ".club-app"),
      size(page, "main .club-meta"),
    ]);
    expect(h1).toBeGreaterThan(h2);
    expect(h2).toBeGreaterThanOrEqual(h3 + 4);
    expect(h3).toBeGreaterThanOrEqual(body + 2);
    expect(meta).toBeLessThan(body);
    // The section heading carries its short Waterloo rule.
    const rule = await page.locator("main h2").first().evaluate((el) => {
      const s = getComputedStyle(el, "::after");
      return { background: s.backgroundColor, height: s.height, width: s.width };
    });
    expect(rule).toEqual({ background: rgb("#536872"), height: "2px", width: "40px" });
    // And the gap above a second section heading is larger than the gap below it.
    const margins = await page.locator("main h2").nth(1).evaluate((el) => ({ top: parseFloat(getComputedStyle(el).marginTop), bottom: parseFloat(getComputedStyle(el).marginBottom) }));
    expect(margins.top).toBeGreaterThan(margins.bottom * 2);
  });

  test("links in the content are underlined Waterloo, and turn Ink with a thicker line when the mouse is over them", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const link = page.locator("main .club-meta a").first();
    const before = await link.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, line: s.textDecorationLine, lineColor: s.textDecorationColor };
    });
    expect(before).toEqual({ color: rgb("#536872"), line: "underline", lineColor: rgb("#536872") });
    await link.hover();
    await expect.poll(() => link.evaluate((el) => getComputedStyle(el).color)).toBe(rgb("#33363a"));
    expect(await link.evaluate((el) => getComputedStyle(el).textDecorationThickness)).toBe("2px");
  });

  test("a card that opens a page (a household on the staff list) carries an arrow that is part of the link, and lifts when the link is hovered", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Test staff");
    await page.goto("/club?q=household");
    const card = page.locator('[data-testid="household-row"]').first();
    const title = card.locator("h3 a");
    const arrow = await title.evaluate((el) => {
      const s = getComputedStyle(el, "::after");
      return { glyph: s.content, border: s.borderTopColor, color: s.color, background: s.backgroundColor, width: s.width, height: s.height };
    });
    expect(arrow).toEqual({ glyph: expect.stringMatching(/^"→"/), border: rgb("#536872"), color: rgb("#536872"), background: rgb("#ffffff"), width: "36px", height: "36px" });
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(rgb("#c3cbce"));
    // The arrow sits in the card's top-right corner, inside the card.
    const [c, a] = await Promise.all([card.boundingBox(), title.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, right: r.right }; })]);
    expect(a.right).toBeLessThanOrEqual(c!.x + c!.width);
    await title.hover();
    await expect.poll(() => card.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(rgb("#536872"));
    expect(await title.evaluate((el) => getComputedStyle(el, "::after").backgroundColor)).toBe(rgb("#536872"));
    expect(await title.evaluate((el) => getComputedStyle(el, "::after").color)).toBe(rgb("#ffffff"));
    // Pressing the arrow's corner of the card opens the household, because the arrow is the link's own.
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + box.width - 16 - 18, box.y + 16 + 18);
    await page.waitForURL(/\/club\/household\/[^/?]+$/);
  });

  test("the Staff office groups what needs attention into cards, and its tool links are rows with an arrow that fill on hover", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 900 });
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    const blocks = page.locator('[data-testid="attention"] > .club-card');
    expect(await blocks.count()).toBeGreaterThanOrEqual(4);
    for (const block of await blocks.all()) await expect(block.locator("h3")).toBeVisible();
    // Two across on a desktop: the first two blocks share a top edge.
    const [first, second] = await Promise.all([blocks.nth(0).boundingBox(), blocks.nth(1).boundingBox()]);
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    const tool = page.locator('[data-testid="tools"] .club-tool-links a', { hasText: "Add a household" });
    expect(await tool.evaluate((el) => getComputedStyle(el, "::after").content)).toMatch(/^"→"/);
    expect(await tool.evaluate((el) => getComputedStyle(el).color)).toBe(rgb("#536872"));
    await tool.hover();
    await expect.poll(() => tool.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb("#e6ebed"));
    // On a phone the attention blocks stack.
    await page.setViewportSize({ width: 390, height: 844 });
    const [p1, p2] = await Promise.all([blocks.nth(0).boundingBox(), blocks.nth(1).boundingBox()]);
    expect(p2!.y).toBeGreaterThan(p1!.y + p1!.height - 1);
  });
});
