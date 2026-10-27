# CCS member usage dashboard

A web page for College Club Seattle that shows how members use the club: how often they visit, which days and hours are busy, boat and shell use, reservations by type, email results, and a shared goals list. It shows counts only, never member names.

It reads these tables in the CCS Supabase project: `members`, `qb_members`, `club_totals`, `membership_monthly`, `finance_monthly` and (later) `door_visits` / `reservations`.

**The roster is the QuickBooks member list** (`qb_members`, one row per QuickBooks record, which is one household). Each row says which `members` usage record its visits come from; members with a door fob but no reservation record use door entries as visit days, and members with no record count as no visits. New members who joined this year with no visit yet are shown as "Not started yet" and left out of the "rarely visit" counts. First time: run `db/qb_members.sql` in the Supabase SQL editor, then load the rows (the file has the steps). The member list holds names, so it is never committed. Until `qb_members` has rows, the dashboard shows an error rather than quietly falling back to the iCrew list.

## Set up

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase project settings, API). The service key is a master key. Keep it out of chat, email and Git.
   - There is no password: every page is open to anyone with the link (the site is marked noindex). Member names are removed on the server before any data is sent.
3. `npm run dev`, then open http://localhost:3000

With no Supabase settings, local development shows clearly labelled **sample data** (invented members), so the pages can be tried without touching real names.

## Deploy (Vercel)

Add the Supabase variables above in the Vercel project's Environment Variables, then deploy. The data endpoint returns an error rather than sample data if Supabase is not configured.

## Loading the Shells and Reservations tabs

These two tabs read their own tables, filled from iCrew exports. Neither table holds a name.

| Tab | Table | iCrew export | Prepare it with |
|---|---|---|---|
| Shells | `shell_outings` | Shell usage (`ccs_shellusage.csv`) | `npm run shells:prepare -- ccs_shellusage.csv shell_outings.csv` |
| Reservations | `reservation_counts` | Reservations (`ccs_Reservations.csv`) | `npm run reservations:prepare -- ccs_Reservations.csv reservation_counts.csv` |

First time: run `db/shell_outings.sql` and `db/reservation_counts.sql` in the Supabase SQL editor. To load or refresh a tab: run its prepare command, `truncate` the table, then import the output CSV with the Supabase Table Editor. Until a table is loaded, its tab shows a plain "could not be loaded" message and the rest of the site is unaffected.

The prepare step runs on your own computer: shell rower names are swapped for scrambled codes (used only on the server to count different people), and reservations are reduced to counts per day, start hour and type.

## Loading the Membership tab

The Membership tab reads its own table, filled from the Membership Committee's "Membership Count" workbooks in the Board Shared File (OneDrive). The table holds counts only — one row per month, Total Dues Paying row — never member names.

| Tab | Table | Source | Load it with |
|---|---|---|---|
| Membership | `membership_monthly` | Membership Count 2025-26 and 2026-27 workbooks | `db/membership_monthly.csv` |

First time: run `db/membership_monthly.sql` in the Supabase SQL editor. To load or refresh: `truncate` the table, then import `db/membership_monthly.csv` with the Supabase Table Editor (an empty transferred or waitlist cell loads as null). Until the table is loaded, the Membership tab shows a plain "could not be loaded" message, the home page shows the same in its Membership card, and the rest of the site is unaffected.

The figures are copied exactly as shown in the workbooks, even where a sheet does not add up. The Membership page lists those flags (for example, May and June 2025-26 and Oct 2026-27) instead of correcting them. To fix a figure, fix the workbook and reload the table.

## Loading the Financials tab

The Financials tab reads its own table, filled from the Finance Committee's "CCS Board Reporting Package" workbooks in the Board Shared File (OneDrive). The table holds organizational aggregates only — one row per month, every line of the month P&L sheet plus the package's labeled fiscal year-to-date figures — never member names.

| Tab | Table | Source | Load it with |
|---|---|---|---|
| Financials | `finance_monthly` | Board Reporting Packages, Jul 2025–Jul 2026 | `db/finance_monthly.csv` |

First time: run `db/finance_monthly.sql` in the Supabase SQL editor. To load or refresh: `truncate` the table, then import `db/finance_monthly.csv` with the Supabase Table Editor (an empty note cell loads as null). Until the table is loaded, the Financials tab shows a plain "could not be loaded" message and the rest of the site is unaffected.

The figures are copied exactly as shown in the packages, even where a package's labeled year-to-date figures do not match the sum of its monthly sheets. The Financials page shows both figures side by side in each club year's subtotal row inside the table, with the gap flagged right in that row (for 2025-26: the monthly sheets add up to $1,513,613.39 income and $115,615.84 net, against labeled year-to-date figures of $1,512,233.89 and $91,561.71) instead of correcting either or picking one. To fix a figure, fix the package and reload the table.

The Financials page is table-first: a compact summary strip (latest month, last full club year, loss months), one chart area with a switch between net income by month and income vs. expenses, and the monthly table itself — five columns by default (Month, Income, Expenses, Net income, Net margin), with a "Show full P&L lines" toggle expanding it to all twelve. One club-year filter controls the chart and the table together, and the subtotal rows reflect the filtered view. Below the table sits an "Ask the numbers" panel: deterministic questions computed from the loaded rows only — highest and lowest net-income month, club-year totals, month vs. previous month, month vs. club-year average, month vs. same month last year, loss months, income change over a range, and expenses vs. income over a range — each answered in a sentence with the months it rests on highlighted in the table, and a note when a highlighted month is not in the current club-year view. There is no model behind it, so an answer that cannot be computed from the data says so instead of guessing.

## The Goals page

`/goals` ("Goals and Action Items for Tech and Communications") is a living to-do list for the technology and member-communications work: items with a status, due date, owner and group, subitems under any item, and a running log of notes on each. Everything is edited on the page itself.

- **Open.** There is no password: anyone with the link can read and change the roadmap, so share the link only with people who should be able to. The site is marked noindex, so search engines skip it.
- **Set up once.** In the Supabase SQL editor, run `db/roadmap.sql` (the two tables), then `db/roadmap_seed.sql` (the starting content from the October 2026 meeting with Caitlin Sogn). The seed does nothing if the table already has rows, so running it twice is safe. The seed file is generated from `src/lib/roadmap-seed.ts` with `npm run roadmap:seed-sql`.
- **Uses the same settings** as the rest of the site (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); nothing new is needed.
- **In development** (or with `CCS_ALLOW_SAMPLE_DATA=1`) it uses an in-memory copy of the starting content instead of Supabase, so tests never touch the real database.
- "Overdue" and "due soon" (today to 7 days ahead) use the visitor's own clock; "Due soon" also lists anything already overdue. Finishing every subitem shows "3 of 3 done" on the parent but never changes the parent's status.

## The member area (reservation system, test build)

`/club` is the start of the CCS member and reservation system. It is **separate from the dashboard**: its own pages (`src/app/club`; the menu-bar pages are in `src/app/club/(member)` and the front-desk iPad in `src/app/club/ipad`), logic (`src/club`) and database schema (`club`, see `supabase/`). Read `CLAUDE.md` for the plan, the decisions and the rules.

- It shows invented households only, and exists while developing or when `CCS_ALLOW_SAMPLE_DATA=1`. It is **never** available when `VERCEL_ENV=production`: set the switch in Vercel Preview only.
- **Importing households** (step 7): test staff get `/club/admin/import` (a link in the Staff office). Upload a CSV with one row for each adult (the blank template is a download on that page; its columns are QuickBooks ID, Household name, Membership type, Joined, First name, Last name, Email, and optionally Phone and Role), press **Check the file** to see exactly what it would add (or every problem, with its row number), then **Add these households**. Nothing is saved until the second button; a household whose QuickBooks ID is already here is skipped and never changed, and nothing is ever removed or ended. Only invented files are used while the system is being built; the real import is done by staff at switch-on. Hidden on the live site like the rest of `/club`.
- **The public website** (step 8): `/site` is the club's new public site (Home, About, Membership, Rowing and fitness, Contact, and a Sign in link), in the club's fonts and colors. Like `/club` it is hidden on the live site and shows on previews and while developing. The words are in `src/site/content/site.json` (copied from the club's current public pages on Oct 23, 2026; About and Rowing and fitness are placeholders because the current site's pages for them are for members only; the only email shown is the membership address), and a typo in that file is refused in plain words. No forms yet.
- **Month-end billing** (step 9): test staff get **Charges** (bar and snack-bar sales, and adjustments), **Visitors** and **Monthly billing** in the Staff office. Members sign their visitors in on the front-desk iPad ("I'm bringing visitors"); staff type each bar and snack-bar charge. When a month has finished, **Monthly billing** previews every household's invoice (dues, event tickets, visitor fees, bar, snack bar) and any problem, then **Close** freezes it and makes the files: QuickBooks Online invoice files (in parts QuickBooks will accept) and a plain charges file. Nothing talks to QuickBooks; staff download the files and import them there. A closed month is never reopened: corrections are adjustments dated in a later month. Every number and QuickBooks name is a placeholder in `src/club/settings/billing-rules.json`. Hidden on the live site like the rest of `/club`.
- **Signing in** (step 6): `/club/sign-in` asks for an email address and sends a one-time link (works once, stops working after 15 minutes). Opening the link shows who it can sign in as; pressing the button signs in. Partners who share one address are asked "Which of you?" and the device remembers the answer. Staff sign in the same way from a list in the private setting `CLUB_STAFF_LOGINS` (see `.env.example`), and the record then shows their own name. The page never says whether an address belongs to a member. In a test build no real email is sent: the "email" appears on `/club/outbox`. The numbers (link minutes, days signed in, links per hour) live in `src/club/settings/login-rules.json` and are **placeholders**. `/club/act-as` still lets you act as an invented member (or test staff) to try the club, and only exists with invented data.
- **Booking** (step 2): `/club/book` shows what is free by boat or space, `/club/book/new` checks the rules and explains any refusal, `/club/my-bookings` lists and cancels, and test staff get `/club/equipment` to take things out of service. Every rule number lives in `src/club/settings/booking-rules.json` and is a **placeholder** until staff confirm it.
- **Fitness classes** (step 3): `/club/classes` shows each day's classes with chairs left, `/club/classes/[session]` explains the rules and signs you up (or onto the waiting list, which moves up by itself when a chair frees), `/club/my-classes` lists and leaves, and test staff get `/club/classes/manage` to add classes and schedule dates. A class holds its gym or room, and nobody can be in a class and on a boat at once. The numbers live in `src/club/settings/class-rules.json` and are **placeholders**.
- **Events and RSVPs** (step 4): `/club/events` lists what is coming with spots left, `/club/events/[event]` explains the rules and lets each adult RSVP by picking how many people are coming (counting themselves) with a minus and a plus, telling them before they press anything if there are fewer spots than people; a party that does not fit can join the waitlist (a place is held for an hour unless they press Keep my place, then moves up by itself) or take the smaller number, and test staff get `/club/events/manage` to add events plus tools on each event page, including a CSV of personal RSVP links for emails. A personal link (`/club/rsvp/...`) says who is replying without a login; opening it records nothing. The numbers live in `src/club/settings/event-rules.json` and are **placeholders**. Set `CLUB_LINK_SECRET` (see `.env.example`) for links to work in a deployed build.
- **The staff office** (step 5): test staff get `/club/admin`, a board of what needs a look (boat and space bookings and class chairs that nobody checked in for become no-shows by themselves when their time ends, and staff can put that right), what is on today, what is out of service and who is waiting. `/club/admin/check-in` lets staff check someone in when they cannot do it themselves. Each household's page has staff tools: add a household or an adult, change the membership type, grant a qualification, remove an adult, end a membership (the last two show everything that will be cancelled before anything happens), and change an adult's name, email or phone (each change is written to the household's file with what it said before; changing the email also signs that person out of every device, so a mistyped address can be fixed and they sign in again with the new one). Every check-in and correction is added to a record that is never edited. The club room and work-from-club reservations need no check-in (they are just finished, never a no-show); which kinds those are is in the same settings file. The numbers live in `src/club/settings/attendance-rules.json` and are **placeholders**; house rules are changed through Claude Code, not in the browser.
- **Member check-in**: members check themselves in without staff, two ways. On their own phone, **My bookings** and **My classes** show an "I'm here" button from when check-in opens until the time runs out (and say when it opens before then). On the **front-desk iPad**, a private address (staff find it on **Staff office > Front-desk iPad**; set `CLUB_IPAD_SECRET` for it to work in a deployed build, see `.env.example`) lists only the people who have a boat, space or class they can check in for right now, with a box to type the first letters of a name; they tap their name and then "I'm here", and the screen goes back to the start by itself. Each check-in is added to the record as "on the iPad" or "from their phone", and staff can correct it. Events are still checked off by staff.
- `CCS_CLUB_NOW` freezes the member area's clock (development and tests only).
- **Where the records live.** By default the member area runs on an in-memory sample. Set `CLUB_DATABASE_URL` (a local or throwaway Postgres only; hosted Supabase addresses are refused) and it reads and writes Postgres instead: see `supabase/README.md`. Changes take turns, one at a time, so limits and double bookings are checked against the truth even when many requests arrive together.
- Database tests need a local or throwaway Postgres: see `supabase/README.md`.

## Checks

`npm run check` runs everything CI runs: lint, type check, unit tests, build, and browser tests (Playwright, against a production build with mocked data). Browser tests need Chromium: `npx playwright install chromium`. The member system's database tests also need `CLUB_TEST_DATABASE_URL` (see `supabase/README.md`); without it they are skipped.

GitHub Actions (`.github/workflows/ci.yml`) runs the same on every push and pull request.

## How the numbers are counted

- Members: adult members on the iCrew roster (staff and juniors removed).
- A visit: any day with a door entry or an iCrew booking. Door and iCrew match by name only.
- Groups: no visits, under 1 a month, 1–2, 2–4, and 4+ a month.
- Door data runs Jan 1 – Sep 27, 2026; bookings through Sep 30.
