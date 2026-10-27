import { expect, test, type Page } from "@playwright/test";

/**
 * The archive of old iCrew bookings: staff upload a report, check it, add it, look people up; members see their own. Every test
 * uses invented people and its own booking IDs (the tests share one server), and the whole file runs one test at a time because
 * the archive is shared and these tests count what is in it. Today on the test clock is Wed Oct 28, 2026.
 */
test.describe.configure({ mode: "serial" });

const HEADER = "Date,Day,StartTime,EndTime,BookedOnDate,BookedAtTime,ID,ItemType,Shell/Item,Oars,ReservedBy,Rower(s),OutAt,InAt";
const letters = () => Array.from({ length: 7 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** A word nobody has as a name, so an invented person cannot match anyone already in the club. */
const invented = () => ({ first: cap(letters()), last: cap(letters()) });
let nextId = 700_000_000_000 + Math.floor(Math.random() * 90_000_000) * 100;
const id = () => String(++nextId);

type Row = { day?: string; start?: string; end?: string; id?: string; type?: string; item?: string; by: string; rowers?: string };
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const line = (r: Row) => {
  const [y, m, d] = (r.day ?? "2026-02-10").split("-");
  return [`${m}-${d}-${y}`, "Tuesday", r.start ?? "7:00am", r.end ?? "8:00am", "", "", r.id ?? id(), r.type ?? "Shell", r.item ?? "Cormorant", "", r.by, r.rowers ?? "", "", ""].map(cell).join(",");
};
const csv = (...rows: Row[]) => [HEADER, ...rows.map(line)].join("\r\n") + "\r\n";

const actAs = async (page: Page, who: string) => {
  await page.goto("/club/act-as");
  await page.getByRole("button", { name: `Act as ${who}`, exact: true }).click();
  await expect(page.getByTestId("acting-as")).toHaveText(`Acting as ${who}.`);
};
const openHistory = async (page: Page) => {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/history");
  await expect(page.getByRole("heading", { level: 1, name: "Old bookings" })).toBeVisible();
};
const choose = (page: Page, text: string | Buffer, name: string) => page.locator("#history-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const check = async (page: Page, text: string | Buffer, name: string) => {
  await choose(page, text, name);
  await page.getByTestId("history-check").click();
};
const total = async (page: Page) => {
  await page.goto("/club/admin/history");
  const text = (await page.getByTestId("history-total").textContent()) ?? "";
  return Number(/^([\d,]+)/.exec(text)?.[1].replace(/,/g, "") ?? 0);
};
const addHousehold = async (page: Page, first: string, last: string) => {
  await actAs(page, "Test staff");
  await page.goto("/club/admin/households/new");
  await page.getByLabel("Household name").fill(`The ${last} ${letters()} household`);
  await page.locator("#firstName").fill(first);
  await page.locator("#lastName").fill(last);
  await page.locator("#email").fill(`${first}.${last}.${letters()}@example.com`.toLowerCase());
  await page.getByRole("button", { name: "Add household" }).click();
  await expect(page.getByTestId("changed")).toHaveText("Household added.");
};
const importFile = async (page: Page, text: string, name: string) => {
  await openHistory(page);
  await check(page, text, name);
  await page.getByTestId("history-add").click();
  await expect(page.getByTestId("history-done")).toBeVisible();
};

test.describe("who can use it", () => {
  test("only staff: a member finds neither the page nor the template, and the staff office links to it", async ({ page }) => {
    await actAs(page, "Test staff");
    await page.goto("/club/admin");
    await expect(page.getByTestId("tools").getByRole("link", { name: "Old bookings" })).toBeVisible();
    await actAs(page, "Nora Abernathy");
    expect((await page.goto("/club/admin/history"))?.status()).toBe(404);
    expect((await page.request.get("/api/club/history/template")).status()).toBe(404);
  });

  test("someone not signed in is asked to sign in, and cannot download the template", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    // The menu has a "Sign in" link on every page, so look for the prompt's own sentence.
    const prompt = page.getByText("with your email address to see this page.");
    await page.goto("/club/admin/history");
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId("history-form")).toHaveCount(0);
    await page.goto("/club/my-history");
    await expect(prompt).toBeVisible();
    await expect(page.getByTestId("history-count")).toHaveCount(0);
    expect((await page.request.get("/api/club/history/template")).status()).toBe(404);
    await context.close();
  });

  test("a member has a link to their old bookings on My bookings; staff are pointed to the staff page instead", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/my-bookings");
    await page.getByTestId("old-bookings-link").click();
    await expect(page.getByRole("heading", { level: 1, name: "My old bookings" })).toBeVisible();
    await actAs(page, "Test staff");
    await page.goto("/club/my-bookings");
    await expect(page.getByTestId("old-bookings-link")).toHaveCount(0);
    await page.goto("/club/my-history");
    await expect(page.getByRole("link", { name: "the staff office" })).toHaveAttribute("href", "/club/admin/history");
  });
});

test.describe("the template", () => {
  test("downloads as a CSV with iCrew's columns, and its example rows cannot be added by accident", async ({ page }) => {
    await openHistory(page);
    const res = await page.request.get("/api/club/history/template");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("ccs-old-bookings-template.csv");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(HEADER);
    await check(page, body, "ccs-old-bookings-template.csv");
    const problems = page.getByTestId("history-problems");
    await expect(problems).toContainText("ccs-old-bookings-template.csv has 3 problems");
    await expect(problems).toContainText("one of the template's example rows");
    await expect(page.getByTestId("history-add")).toHaveCount(0);
  });
});

test.describe("adding a report", () => {
  test("shows what a file would do, adds it, and then says there is nothing left to add", async ({ page }) => {
    const a = invented();
    const b = invented();
    const name = `report-${letters()}.csv`;
    const text = csv(
      { by: `${a.first} ${a.last}`, rowers: `${a.first} ${a.last} (1)`, day: "2026-02-10" },
      { by: `${b.first} ${b.last}`, type: "Gym Space", item: "Gym Space 01", day: "2026-02-11" },
      { by: `${b.first} ${b.last}`, type: "", item: "Winter Social", day: "2026-02-12" },
    );
    await openHistory(page);
    const before = await total(page);
    await check(page, text, name);
    await expect(page.getByTestId("history-summary")).toContainText("This would add 3 old bookings, from Feb 10, 2026 to Feb 12, 2026.");
    await expect(page.getByTestId("history-types")).toContainText("Shell: 1");
    await expect(page.getByTestId("history-types")).toContainText("Gym Space: 1");
    await expect(page.getByTestId("history-types")).toContainText("Event: 1");
    await expect(page.getByTestId("names-none")).toHaveText("2");
    await expect(page.getByTestId("names-one")).toHaveText("0");
    await expect(page.getByTestId("history-notices")).toContainText("2 names match no member of the club");
    // Looking changed nothing.
    expect(await total(page)).toBe(before);

    await choose(page, text, name);
    await page.getByTestId("history-check").click();
    await page.getByTestId("history-add").click();
    await expect(page.getByTestId("history-done")).toContainText("Added 3 old bookings.");
    expect(await total(page)).toBe(before + 3);
    const row = page.getByTestId("history-import").filter({ hasText: name });
    await expect(row).toContainText("Test staff");
    await expect(row).toContainText("3 added, 0 skipped");

    // The same file again: everything is already stored.
    await check(page, text, name);
    await expect(page.getByTestId("history-summary")).toContainText("There is nothing to add: every booking in the file is already stored.");
    await expect(page.getByTestId("history-add")).toHaveCount(0);
  });

  test("an overlapping file adds only the new rows and counts the others as skipped", async ({ page }) => {
    const a = invented();
    const first = [{ by: `${a.first} ${a.last}`, id: id() }, { by: `${a.first} ${a.last}`, id: id() }];
    const name = `overlap-${letters()}.csv`;
    await importFile(page, csv(...first), `first-${letters()}.csv`);
    const text = csv(...first, { by: `${a.first} ${a.last}`, id: id() }, { by: `${a.first} ${a.last}`, id: id(), day: "2026-12-30" });
    await openHistory(page);
    await check(page, text, name);
    await expect(page.getByTestId("history-summary")).toContainText("This would add 1 old booking");
    await expect(page.getByTestId("history-summary")).toContainText("2 bookings in the file are already stored and will be skipped.");
    await expect(page.getByTestId("history-notices")).toContainText("1 row is for today or a later day");
    await page.getByTestId("history-add").click();
    await expect(page.getByTestId("history-done")).toContainText("Added 1 old booking.");
    await expect(page.getByTestId("history-done")).toContainText("3 rows in the file were skipped");
  });

  test("lists a file's problems with their row numbers, and nothing can be added", async ({ page }) => {
    const a = invented();
    await openHistory(page);
    const before = await total(page);
    const bad = [HEADER, line({ by: `${a.first} ${a.last}` }), line({ by: `${a.first} ${a.last}`, start: "25:00am" }), line({ by: "", id: "x1" })].join("\r\n");
    await check(page, bad, "bad.csv");
    const problems = page.getByTestId("history-problems");
    await expect(problems).toContainText("bad.csv has 3 problems");
    await expect(problems).toContainText('Row 3: StartTime "25:00am" is not a time of day.');
    await expect(problems).toContainText('Row 4: ID "x1" should be a number, like 123456.');
    await expect(problems).toContainText("Row 4: ReservedBy is empty.");
    await expect(page.getByTestId("history-add")).toHaveCount(0);
    expect(await total(page)).toBe(before);
  });

  test("explains a file that is not iCrew's report, and a file that is not a CSV", async ({ page }) => {
    await openHistory(page);
    await check(page, "Name,Phone\r\nPat,555\r\n", "other.csv");
    await expect(page.getByTestId("history-problems")).toContainText('The file has no column for "Date"');
    await expect(page.getByTestId("history-problems")).toContainText("Is this iCrew's Reservations report?");
    await check(page, Buffer.from("PK\u0003\u0004zip"), "book.xlsx");
    await expect(page.getByTestId("history-problems")).toContainText("looks like an Excel file");
    await page.getByTestId("history-check").click();
    await expect(page.getByTestId("history-problems")).toBeVisible();
    await page.locator("#history-file").setInputFiles([]);
    await expect(page.getByTestId("history-check")).toBeDisabled();
  });

  test("clears a stale preview when a different file is chosen, so Add never belongs to another file", async ({ page }) => {
    const a = invented();
    await openHistory(page);
    await check(page, csv({ by: `${a.first} ${a.last}` }), "one.csv");
    await expect(page.getByTestId("history-add")).toBeVisible();
    await choose(page, csv({ by: `${a.first} ${a.last}` }, { by: `${a.first} ${a.last}` }), "two.csv");
    await expect(page.getByTestId("history-preview")).toHaveCount(0);
    await expect(page.getByTestId("history-add")).toHaveCount(0);
  });

  test("takes a big report: 23,000 bookings, about 3.7 MB, in one go", async ({ page }) => {
    const word = letters();
    const rows: string[] = [HEADER];
    for (let i = 0; i < 23_000; i += 1) {
      const month = String((i % 9) + 1).padStart(2, "0");
      rows.push(`${month}-${String((i % 27) + 1).padStart(2, "0")}-2026,Tuesday,7:00am,8:00am,${month}-01-2026,09:15:00,${id()},Shell,Cormorant Number ${i % 40},Green Comp,Bulk${i % 30}${word} Rower,Bulk${i % 30}${word} Rower (1),7:02am,7:58am`);
    }
    const text = rows.join("\r\n") + "\r\n";
    expect(Buffer.byteLength(text)).toBeGreaterThan(3_000_000);
    expect(Buffer.byteLength(text)).toBeLessThan(4_000_000);
    await openHistory(page);
    const before = await total(page);
    await check(page, text, `year-${word}.csv`);
    await expect(page.getByTestId("history-summary")).toContainText("This would add 23,000 old bookings");
    await page.getByTestId("history-add").click();
    await expect(page.getByTestId("history-done")).toContainText("Added 23,000 old bookings.", { timeout: 60_000 });
    expect(await total(page)).toBe(before + 23_000);
  });

  test("refuses a file over the size limit in words", async ({ page }) => {
    await openHistory(page);
    await choose(page, Buffer.alloc(4_100_000, "a"), "huge.csv");
    await page.getByTestId("history-check").click();
    await expect(page.getByTestId("history-error")).toContainText("The file is too big: it can be up to 4 MB");
  });
});

test.describe("a member's own old bookings", () => {
  test("a member sees what they reserved or rowed, newest first, and nobody else's", async ({ page }) => {
    const me = invented();
    const friend = invented();
    const stranger = invented();
    await addHousehold(page, me.first, me.last);
    const mine = `${me.first} ${me.last}`;
    await importFile(
      page,
      csv(
        { by: mine, day: "2026-03-02", item: "Cormorant" },
        { by: `${friend.first} ${friend.last}`, rowers: `${friend.first} ${friend.last} (1),${mine} (2)`, day: "2026-04-14", item: "Heron Double", start: "8:00am", end: "9:30am" },
        { by: `${stranger.first} ${stranger.last}`, day: "2026-05-05", item: "Skimmer", type: "Paddle Board" },
        { by: `${mine} & ${friend.first}`, day: "2026-01-20", type: "Gym Space", item: "Gym Space 03" },
      ),
      `member-${letters()}.csv`,
    );
    await actAs(page, mine);
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-count")).toHaveText("3 old bookings, newest first.");
    const rows = page.getByTestId("history-row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Heron Double");
    await expect(rows.nth(0)).toContainText("Apr 14");
    await expect(rows.nth(0)).toContainText("8:00 to 9:30 am");
    await expect(rows.nth(0)).toContainText("You were in the boat · with 1 other");
    await expect(rows.nth(1)).toContainText("Cormorant");
    await expect(rows.nth(1)).toContainText("You reserved it");
    await expect(rows.nth(2)).toContainText("Gym Space 03");
    await expect(rows.nth(2)).toContainText("with 1 other");
    // No one else's name or booking is on the page.
    const body = (await page.locator("main, body").first().innerText()).toString();
    expect(body).not.toContain(friend.first);
    expect(body).not.toContain(stranger.first);
    expect(body).not.toContain("Skimmer");

    // Another member sees none of it.
    await actAs(page, "Walter Pemberton");
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-row")).toHaveCount(1);
    await expect(page.getByTestId("history-row")).toContainText("Loft Room 1");
  });

  test("pages through a long history, newest first, fifty at a time", async ({ page }) => {
    const me = invented();
    await addHousehold(page, me.first, me.last);
    const mine = `${me.first} ${me.last}`;
    const rows = Array.from({ length: 120 }, (_, i) => ({ by: mine, day: `2026-0${1 + Math.floor(i / 30)}-${String((i % 28) + 1).padStart(2, "0")}`, item: `Boat ${String(i).padStart(3, "0")}` }));
    await importFile(page, csv(...rows), `long-${letters()}.csv`);
    await actAs(page, mine);
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-count")).toHaveText("120 old bookings, newest first (page 1 of 3, 50 to a page).");
    await expect(page.getByTestId("history-row")).toHaveCount(50);
    await expect(page.getByTestId("history-newer")).toHaveCount(0);
    await page.getByTestId("history-older").click();
    await expect(page.getByTestId("history-count")).toContainText("page 2 of 3");
    await page.getByTestId("history-older").click();
    await expect(page.getByTestId("history-row")).toHaveCount(20);
    await expect(page.getByTestId("history-older")).toHaveCount(0);
    await page.getByTestId("history-newer").click();
    await expect(page.getByTestId("history-row")).toHaveCount(50);
    // A page far past the end is the last page; nonsense is the first.
    await page.goto("/club/my-history?page=99");
    await expect(page.getByTestId("history-count")).toContainText("page 3 of 3");
    await page.goto("/club/my-history?page=abc");
    await expect(page.getByTestId("history-count")).toContainText("page 1 of 3");
  });

  test("a member whose name another member shares is shown nothing, and told to ask staff", async ({ page }) => {
    const twin = invented();
    await addHousehold(page, twin.first, twin.last);
    await addHousehold(page, twin.first, twin.last);
    await importFile(page, csv({ by: `${twin.first} ${twin.last}`, item: "Twin Boat" }), `twin-${letters()}.csv`);
    await actAs(page, `${twin.first} ${twin.last}`).catch(() => undefined);
    // Two buttons carry the same name; take the first.
    await page.goto("/club/act-as");
    await page.getByRole("button", { name: `Act as ${twin.first} ${twin.last}`, exact: true }).first().click();
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-unfindable")).toContainText("could not match your name to your old bookings with confidence");
    await expect(page.getByTestId("history-row")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Twin Boat");
    // Staff can still find it, and see that the name matches more than one member.
    await actAs(page, "Test staff");
    await page.goto(`/club/admin/history?name=${twin.first}+${twin.last}`);
    await expect(page.getByTestId("history-found")).toContainText("Twin Boat");
    await expect(page.getByTestId("history-found")).toContainText("more than one member");
    await expect(page.getByTestId("history-shared")).toContainText(`${twin.first} ${twin.last}`);
  });
});

test.describe("what staff can find", () => {
  test("search finds bookings by the start of a name, with who each name matches", async ({ page }) => {
    const known = invented();
    const unknown = invented();
    await addHousehold(page, known.first, known.last);
    await importFile(page, csv({ by: `${known.first} ${known.last}`, item: "Search Boat" }, { by: `${unknown.first} ${unknown.last}`, item: "Other Boat", rowers: `${unknown.first} ${unknown.last} (1)` }), `search-${letters()}.csv`);
    await page.goto(`/club/admin/history?name=${known.first.slice(0, 5)}`);
    await expect(page.getByTestId("history-found-count")).toHaveText("1 old booking, newest first.");
    await expect(page.getByTestId("history-found")).toContainText("Search Boat");
    await expect(page.getByTestId("history-found")).toContainText(`${known.first} ${known.last} (one member)`);
    await page.goto(`/club/admin/history?name=${unknown.first}+${unknown.last.slice(0, 3)}`);
    await expect(page.getByTestId("history-found")).toContainText(`${unknown.first} ${unknown.last} (no member)`);
    await page.goto("/club/admin/history?name=zz");
    await expect(page.getByTestId("history-too-short")).toBeVisible();
    await page.goto("/club/admin/history?name=qqqqqqqqq");
    await expect(page.getByTestId("history-found-count")).toHaveText("No old bookings found for that name.");
  });

  test("the sample archive is there for the invented club, and names that match no member are listed", async ({ page }) => {
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-count")).toHaveText("4 old bookings, newest first.");
    await expect(page.getByTestId("history-row").first()).toContainText("Cormorant");
    await actAs(page, "Test staff");
    await page.goto("/club/admin/history");
    await expect(page.getByTestId("history-name-totals")).toContainText("match no member");
    await page.goto("/club/admin/history?name=Pat+Visiting");
    await expect(page.getByTestId("history-found")).toContainText("Pat Visitingrower (no member)");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test("the staff page and a member's page fit without sideways scrolling", async ({ page }) => {
    const fits = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await openHistory(page);
    await check(page, csv({ by: "Phone Tester" }), "phone.csv");
    await expect(page.getByTestId("history-preview")).toBeVisible();
    await fits();
    await page.goto("/club/admin/history?name=Pat+Visiting");
    await expect(page.getByTestId("history-found")).toBeVisible();
    await fits();
    await actAs(page, "Nora Abernathy");
    await page.goto("/club/my-history");
    await expect(page.getByTestId("history-row").first()).toBeVisible();
    await fits();
  });
});
