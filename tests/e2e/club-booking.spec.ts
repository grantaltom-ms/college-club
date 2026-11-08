import { expect, test, type Page } from "@playwright/test";
import { slot, pickSlot, slotHref, startPick } from "./helpers";

/**
 * The test server's clock stands still at 1 pm Pacific on Wednesday Oct 28, 2026 (see playwright.config.ts).
 * The invented club has these bookings already: Thu Oct 29 Heron 7 am (Sasha Bellweather), Loon 6 am (Erik Lindqvist
 * with Maren Lindqvist), Dock slip A 7 to 9 am (Walter Pemberton); Fri Oct 30 Osprey 8 am (Tomas Vandermeer);
 * and Merganser is out of service. All tests share one server, so each uses its own member, boat and slot.
 */

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};

type ShellKind = "single" | "double" | "quad" | "eight";

/** Seat filter for a known sample boat. Keeps the day view small now that the full iCrew fleet is seeded. */
function shellKindFor(item: string): ShellKind {
  if (["Loon", "Pelican", "Tern", "Starling"].includes(item)) return "double";
  if (item === "Albatross") return "quad";
  return "single";
}

/** Pacific hour (0–23) from a slot range like "9:00 to 9:30 am" or "1:00 to 1:30 pm". */
function hourFromRange(range: string): number {
  const m = /^(\d{1,2}):\d{2} to .+ (am|pm)$/i.exec(range.trim());
  if (!m) throw new Error(`bad range: ${range}`);
  let h = Number(m[1]);
  const ap = m[2].toLowerCase();
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h;
}

/**
 * Open Reservations. For shells, pass a size and (usually) an hour — the dense free list only
 * appears after an hour is chosen. Omit `hour` to land on the “choose an hour” screen.
 */
const openDay = (page: Page, day: string, type?: string, kind?: ShellKind, hour?: number) => {
  if (type === "Shell") {
    const q = new URLSearchParams({ day, what: "shell", kind: kind ?? "single" });
    if (hour !== undefined) q.set("hour", String(hour));
    return page.goto(`/club/book?${q.toString()}`);
  }
  return page.goto(`/club/book?day=${day}${type ? `&type=${encodeURIComponent(type)}` : ""}`);
};

/** Open the shell dense list at the hour of a known slot range. */
const openShellHour = (page: Page, day: string, range: string, kind?: ShellKind) =>
  openDay(page, day, "Shell", kind, hourFromRange(range));

const shellRow = (page: Page, item: string) => page.locator(`[data-testid="shell-row"][data-item="${item}"]`);

/** From the day view: click a free slot, optionally change the length, and book it. Ends on My bookings. */
async function book(page: Page, opts: { item: string; day: string; range: string; minutes?: number; type?: string; kind?: ShellKind }) {
  const kind = opts.kind ?? (opts.type === undefined || opts.type === "Shell" ? shellKindFor(opts.item) : undefined);
  if (opts.type === undefined || opts.type === "Shell") {
    await openShellHour(page, opts.day, opts.range, kind);
  } else {
    await openDay(page, opts.day, opts.type, kind);
  }
  await pickSlot(page, opts.item, opts.range, "free");
  await expect(page.getByRole("heading", { level: 1, name: `Book ${opts.item}` })).toBeVisible();
  if (opts.minutes) {
    await page.getByLabel("Length").selectOption(String(opts.minutes));
    await page.getByRole("button", { name: "Check my choices" }).click();
  }
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: `Book ${opts.item}`, exact: true }).click();
  await expect(page.getByTestId("booked-note")).toBeVisible();
}

/** Cancel everything this member still has coming up, so a retried test starts clean. */
async function cancelAll(page: Page) {
  await page.goto("/club/my-bookings");
  const buttons = page.getByRole("button", { name: /^Cancel / });
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

// Cancelled bookings stay in the Past list as the record, so look in the right list: this server may have run these tests before.
const upcomingRows = (page: Page) => page.getByRole("list", { name: "Upcoming bookings" }).getByTestId("booking-row");
const pastRows = (page: Page) => page.getByRole("list", { name: "Past bookings" }).getByTestId("booking-row");
const row = (page: Page, text: string) => upcomingRows(page).filter({ hasText: text });
const pastRow = (page: Page, text: string) => pastRows(page).filter({ hasText: text });

test("the length is one dropdown of 30-minute steps up to 3 hours, starting at 1 hour 30 minutes, and choosing one checks it at once", async ({ page }) => {
  // Look only: nothing is booked, and no other test uses this boat at this hour.
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-11-06", "5:00 to 5:30 am", "single");
  await pickSlot(page, "Kingfisher", "5:00 to 5:30 am", "free");
  await expect(page.getByRole("heading", { level: 1, name: "Book Kingfisher" })).toBeVisible();

  const length = page.getByLabel("Length");
  await expect(length).toBeVisible();
  await expect(length.locator("option")).toHaveText(["30 minutes", "1 hour", "1 hour 30 minutes", "2 hours", "2 hours 30 minutes", "3 hours"]);
  await expect(length).toHaveValue("90");
  await expect(page.getByTestId("booking-when")).toContainText("5:00 to 6:30 am");
  // The row of bubbles is gone: no link for a length anywhere on the form.
  for (const name of ["1 hour", "2 hours", "3 hours"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);

  // Choosing a length checks it at once, with no button to press, and the choice stays selected.
  await length.selectOption("180");
  await expect(page).toHaveURL(/minutes=180/);
  await expect(page.getByTestId("booking-when")).toContainText("5:00 to 8:00 am");
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await expect(page.getByLabel("Length")).toHaveValue("180");
  await page.getByLabel("Length").selectOption("30");
  await expect(page.getByTestId("booking-when")).toContainText("5:00 to 5:30 am");
});

test("a length longer than 3 hours cannot be chosen: asking for 4 hours in the address falls back to the 90-minute start", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-11-06", "5:00 to 5:30 am", "single");
  const href = await slotHref(page, "Kingfisher", "5:00 to 5:30 am", "free");
  await page.goto(`${href}&minutes=240`);
  await expect(page.getByLabel("Length")).toHaveValue("90");
  await expect(page.getByTestId("booking-when")).toContainText("5:00 to 6:30 am");
  await expect(page.getByLabel("Length").locator("option[value='240']")).toHaveCount(0);
});

test("core flow: pick a member, find a free single, book it, see it in My bookings, cancel it, and see the slot free again", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await cancelAll(page);

  await openShellHour(page, "2026-10-31", "9:00 to 9:30 am", "single");
  await expect(page.getByTestId("day-heading")).toHaveText(/^Saturday, Oct 31$/);
  await expect(page.getByTestId("placeholder-note")).toBeVisible();
  await expect(page.getByTestId("shell-window")).toBeVisible();
  // Pick Kingfisher's 9:00 am half hour, the free single.
  await pickSlot(page, "Kingfisher", "9:00 to 9:30 am", "free");
  await expect(page.getByRole("heading", { level: 1, name: "Book Kingfisher" })).toBeVisible();
  await expect(page.getByTestId("booking-when")).toContainText("Saturday, Oct 31, 9:00 to 10:30 am");
  await expect(page.getByTestId("check-ok")).toHaveText("This booking meets the rules.");
  // The rules that apply are shown, with the placeholder warning.
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("Rules for Kingfisher (single)");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("These numbers are placeholders");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("The shortest booking is 30 minutes and the longest is 3 hours.");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("Book up to 14 days ahead.");
  await expect(page.getByRole("region", { name: "Rules" })).toContainText("There is no limit on how many shell bookings you can hold or make in a day.");
  await page.getByRole("button", { name: "Book Kingfisher", exact: true }).click();

  // My bookings shows it.
  await expect(page).toHaveURL(/\/club\/my-bookings\?booked=/);
  await expect(page.getByTestId("booked-note")).toHaveText("Booked: Kingfisher, Saturday, Oct 31, 9:00 to 10:30 am.");
  await expect(row(page, "Kingfisher")).toContainText("Saturday, Oct 31, 9:00 to 10:30 am");
  await expect(row(page, "Kingfisher").getByTestId("booking-status")).toHaveText("Upcoming");

  // Dense list: own slots in that hour read "yours"; another member no longer sees a fully taken boat (free-only).
  await openDay(page, "2026-10-31", "Shell", "single", 9);
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "yours")).toHaveCount(1);
  await expect(slot(page, "Kingfisher", "9:30 to 10:00 am", "yours")).toHaveCount(1);
  await openDay(page, "2026-10-31", "Shell", "single", 10);
  await expect(slot(page, "Kingfisher", "10:00 to 10:30 am", "yours")).toHaveCount(1);
  await expect(slot(page, "Kingfisher", "10:30 to 11:00 am", "free")).toHaveCount(1);
  await actAs(page, "Tomas Vandermeer");
  await openDay(page, "2026-10-31", "Shell", "single", 9);
  await expect(shellRow(page, "Kingfisher")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Abernathy");

  // Cancel it, and the slot is free again for everyone.
  await actAs(page, "Nora Abernathy");
  await page.goto("/club/my-bookings");
  await row(page, "Kingfisher").getByRole("button", { name: /^Cancel Kingfisher/ }).click();
  await expect(page.getByTestId("cancelled-note")).toHaveText("Cancelled Kingfisher. The time is free for others again.");
  // The list also holds a member's class sign-ups, so "nothing booked" is not the test any more: the booking has left Upcoming.
  await expect(row(page, "Kingfisher")).toHaveCount(0);
  await expect(pastRow(page, "Kingfisher").first().getByTestId("booking-status")).toHaveText("Cancelled");
  await openShellHour(page, "2026-10-31", "9:00 to 9:30 am", "single");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "free")).toHaveCount(1);
  await actAs(page, "Tomas Vandermeer");
  await openShellHour(page, "2026-10-31", "9:00 to 9:30 am", "single");
  await expect(slot(page, "Kingfisher", "9:00 to 9:30 am", "free")).toHaveCount(1);
});

test("second flow: book a double with a qualified crewmate, who then sees it as theirs", async ({ page }) => {
  await actAs(page, "Hollis Whitcombe");
  await cancelAll(page);

  await openShellHour(page, "2026-10-31", "7:00 to 7:30 am", "double");
  await pickSlot(page, "Pelican", "7:00 to 7:30 am", "free");
  await expect(page.getByRole("heading", { level: 1, name: "Book Pelican" })).toBeVisible();
  // Only members who hold the qualification a double needs can be chosen as crew.
  const crew = page.getByRole("group", { name: /Crew/ });
  await expect(crew).toContainText("up to 1 other");
  await expect(crew.getByLabel("Maren Lindqvist")).toBeVisible();
  await expect(crew.getByLabel("Ines Castellanos")).toHaveCount(0); // holds no qualification
  await expect(crew.getByLabel("Hollis Whitcombe")).toHaveCount(0); // the booker is already aboard
  await crew.getByLabel("Maren Lindqvist").check();
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("check-ok")).toBeVisible();
  await page.getByRole("button", { name: "Book Pelican", exact: true }).click();
  await expect(row(page, "Pelican")).toContainText("crew: Maren Lindqvist");

  // Maren sees it as hers, without a cancel button; she cannot be put in another boat at the same time.
  await actAs(page, "Maren Lindqvist");
  await page.goto("/club/my-bookings");
  await expect(row(page, "Pelican")).toContainText("you are crew");
  await expect(row(page, "Pelican")).toContainText("booked by Hollis Whitcombe");
  await expect(row(page, "Pelican").getByRole("button")).toHaveCount(0);
  await openShellHour(page, "2026-10-31", "7:00 to 7:30 am", "double");
  await expect(slot(page, "Pelican", "7:00 to 7:30 am", "yours")).toHaveCount(1);
  await openShellHour(page, "2026-10-31", "7:00 to 7:30 am", "single");
  await pickSlot(page, "Osprey", "7:00 to 7:30 am", "free");
  await expect(page.getByTestId("refusal-reasons")).toContainText("You are already on another boat from 7:00 to 8:30 am.");
  await expect(page.getByRole("button", { name: "Book Osprey" })).toHaveCount(0);

  // Hollis cancels, which frees Maren too.
  await actAs(page, "Hollis Whitcombe");
  await cancelAll(page);
  await actAs(page, "Maren Lindqvist");
  await openShellHour(page, "2026-10-31", "7:00 to 7:30 am", "double");
  await expect(slot(page, "Pelican", "7:00 to 7:30 am", "free")).toHaveCount(1);
});

test("a crew member who is not qualified cannot slip in through the address bar", async ({ page }) => {
  await actAs(page, "Kenji Tanaka");
  await openShellHour(page, "2026-10-30", "6:00 to 6:30 am", "double");
  const href = await slotHref(page, "Tern", "6:00 to 6:30 am", "free");
  await page.goto(`${href}&crew=${await crewId(page, "Ines Castellanos")}`);
  await expect(page.getByTestId("refusal-reasons")).toContainText("Ines Castellanos needs Sculling level 2 (placeholder) to crew Tern.");
  await expect(page.getByRole("button", { name: "Book Tern" })).toHaveCount(0);
});

/** A member's ID, read from the staff list of households' picker page. */
async function crewId(page: Page, name: string): Promise<string> {
  const value = await page.goto("/club/act-as").then(() => page.getByRole("button", { name: `Act as ${name}`, exact: true }).getAttribute("value"));
  return value!.replace("member:", "");
}

test("a refusal is always explained in plain words and never offers a Book button", async ({ page }) => {
  await actAs(page, "Ines Castellanos"); // holds no qualification
  await openShellHour(page, "2026-10-30", "9:00 to 9:30 am", "single");
  await expect(page.getByText("You do not hold that qualification yet").first()).toBeVisible();
  const href = await slotHref(page, "Heron", "9:00 to 9:30 am", "free");
  await page.goto(href);
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["You need Sculling level 1 (placeholder) to use Heron."]);
  await expect(page.getByRole("button", { name: "Book Heron" })).toHaveCount(0);
  // The refusal says what to do next: it is not a dead end, and it does not sound like a matter of waiting ("yet").
  await expect(page.getByRole("heading", { name: "This booking cannot go ahead as chosen" })).toBeVisible();
  await expect(page.getByTestId("refusal-help")).toContainText("ask them to check your record");

  // Straight to the form for a slot that is already taken, and one beyond the booking window.
  const itemId = new URL(href, "http://x").searchParams.get("item")!;
  await actAs(page, "Nora Abernathy");
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-29T14:00:00.000Z`); // Heron, Thu 7 am: Sasha has it
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["Heron is already booked from 7:00 to 8:00 am."]);
  await page.goto(`/club/book/new?item=${itemId}&start=2026-11-12T13:00:00.000Z`); // Thu Nov 12, 5 am: one day too far
  await expect(page.getByTestId("refusal-reasons").getByRole("listitem")).toHaveText(["You can book up to 14 days ahead. Thursday, Nov 12 opens Thursday, Oct 29 at midnight."]);
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-28T19:00:00.000Z`); // 12 noon today: already started
  await expect(page.getByTestId("refusal-reasons")).toContainText("That time has already started. Choose a later time.");
  await page.goto(`/club/book/new?item=${itemId}&start=2026-10-30T11:00:00.000Z`); // 4 am Fri: before the club opens
  await expect(page.getByTestId("refusal-reasons")).toContainText("Heron can be booked from 5:00 am to 8:00 pm.");
});

test("a booking that goes stale between the form and the button is refused by the server, with the same explanation", async ({ page }) => {
  await actAs(page, "Walter Pemberton");
  await openShellHour(page, "2026-10-30", "6:00 to 6:30 am", "single");
  const href = await slotHref(page, "Grebe", "6:00 to 6:30 am", "free");
  const itemId = new URL(href, "http://x").searchParams.get("item")!;
  // Someone else takes Grebe at 6 while Walter's form is open.
  await actAs(page, "Lars Eriksen");
  await cancelAll(page);
  await book(page, { item: "Grebe", day: "2026-10-30", range: "6:00 to 6:30 am" });
  // Walter presses Book on the stale form.
  await actAs(page, "Walter Pemberton");
  const res = await page.request.post("/api/club/bookings", { form: { item: itemId, start: "2026-10-30T13:00:00.000Z", minutes: "60" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  await page.goto(res.headers()["location"]);
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Grebe is already booked from 6:00 to 7:30 am.");
  await actAs(page, "Lars Eriksen");
  await cancelAll(page);
});

test("book, cancel and rebook again and again: nothing limits how many a member holds, and the slots always count right", async ({ page }) => {
  await actAs(page, "Jordan Bellweather");
  await cancelAll(page);
  const pastBefore = await pastRows(page).count();
  const mine = (boat: string, from: string) => upcomingRows(page).filter({ hasText: boat }).filter({ hasText: from });

  for (let round = 1; round <= 3; round++) {
    // The club's own numbers put no limit on how many bookings one member holds or makes in a day: four shell bookings, two on one day.
    await book(page, { item: "Osprey", day: "2026-10-31", range: "6:00 to 6:30 am" });
    await book(page, { item: "Kingfisher", day: "2026-11-01", range: "6:00 to 6:30 am" });
    await book(page, { item: "Heron", day: "2026-11-02", range: "6:00 to 6:30 am" });
    await book(page, { item: "Osprey", day: "2026-10-31", range: "9:00 to 9:30 am" });
    await expect(upcomingRows(page)).toHaveCount(4);
    // Every booking cancelled in the rounds before is still on record, in the Past list.
    await expect(pastRows(page)).toHaveCount(pastBefore + (round - 1) * 4);

    // Cancel one: the slot comes straight back, and the others stay.
    await page.goto("/club/my-bookings");
    await mine("Osprey", "6:00").getByRole("button", { name: /^Cancel Osprey/ }).click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
    await expect(upcomingRows(page)).toHaveCount(3);
    await openDay(page, "2026-10-31", "Shell", "single", 6);
    await expect(slot(page, "Osprey", "6:00 to 6:30 am", "free")).toHaveCount(1);
    await openDay(page, "2026-10-31", "Shell", "single", 9);
    await expect(slot(page, "Osprey", "9:00 to 9:30 am", "yours")).toHaveCount(1);
    await cancelAll(page);
  }
  await page.goto("/club/my-bookings");
  await expect(upcomingRows(page)).toHaveCount(0);
});

test("the clocks go back on Sunday Nov 1: bookable hours still run 5 am to 7 pm with no lost or doubled half hour", async ({ page }) => {
  await actAs(page, "Sasha Bellweather");
  for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
    await openDay(page, day, "Shell", "single");
    const hourOpts = page.getByTestId("hour-select").locator("option");
    await expect(hourOpts, day).toHaveCount(16); // "Choose an hour" + 15 hours
    await openDay(page, day, "Shell", "single", 5);
    await expect(slot(page, "Heron", "5:00 to 5:30 am", "free"), day).toHaveCount(1);
    await expect(slot(page, "Heron", "5:30 to 6:00 am", "free"), day).toHaveCount(1);
    await openDay(page, day, "Shell", "single", 19);
    await expect(slot(page, "Heron", "7:00 to 7:30 pm", "free"), day).toHaveCount(1);
    await expect(slot(page, "Heron", "7:30 to 8:00 pm", "free"), day).toHaveCount(1);
  }
  await cancelAllFor(page);
  await book(page, { item: "Heron", day: "2026-11-01", range: "5:00 to 5:30 am", minutes: 120 });
  await expect(page.getByTestId("booked-note")).toHaveText("Booked: Heron, Sunday, Nov 1, 5:00 to 7:00 am.");
  await openDay(page, "2026-11-01", "Shell", "single", 5);
  for (const r of ["5:00 to 5:30 am", "5:30 to 6:00 am"]) await expect(slot(page, "Heron", r, "yours")).toHaveCount(1);
  await openDay(page, "2026-11-01", "Shell", "single", 6);
  for (const r of ["6:00 to 6:30 am", "6:30 to 7:00 am"]) await expect(slot(page, "Heron", r, "yours")).toHaveCount(1);
  await openDay(page, "2026-11-01", "Shell", "single", 7);
  await expect(slot(page, "Heron", "7:00 to 7:30 am", "free")).toHaveCount(1);
  await cancelAllFor(page);
});

/** Cancel only what this test made (Sasha also holds one sample booking, which stays). */
async function cancelAllFor(page: Page) {
  await page.goto("/club/my-bookings");
  const mine = page.getByRole("button", { name: /^Cancel Heron, 5:00/ });
  while ((await mine.count()) > 0) {
    await mine.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
}

test("members see only free shells this hour; staff also see who holds a taken boat", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-10-29", "7:00 to 7:30 am", "single");
  await expect(shellRow(page, "Heron")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Bellweather");
  await expect(page.locator("body")).not.toContainText("Lindqvist");

  await actAs(page, "Test staff");
  await openShellHour(page, "2026-10-29", "7:00 to 7:30 am", "single");
  await expect(slot(page, "Heron", "7:00 to 7:30 am", "booked")).toContainText("Sasha Bellweather");
  await openShellHour(page, "2026-10-29", "6:00 to 6:30 am", "double");
  await expect(slot(page, "Loon", "6:00 to 6:30 am", "booked")).toContainText("Erik Lindqvist");
});

test("staff take a boat out of service: new bookings stop, existing ones stay, and the members affected are listed", async ({ page }) => {
  // Keep Cormorant's booking address from before it goes out of service, to try it afterwards.
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-11-03", "8:00 to 8:30 am", "single");
  const cormorantHref = await slotHref(page, "Cormorant", "8:00 to 8:30 am", "free");
  await actAs(page, "Tomas Vandermeer");
  await book(page, { item: "Cormorant", day: "2026-11-02", range: "8:00 to 8:30 am", minutes: 60 });

  await actAs(page, "Test staff");
  await page.goto("/club/equipment");
  // Merganser is already out in the invented club.
  await expect(page.getByTestId("equipment-row").filter({ hasText: "Merganser" }).getByTestId("equipment-status")).toContainText("Out of service: Rigger being repaired, expected back Nov 2, 2026");
  const cormorant = page.getByTestId("equipment-row").filter({ hasText: "Cormorant" });
  await expect(cormorant.getByTestId("equipment-status")).toHaveText("In service");
  await cormorant.locator("summary").click();
  await cormorant.getByLabel("Why (members will see this)").fill("Seat repair");
  await cormorant.getByRole("button", { name: "Take Cormorant out of service" }).click();

  await expect(page.getByTestId("affected")).toContainText("Cormorant is now out of service");
  await expect(page.getByTestId("affected-booking")).toHaveCount(1);
  await expect(page.getByTestId("affected-booking")).toContainText("Monday, Nov 2, 8:00 to 9:00 am");
  await expect(page.getByTestId("affected-booking")).toContainText("Tomas Vandermeer (booker, tomas.vandermeer@example.com");
  await expect(page.getByText("Nothing was cancelled")).toBeVisible();

  // The affected member's booking is untouched.
  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/my-bookings");
  await expect(row(page, "Cormorant").getByTestId("booking-status")).toHaveText("Upcoming");
  // Members no longer see an out-of-commission boat on Reservations; a leftover booking link still refuses in words.
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-11-03", "8:00 to 8:30 am", "single");
  await expect(shellRow(page, "Cormorant")).toHaveCount(0);
  await page.goto(cormorantHref);
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Cormorant is out of service (Seat repair).");
  await expect(page.getByRole("button", { name: "Book Cormorant" })).toHaveCount(0);

  // Staff bring it back and new bookings work again.
  await actAs(page, "Test staff");
  await page.goto("/club/equipment");
  await page.getByRole("button", { name: "Return Cormorant to service" }).click();
  await expect(page.getByText("Back in service. New bookings are allowed again.")).toBeVisible();
  await actAs(page, "Nora Abernathy");
  await openShellHour(page, "2026-11-03", "8:00 to 8:30 am", "single");
  await expect(slot(page, "Cormorant", "8:00 to 8:30 am", "free")).toHaveCount(1);

  await actAs(page, "Tomas Vandermeer");
  await page.goto("/club/my-bookings");
  await row(page, "Cormorant").getByRole("button", { name: /^Cancel Cormorant/ }).click();
});

test("staff can book past the rules with a reason, and the record says so", async ({ page }) => {
  await actAs(page, "Test staff");
  // Start clean if an earlier attempt left its booking behind.
  await page.goto("/club/my-bookings");
  const leftover = row(page, "Ines Castellanos").getByRole("button", { name: /^Cancel Heron/ });
  while ((await leftover.count()) > 0) {
    await leftover.first().click();
    await expect(page.getByTestId("cancelled-note")).toBeVisible();
  }
  await openShellHour(page, "2026-11-04", "5:00 to 5:30 am", "single");
  await pickSlot(page, "Heron", "5:00 to 5:30 am", "free");
  await expect(page.getByTestId("check")).toContainText("Choose who this booking is for");
  await page.getByLabel("Booking for").selectOption({ label: "Ines Castellanos (The Castellanos household)" });
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("refusal-reasons")).toHaveText("Ines Castellanos needs Sculling level 1 (placeholder) to use Heron.");

  // Setting the rules aside needs a reason.
  await page.getByLabel("Book past the club rules").check();
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByText("Say why the rules are being set aside")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book Heron" })).toHaveCount(0);

  await page.getByLabel("Why (kept in the record)").fill("Learn-to-row lesson with the coach");
  await page.getByRole("button", { name: "Check my choices" }).click();
  await expect(page.getByTestId("waived-rules")).toContainText("Ines Castellanos needs Sculling level 1 (placeholder) to use Heron.");
  await expect(page.getByTestId("check-ok")).toHaveText("This can be booked as a staff override.");
  await page.getByRole("button", { name: "Book Heron", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "All bookings" })).toBeVisible();
  const lesson = row(page, "Heron").filter({ hasText: "Ines Castellanos" });
  await expect(lesson).toHaveCount(1);
  await expect(lesson).toContainText("staff override: Learn-to-row lesson with the coach");
  await expect(lesson).toContainText("Wednesday, Nov 4, 5:00 to 6:30 am");

  // A staff override never beats a fact: nobody else can take the same slot, override or not.
  await openShellHour(page, "2026-11-04", "5:00 to 5:30 am", "single");
  await expect(slot(page, "Heron", "5:00 to 5:30 am", "booked")).toContainText("Ines Castellanos");
  await actAs(page, "Test staff");
  await page.goto("/club/my-bookings");
  await row(page, "Ines Castellanos").getByRole("button", { name: /^Cancel Heron/ }).click();
  await expect(page.getByTestId("cancelled-note")).toContainText("Cancelled Heron");
});

test("a member whose household has ended is told so and cannot book", async ({ page }) => {
  await actAs(page, "Colm Fitzgerald");
  await openShellHour(page, "2026-10-30", "11:00 to 11:30 am", "single");
  await expect(page.getByTestId("blocked-note")).toContainText("This household's membership ended on Oct 7, 2026, so new bookings are closed.");
  await pickSlot(page, "Osprey", "11:00 to 11:30 am", "free");
  await expect(page.getByTestId("refusal-reasons")).toHaveText("This household's membership ended on Oct 7, 2026, so new bookings are closed.");
  await expect(page.getByRole("button", { name: "Book Osprey" })).toHaveCount(0);
});

test("only staff can see the equipment page", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  const res = await page.goto("/club/equipment");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Equipment" })).toHaveCount(0);
  await actAs(page, "Test staff");
  await expect(page.getByRole("link", { name: "Equipment" })).toBeVisible();
});

test("not signed in as anyone, the booking pages point to the picker", async ({ page }) => {
  for (const path of ["/club/book", "/club/my-bookings", "/club/equipment"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Choose a test member" })).toBeVisible();
  }
  const res = await page.request.post("/api/club/bookings", { form: { item: "x" }, maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()["location"]).toContain("/club/act-as");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("the day view, the booking form and My bookings fit without sideways scrolling, with tappable slots", async ({ page }) => {
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await actAs(page, "Hollis Whitcombe");
    await openShellHour(page, "2026-10-30", "9:00 to 9:30 am", "single");
    expect(await fits()).toBe(true);
    // The start-time dropdown and its Book button are big enough to tap.
    await expect(slot(page, "Heron", "9:00 to 9:30 am", "free")).toBeEnabled();
    for (const control of [startPick(page, "Heron").locator("select"), startPick(page, "Heron").getByRole("button")]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.width).toBeGreaterThan(40);
    }
    await openShellHour(page, "2026-10-30", "9:00 to 9:30 am", "double");
    await pickSlot(page, "Pelican", "9:00 to 9:30 am", "free");
    expect(await fits()).toBe(true);
    await page.goto("/club/my-bookings");
    expect(await fits()).toBe(true);
    await actAs(page, "Test staff");
    await page.goto("/club/equipment");
    expect(await fits()).toBe(true);
    await openShellHour(page, "2026-10-30", "9:00 to 9:30 am", "single");
    expect(await fits()).toBe(true);
  });
});

test("Reservations opens on categories first: gym before shells, kayaks with boards, no dock in October, then shell size before times", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  await page.goto("/club/book");
  await expect(page.getByRole("heading", { level: 1, name: "Reservations" })).toBeVisible();
  await expect(page.getByTestId("book-choose")).toBeVisible();
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  const choose = page.getByTestId("book-choose").getByRole("link");
  await expect(choose.first()).toHaveAttribute("data-browse", "gym");
  await expect(choose.nth(1)).toHaveAttribute("data-browse", "shell");
  await expect(page.getByTestId("book-choose").locator("[data-browse=paddle]")).toBeVisible();
  await expect(page.getByTestId("book-choose").locator("[data-browse=dock]")).toHaveCount(0);

  await page.getByTestId("book-choose").locator("[data-browse=shell]").click();
  await expect(page.getByTestId("shell-kinds")).toBeVisible();
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  // Size strip includes 8x from the iCrew fleet (before a size is chosen).
  await expect(page.getByTestId("shell-kinds").locator("[data-kind=eight]")).toBeVisible();
  await page.getByTestId("shell-kinds").locator("[data-kind=single]").click();
  await expect(page.getByTestId("browse-label")).toHaveText(/Shells · 1x/);
  await expect(page.getByTestId("day-heading")).toBeVisible();
  await expect(page.getByTestId("day-select")).toBeVisible();
  await expect(page.getByTestId("pick-hour-note")).toBeVisible();
  await expect(page.getByTestId("shell-dense")).toHaveCount(0);
  // Choose an hour: dense free list (F+I+J) with weight trailing.
  await openDay(page, "2026-10-30", "Shell", "single", 9);
  await expect(page.getByTestId("shell-window")).toBeVisible();
  await expect(page.getByTestId("shell-dense")).toBeVisible();
  await expect(shellRow(page, "Loon")).toHaveCount(0);
  await expect(shellRow(page, "Heron")).toBeVisible();
  await expect(shellRow(page, "Merganser")).toHaveCount(0);
  await expect(shellRow(page, "Heron").getByTestId("shell-weight")).toContainText(/110-132 lb/);
});

test("a day outside the booking window is not shown silently as another day: the page says so", async ({ page }) => {
  await actAs(page, "Nora Abernathy");
  // Far too late: the last day open is shown, with a sentence that names both days.
  await page.goto("/club/book?day=2026-12-25&what=shell&kind=single");
  await expect(page.getByTestId("day-note")).toHaveText(/^Friday, Dec 25 is further ahead than you can book yet\. Showing \w+, Nov \d+, the last day open\.$/);
  const daySelect = page.getByTestId("day-select");
  await expect(daySelect).toBeVisible();
  const lastDay = await daySelect.locator("option").last().getAttribute("value");
  await expect(daySelect).toHaveValue(lastDay!);
  // Already gone: today, with the other sentence.
  await page.goto("/club/book?day=2026-10-20&what=shell&kind=single");
  await expect(page.getByTestId("day-note")).toHaveText(/^Tuesday, Oct 20 has already passed\. Showing \w+, Oct \d+\.$/);
  await expect(page.getByTestId("day-select")).toHaveValue("2026-10-28");
  // A day on offer, nothing asked for, and nonsense in the address: no note.
  await page.goto("/club/book?day=2026-10-30&what=shell&kind=single");
  await expect(page.getByTestId("day-note")).toHaveCount(0);
  await page.goto("/club/book");
  await expect(page.getByTestId("day-note")).toHaveCount(0);
  await page.goto("/club/book?day=banana&what=shell&kind=single");
  await expect(page.getByTestId("day-note")).toHaveCount(0);
  // Classes are a bulletin of usual days now, not a day strip — no day-note there.
  await page.goto("/club/classes");
  await expect(page.getByTestId("day-note")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Fitness classes" })).toBeVisible();
});
