import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "../../playwright.config";

const PAGE_TITLE = "Goals and Action Items for Tech and Communications";
const run = Date.now().toString(36);
let counter = 0;
/** A title nobody else's test will use, since all tests share one in-memory list. */
const unique = (label: string) => `${label} ${run}-${test.info().workerIndex}-${++counter}`;

/** Signs in on the goals page. `today` pins the browser's clock so overdue and due-soon are predictable. */
async function openGoals(page: Page, today?: string) {
  if (today) await page.clock.setFixedTime(new Date(`${today}T12:00:00`));
  await page.goto("/goals");
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Show goals" }).click();
  await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
}

const row = (page: Page, title: string) => page.getByRole("listitem", { name: title, exact: true });
const toggle = (page: Page, title: string) => row(page, title).getByRole("button", { name: title, exact: true });
const group = (page: Page, name: string) => page.locator("details.goal-group", { hasText: name });

async function addItem(page: Page, title: string, fields: { group?: string; status?: string; due?: string; owner?: string } = {}) {
  const form = page.getByRole("form", { name: "Add an item" });
  await form.getByLabel("Title").fill(title);
  if (fields.group) await form.getByLabel("Group").fill(fields.group);
  if (fields.status) await form.getByLabel("Status").selectOption(fields.status);
  if (fields.due) await form.getByLabel("Due date (optional)").fill(fields.due);
  if (fields.owner) await form.getByLabel("Owner (optional)").fill(fields.owner);
  await form.getByRole("button", { name: "Add item" }).click();
  await expect(row(page, title)).toBeVisible();
}

/** Opens an item's details (does nothing if already open). */
async function expand(page: Page, title: string) {
  const button = toggle(page, title);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

async function deleteItem(page: Page, title: string) {
  await expand(page, title);
  const item = row(page, title);
  await item.getByRole("button", { name: "Delete item", exact: true }).click();
  await item.getByRole("button", { name: "Yes, delete item" }).click();
  await expect(row(page, title)).toHaveCount(0);
}

const names = async (list: Locator) => list.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));

test.describe("who can see it", () => {
  // Plain fetch carries no cookies, like a stranger who has only the link.
  test("every roadmap address refuses strangers and bad cookies", async ({ baseURL }) => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const calls: [string, string, unknown?][] = [
      ["GET", "/api/roadmap"],
      ["POST", "/api/roadmap/items", { title: "x" }],
      ["PATCH", `/api/roadmap/items/${id}`, { status: "Done" }],
      ["DELETE", `/api/roadmap/items/${id}`],
      ["POST", `/api/roadmap/items/${id}/notes`, { body: "x" }],
      ["DELETE", `/api/roadmap/notes/${id}`],
    ];
    for (const cookie of [undefined, "ccs_members=9999999999.deadbeef", "ccs_members=1.deadbeef"]) {
      for (const [method, path, body] of calls) {
        const res = await fetch(`${baseURL}${path}`, {
          method,
          headers: { ...(cookie ? { cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(res.status, `${method} ${path} with ${cookie ?? "no cookie"}`).toBe(401);
        expect((await res.json()).error).toMatch(/Sign in/);
      }
    }
  });

  test("the public data endpoints carry none of the roadmap", async ({ baseURL }) => {
    for (const path of ["/api/dashboard", "/api/email", "/api/shells", "/api/reservations"]) {
      const text = await (await fetch(`${baseURL}${path}`)).text();
      expect(text, path).not.toMatch(/Caitlin|roadmap|Mailchimp triggers/);
    }
  });

  test("the page shows a password form, rejects a wrong password, and signing out locks it again", async ({ page }) => {
    await page.goto("/goals");
    await expect(page.getByRole("heading", { level: 1, name: PAGE_TITLE, exact: true })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByText("Pick 2-3 engagement tracks")).toHaveCount(0);

    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Show goals" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That password is not right." })).toBeVisible();

    for (let i = 0; i < 3; i++) {
      await page.getByLabel("Password").fill(E2E_PASSWORD);
      await page.getByRole("button", { name: "Show goals" }).click();
      await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByLabel("Password")).toBeVisible();
      await expect(page.getByRole("form", { name: "Add an item" })).toHaveCount(0);
    }
  });

  test("signing in on the Members page also opens the goals, and the nav has a Goals tab", async ({ page }) => {
    await page.goto("/members");
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Show members" }).click();
    await expect(page.getByText(/Showing 1–25 of 550 members/)).toBeVisible();
    await page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link", { name: "Goals" }).click();
    await expect(page).toHaveURL(/\/goals$/);
    await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
  });
});

test.describe("the roadmap API checks what it is sent", () => {
  test("bad input gets a plain sentence and a 4xx, never a crash", async ({ baseURL }) => {
    const login = await fetch(`${baseURL}/api/members/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: E2E_PASSWORD }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const send = (method: string, path: string, body?: string) =>
      fetch(`${baseURL}${path}`, { method, headers: { cookie, "Content-Type": "application/json" }, body });
    const missing = "00000000-0000-4000-8000-00000000dead";

    const cases: [string, string, string | undefined, number, RegExp][] = [
      ["POST", "/api/roadmap/items", "{not json", 400, /could not be read/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "  " }), 400, /title/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "x".repeat(201) }), 400, /up to 200 characters/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "ok", status: "Finished" }), 400, /status must be one of/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "ok", dueDate: "2026-02-30" }), 400, /real date/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "ok", parentId: missing }), 404, /no longer exists/],
      ["POST", "/api/roadmap/items", JSON.stringify({ title: "x", pad: "y".repeat(25_000) }), 413, /too much text/],
      ["PATCH", `/api/roadmap/items/${missing}`, JSON.stringify({ status: "Done" }), 404, /no longer exists/],
      ["PATCH", "/api/roadmap/items/not-an-id", JSON.stringify({ status: "Done" }), 404, /no longer exists/],
      ["DELETE", `/api/roadmap/items/${missing}`, undefined, 404, /no longer exists/],
      ["POST", `/api/roadmap/items/${missing}/notes`, JSON.stringify({ body: "hi" }), 404, /no longer exists/],
      ["DELETE", `/api/roadmap/notes/${missing}`, undefined, 404, /no longer exists/],
    ];
    for (const [method, path, body, status, message] of cases) {
      const res = await send(method, path, body);
      expect(res.status, `${method} ${path} ${body?.slice(0, 40)}`).toBe(status);
      expect((await res.json()).error).toMatch(message);
    }

    // A subitem cannot have a subitem: two levels only.
    const parent = (await (await send("POST", "/api/roadmap/items", JSON.stringify({ title: unique("API parent") }))).json()).item;
    const child = (await (await send("POST", "/api/roadmap/items", JSON.stringify({ title: unique("API child"), parentId: parent.id }))).json()).item;
    const grandchild = await send("POST", "/api/roadmap/items", JSON.stringify({ title: "no", parentId: child.id }));
    expect(grandchild.status).toBe(400);
    expect((await grandchild.json()).error).toMatch(/top-level/);

    // Deleting the parent deletes the child and its notes.
    await send("POST", `/api/roadmap/items/${child.id}/notes`, JSON.stringify({ body: "on the child" }));
    expect((await send("DELETE", `/api/roadmap/items/${parent.id}`)).status).toBe(200);
    const after = await (await send("GET", "/api/roadmap")).json();
    expect(after.items.some((i: { id: string }) => i.id === parent.id || i.id === child.id)).toBe(false);
    expect(after.notes.some((n: { itemId: string }) => n.itemId === child.id)).toBe(false);
  });
});

test.describe("using the page", () => {
  test("shows the starting content, with dates and statuses from the meeting", async ({ page }) => {
    await openGoals(page, "2026-10-14");
    await expect(page.getByRole("heading", { level: 1, name: PAGE_TITLE, exact: true })).toBeVisible();
    for (const name of ["Member engagement", "Usage data and dashboard", "Offseason usage and revenue", "Systems (iCrew and website)"]) {
      await expect(group(page, name)).toBeVisible();
    }
    const room = row(page, "Bring the room rental program to the board with usage data");
    await expect(room.getByLabel("Status of Bring the room rental program to the board with usage data")).toHaveValue("In progress");
    await expect(room.getByText("Due in 6 days (Oct 20)")).toBeVisible();
    await expect(room.getByText("0 of 3 done")).toBeVisible();
    await expect(row(page, "Draft a personal new-member email from Grant, sent about 15 days after joining").getByText("Due Oct 23")).toBeVisible();
    await expect(row(page, "Usage dashboard: built and live (Overview, Timing, Members, Email)").getByLabel(/^Status of/)).toHaveValue("Done");
    await expect(row(page, "Connect Mailchimp to the dashboard").getByLabel(/^Status of/)).toHaveValue("Waiting");
    await expect(page.getByText(/\d+ open · \d+ overdue · \d+ due in the next 7 days · \d+ done/)).toBeVisible();
    // The first note on an item is there, with a time.
    await expand(page, "Bring the room rental program to the board with usage data");
    const notes = page.getByRole("region", { name: "Notes for Bring the room rental program to the board with usage data" });
    await expect(notes).toContainText("Rentals currently run Sat-Tue, $500 for 5 hours");
    await expect(notes.locator("time")).toHaveCount(1);
  });

  test("add an item, change its date, add notes and a subitem, edit, change status, then delete it", async ({ page }) => {
    const title = unique("Plan the fall mailer");
    const grp = unique("Flow group");
    await openGoals(page, "2026-10-14");

    // Add: title, group, status, date, owner.
    await addItem(page, title, { group: grp, status: "In progress", due: "2026-10-16", owner: "Caitlin" });
    const item = row(page, title);
    await expect(group(page, grp)).toBeVisible();
    await expect(item.getByLabel(`Status of ${title}`)).toHaveValue("In progress");
    await expect(item.getByText("Due in 2 days (Oct 16)")).toBeVisible();
    await expect(item.getByText("Owner: Caitlin")).toBeVisible();

    // Edit the title, owner and date; then clear the date.
    await expand(page, title);
    const edit = item.getByRole("form", { name: `Edit ${title}` });
    const renamed = `${title} (renamed)`;
    await edit.getByLabel("Title").fill(renamed);
    await edit.getByLabel("Owner").fill("Grant");
    await edit.getByLabel("Due date").fill("2026-10-10");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, renamed)).toBeVisible();
    await expect(row(page, title)).toHaveCount(0);
    const renamedRow = row(page, renamed);
    await expect(renamedRow.getByText("Overdue by 4 days (Oct 10)")).toBeVisible();
    await expect(renamedRow.getByText("Owner: Grant")).toBeVisible();
    await expect(renamedRow).toHaveAttribute("data-due", "overdue");

    const editRenamed = renamedRow.getByRole("form", { name: `Edit ${renamed}` });
    await editRenamed.getByRole("button", { name: "Clear date" }).click();
    await editRenamed.getByRole("button", { name: "Save changes" }).click();
    await expect(renamedRow.getByText("No due date")).toBeVisible();
    await editRenamed.getByLabel("Due date").fill("2027-01-15");
    await editRenamed.getByRole("button", { name: "Save changes" }).click();
    await expect(renamedRow.getByText("Due Jan 15, 2027")).toBeVisible();

    // Notes: newest first, deletable.
    const notes = renamedRow.getByRole("region", { name: `Notes for ${renamed}` });
    await expect(notes.getByText("No notes yet.")).toBeVisible();
    await notes.getByLabel("New note").fill("First thought");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes.getByText("First thought")).toBeVisible();
    await expect(notes.locator("time")).toHaveCount(1);
    await notes.getByLabel("New note").fill("Second thought\nwith a second line");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes.locator(".goal-note-body")).toHaveText(["Second thought\nwith a second line", "First thought"]);
    await notes.getByRole("button", { name: /^Delete the note from/ }).first().click();
    await expect(notes.locator(".goal-note-body")).toHaveText(["First thought"]);

    // Subitems: progress shows on the parent, but finishing them does not finish the parent.
    const sub1 = unique("Write copy");
    const sub2 = unique("Pick photos");
    const subs = renamedRow.getByRole("region", { name: `Subitems of ${renamed}` });
    for (const [subTitle, owner] of [[sub1, "Ann"], [sub2, ""]]) {
      const form = subs.getByRole("form", { name: `Add subitem to ${renamed}` });
      await form.getByLabel("Subitem title").fill(subTitle);
      if (owner) await form.getByLabel("Owner (optional)").fill(owner);
      await form.getByRole("button", { name: "Add subitem" }).click();
      await expect(row(page, subTitle)).toBeVisible();
    }
    await expect(renamedRow.getByText("0 of 2 done").first()).toBeVisible();
    await row(page, sub1).getByLabel(`Status of ${sub1}`).selectOption("Done");
    await expect(renamedRow.getByText("1 of 2 done").first()).toBeVisible();
    await row(page, sub2).getByLabel(`Status of ${sub2}`).selectOption("Done");
    await expect(renamedRow.getByText("2 of 2 done").first()).toBeVisible();
    await expect(renamedRow.getByLabel(`Status of ${renamed}`)).toHaveValue("In progress"); // parent untouched

    // A subitem has the same fields: date, owner, notes.
    await expand(page, sub2);
    const subEdit = row(page, sub2).getByRole("form", { name: `Edit ${sub2}` });
    await expect(subEdit.getByLabel("Group")).toHaveCount(0); // subitems sit under their parent
    await subEdit.getByLabel("Due date").fill("2026-10-15");
    await subEdit.getByLabel("Owner").fill("Ben");
    await subEdit.getByRole("button", { name: "Save changes" }).click();
    await expect(row(page, sub2).getByText("Done (was due Oct 15)")).toBeVisible();
    await expect(row(page, sub2).getByText("Owner: Ben")).toBeVisible();
    const subNotes = row(page, sub2).getByRole("region", { name: `Notes for ${sub2}` });
    await subNotes.getByLabel("New note").fill("Sub note");
    await subNotes.getByRole("button", { name: "Add note" }).click();
    await expect(subNotes.getByText("Sub note")).toBeVisible();

    // Everything survives a reload.
    await page.reload();
    await expect(row(page, renamed)).toBeVisible();
    await expect(row(page, renamed).getByText("Due Jan 15, 2027")).toBeVisible();
    await expand(page, renamed);
    await expect(row(page, sub1)).toBeVisible();
    await expect(row(page, renamed).getByText("2 of 2 done").first()).toBeVisible();

    // Delete a subitem: ask first, and Cancel keeps it.
    await expand(page, sub1);
    const subRow = row(page, sub1);
    await subRow.getByRole("button", { name: "Delete subitem" }).click();
    await expect(subRow.getByRole("group", { name: `Confirm deleting ${sub1}` })).toContainText("This cannot be undone.");
    await subRow.getByRole("button", { name: "Cancel" }).click();
    await expect(subRow).toBeVisible();
    await subRow.getByRole("button", { name: "Delete subitem" }).click();
    await subRow.getByRole("button", { name: "Yes, delete subitem" }).click();
    await expect(row(page, sub1)).toHaveCount(0);
    await expect(row(page, renamed).getByText("1 of 1 done").first()).toBeVisible();

    // Delete the item: the question says what else goes with it, and Cancel keeps everything.
    const parentRow = row(page, renamed);
    await parentRow.getByRole("button", { name: "Delete item", exact: true }).click();
    const confirm = parentRow.getByRole("group", { name: `Confirm deleting ${renamed}` });
    await expect(confirm).toContainText("This also deletes its 1 subitem.");
    await expect(confirm).toContainText("All 2 notes on it go too.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(row(page, renamed)).toBeVisible();
    await parentRow.getByRole("button", { name: "Delete item", exact: true }).click();
    await parentRow.getByRole("button", { name: "Yes, delete item" }).click();
    await expect(row(page, renamed)).toHaveCount(0);
    await expect(row(page, sub2)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
    await expect(row(page, renamed)).toHaveCount(0);
  });

  test("the filters, and the order within a group, follow the dates", async ({ page }) => {
    await openGoals(page, "2026-10-14");
    const grp = unique("Filter group");
    const overdue = unique("Late one");
    const soon = unique("Soon one");
    const later = unique("Later one");
    const undated = unique("Undated one");
    const done = unique("Finished one");
    const parent = unique("Parent with soon subitem");
    // Added out of order on purpose.
    await addItem(page, undated, { group: grp });
    await addItem(page, later, { group: grp, due: "2026-12-25" });
    await addItem(page, done, { group: grp, due: "2026-10-01", status: "Done" });
    await addItem(page, soon, { group: grp, due: "2026-10-17", status: "Waiting" });
    await addItem(page, overdue, { group: grp, due: "2026-10-10" });
    await addItem(page, parent, { group: grp, due: "2027-03-01" });

    // Sorted by due date within the group, undated last.
    const list = group(page, grp).locator("ul.goal-list > li");
    expect(await names(list)).toEqual([done, overdue, soon, later, parent, undated]);

    // Urgency is written out, not only colored.
    await expect(row(page, overdue).getByText("Overdue by 4 days (Oct 10)")).toBeVisible();
    await expect(row(page, overdue)).toHaveAttribute("data-due", "overdue");
    await expect(row(page, soon)).toHaveAttribute("data-due", "soon");
    await expect(row(page, later)).toHaveAttribute("data-due", "later");
    await expect(row(page, undated)).toHaveAttribute("data-due", "none");
    await expect(row(page, done)).toHaveAttribute("data-due", "done"); // finished items are never overdue
    await expect(row(page, done).getByText("Done (was due Oct 1)")).toBeVisible();

    // A subitem due soon brings its parent into "Due soon".
    await expand(page, parent);
    const form = row(page, parent).getByRole("form", { name: `Add subitem to ${parent}` });
    const sub = unique("Soon subitem");
    await form.getByLabel("Subitem title").fill(sub);
    await form.getByLabel("Due date (optional)").fill("2026-10-15");
    await form.getByRole("button", { name: "Add subitem" }).click();
    await expect(row(page, sub).getByText("Due tomorrow (Oct 15)")).toBeVisible();

    const chips = page.getByRole("group", { name: "Show", exact: true });
    for (let round = 0; round < 3; round++) {
      await chips.getByRole("button", { name: "Open", exact: true }).click();
      await expect(chips.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
      for (const t of [overdue, soon, later, undated, parent]) await expect(row(page, t)).toBeVisible();
      await expect(row(page, done)).toHaveCount(0);

      await chips.getByRole("button", { name: "Due soon", exact: true }).click();
      for (const t of [overdue, soon, parent]) await expect(row(page, t)).toBeVisible(); // overdue counts as due soon
      for (const t of [later, undated, done]) await expect(row(page, t)).toHaveCount(0);

      await chips.getByRole("button", { name: "Done", exact: true }).click();
      await expect(row(page, done)).toBeVisible();
      for (const t of [overdue, soon, later, undated, parent]) await expect(row(page, t)).toHaveCount(0);

      await chips.getByRole("button", { name: "All", exact: true }).click();
      for (const t of [overdue, soon, later, undated, parent, done]) await expect(row(page, t)).toBeVisible();
    }

    // A group with nothing matching disappears while filtered, and the page says so when nothing matches at all.
    await chips.getByRole("button", { name: "Done", exact: true }).click();
    await expect(group(page, "Offseason usage and revenue")).toHaveCount(0);
    await chips.getByRole("button", { name: "All", exact: true }).click();
    await expect(group(page, "Offseason usage and revenue")).toBeVisible();

    // Groups collapse and open again from the keyboard-friendly heading.
    const details = group(page, grp);
    await details.locator("summary").click();
    await expect(details).not.toHaveAttribute("open", "");
    await expect(row(page, later)).toBeHidden();
    await details.locator("summary").click();
    await expect(row(page, later)).toBeVisible();
  });

  test("holds up to repeated use: 20 items added and deleted, 10 notes, status flips, a reload, subitems on several parents", async ({ page }) => {
    test.setTimeout(150_000);
    await openGoals(page, "2026-10-14");
    const grp = unique("Churn group");
    const titles = Array.from({ length: 20 }, () => unique("Churn item"));

    // Add 20 in a row; reload part-way and check nothing was lost.
    for (const [i, title] of titles.entries()) {
      await addItem(page, title, { group: grp, due: i % 2 ? "2026-10-20" : undefined });
      if (i === 9) {
        await page.reload();
        await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
        for (const t of titles.slice(0, 10)) await expect(row(page, t)).toBeVisible();
      }
    }
    await expect(group(page, grp).locator("ul.goal-list > li")).toHaveCount(20);
    await expect(group(page, grp).locator("summary")).toContainText("20 open of 20");

    // Ten notes on one item come back newest first, and persist.
    const target = titles[0];
    await expand(page, target);
    const notes = row(page, target).getByRole("region", { name: `Notes for ${target}` });
    for (let i = 1; i <= 10; i++) {
      await notes.getByLabel("New note").fill(`note ${i}`);
      await notes.getByRole("button", { name: "Add note" }).click();
      await expect(notes.locator(".goal-note-body")).toHaveCount(i);
    }
    await expect(notes.locator(".goal-note-body")).toHaveText(Array.from({ length: 10 }, (_, i) => `note ${10 - i}`));

    // Flip a status back and forth.
    const status = row(page, target).getByLabel(`Status of ${target}`);
    for (let i = 0; i < 8; i++) {
      const next = i % 2 ? "Not started" : "Done";
      await status.selectOption(next);
      await expect(status).toHaveValue(next);
    }
    await status.selectOption("Waiting");
    await page.reload();
    await expect(row(page, target).getByLabel(`Status of ${target}`)).toHaveValue("Waiting");
    await expand(page, target);
    await expect(row(page, target).locator(".goal-note-body")).toHaveCount(10);

    // Subitems on several parents; each parent counts its own.
    const parents = titles.slice(1, 4);
    for (const parent of parents) {
      await expand(page, parent);
      const form = row(page, parent).getByRole("form", { name: `Add subitem to ${parent}` });
      for (let s = 1; s <= 2; s++) {
        await form.getByLabel("Subitem title").fill(`${parent} / step ${s}`);
        await form.getByRole("button", { name: "Add subitem" }).click();
        await expect(row(page, `${parent} / step ${s}`)).toBeVisible();
      }
      await expect(row(page, parent).getByText("0 of 2 done").first()).toBeVisible();
    }
    await row(page, `${parents[1]} / step 1`).getByLabel(/^Status of/).selectOption("Done");
    await expect(row(page, parents[1]).getByText("1 of 2 done").first()).toBeVisible();
    await expect(row(page, parents[0]).getByText("0 of 2 done").first()).toBeVisible();

    // Delete all 20 (three of them with subitems); the question is asked every time.
    for (const title of titles) await deleteItem(page, title);
    await expect(group(page, grp)).toHaveCount(0);
    for (const parent of parents) await expect(row(page, `${parent} / step 1`)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("form", { name: "Add an item" })).toBeVisible();
    await expect(group(page, grp)).toHaveCount(0);
  });

  test("says what went wrong in a plain sentence, and nothing is added", async ({ page }) => {
    await openGoals(page);
    const form = page.getByRole("form", { name: "Add an item" });

    // The browser stops an over-long title before it is sent.
    await form.getByLabel("Title").fill("x".repeat(201));
    await form.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByRole("listitem", { name: "x".repeat(201) })).toHaveCount(0);

    // When the server turns a request down, its sentence is shown and the list is left alone.
    const rejected = unique("Server says no");
    await page.route("**/api/roadmap/items", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "The title can be up to 200 characters. Shorten it and try again." }) })
        : route.continue(),
    );
    await form.getByLabel("Title").fill(rejected);
    await form.getByRole("button", { name: "Add item" }).click();
    const alert = page.locator(".status-error").filter({ hasText: "up to 200 characters" });
    await expect(alert).toContainText("The title can be up to 200 characters. Shorten it and try again.");
    await expect(row(page, rejected)).toHaveCount(0);
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toHaveCount(0);
    await page.unroute("**/api/roadmap/items");
    await form.getByLabel("Title").fill("");

    // A note with only spaces cannot be sent.
    const title = unique("Note check");
    await addItem(page, title);
    await expand(page, title);
    const notes = row(page, title).getByRole("region", { name: `Notes for ${title}` });
    await notes.getByLabel("New note").fill("   ");
    await expect(notes.getByRole("button", { name: "Add note" })).toBeDisabled();
    await deleteItem(page, title);
  });

  test("a server problem shows a plain message and keeps what is on screen", async ({ page }) => {
    await openGoals(page);
    const title = unique("Survives an outage");
    await addItem(page, title);
    await page.route("**/api/roadmap/items/*", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The roadmap could not be reached. Try again in a minute." }) })
        : route.continue(),
    );
    await row(page, title).getByLabel(`Status of ${title}`).selectOption("Done");
    await expect(page.locator(".status-error")).toContainText("The roadmap could not be reached. Try again in a minute.");
    await expect(row(page, title)).toBeVisible();
    await expect(row(page, title).getByLabel(`Status of ${title}`)).toHaveValue("Not started"); // nothing was saved
    await page.unroute("**/api/roadmap/items/*");
    await deleteItem(page, title);
  });

  test("works on a phone: nothing scrolls sideways, even with long titles and everything open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGoals(page, "2026-10-14");
    const title = unique("A very long title that should wrap onto several lines instead of pushing the page wider than the screen " + "word ".repeat(12));
    await addItem(page, title, { group: unique("Group with a long name that also has to wrap nicely"), due: "2026-10-12", owner: "A person with a long name" });
    await expand(page, title);
    await expand(page, "Pick 2-3 engagement tracks and configure Mailchimp triggers");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await deleteItem(page, title);
  });

  test("the sample list is said to be sample, and a note has a readable time", async ({ page }) => {
    await openGoals(page);
    await expect(page.getByRole("note").filter({ hasText: "Sample list." })).toBeVisible();
    await expand(page, "Change the door code shown in the old member portal");
    await expect(row(page, "Change the door code shown in the old member portal").locator("time").first()).toHaveText(/\d{4}/);
  });
});
