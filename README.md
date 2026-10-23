# CCS member usage dashboard

A web page for College Club Seattle that shows how members use the club: how often they visit, which days and hours are busy, boat and shell use, reservations by type, email results, and a shared goals list. It shows counts only, never member names.

It reads these tables in the CCS Supabase project: `members`, `qb_members`, `club_totals` and (later) `door_visits` / `reservations`.

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

## The Goals page

`/goals` ("Goals and Action Items for Tech and Communications") is a living to-do list for the technology and member-communications work: items with a status, due date, owner and group, subitems under any item, and a running log of notes on each. Everything is edited on the page itself.

- **Open.** There is no password: anyone with the link can read and change the roadmap, so share the link only with people who should be able to. The site is marked noindex, so search engines skip it.
- **Set up once.** In the Supabase SQL editor, run `db/roadmap.sql` (the two tables), then `db/roadmap_seed.sql` (the starting content from the October 2026 meeting with Caitlin Sogn). The seed does nothing if the table already has rows, so running it twice is safe. The seed file is generated from `src/lib/roadmap-seed.ts` with `npm run roadmap:seed-sql`.
- **Uses the same settings** as the rest of the site (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); nothing new is needed.
- **In development** (or with `CCS_ALLOW_SAMPLE_DATA=1`) it uses an in-memory copy of the starting content instead of Supabase, so tests never touch the real database.
- "Overdue" and "due soon" (today to 7 days ahead) use the visitor's own clock; "Due soon" also lists anything already overdue. Finishing every subitem shows "3 of 3 done" on the parent but never changes the parent's status.

## The member area (reservation system, test build)

`/club` is the start of the CCS member and reservation system. It is **separate from the dashboard**: its own pages (`src/app/club`), logic (`src/club`) and database schema (`club`, see `supabase/`). Read `CLAUDE.md` for the plan, the decisions and the rules.

- It shows invented households only, and exists while developing or when `CCS_ALLOW_SAMPLE_DATA=1`. It is **never** available when `VERCEL_ENV=production`: set the switch in Vercel Preview only.
- There are no real logins yet. `/club/act-as` lets you act as an invented member (or test staff) to try it.
- **Booking** (step 2): `/club/book` shows what is free by boat or space, `/club/book/new` checks the rules and explains any refusal, `/club/my-bookings` lists and cancels, and test staff get `/club/equipment` to take things out of service. Every rule number lives in `src/club/settings/booking-rules.json` and is a **placeholder** until staff confirm it.
- **Fitness classes** (step 3): `/club/classes` shows each day's classes with chairs left, `/club/classes/[session]` explains the rules and signs you up (or onto the waiting list, which moves up by itself when a chair frees), `/club/my-classes` lists and leaves, and test staff get `/club/classes/manage` to add classes and schedule dates. A class holds its gym or room, and nobody can be in a class and on a boat at once. The numbers live in `src/club/settings/class-rules.json` and are **placeholders**.
- **Events and RSVPs** (step 4): `/club/events` lists what is coming with places left, `/club/events/[event]` explains the rules and lets each adult RSVP with a guest count (or join the waiting list, which moves up by itself), and test staff get `/club/events/manage` to add events plus tools on each event page, including a CSV of personal RSVP links for emails. A personal link (`/club/rsvp/...`) says who is replying without a login; opening it records nothing. The numbers live in `src/club/settings/event-rules.json` and are **placeholders**. Set `CLUB_LINK_SECRET` (see `.env.example`) for links to work in a deployed build.
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
