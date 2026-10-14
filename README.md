# CCS member usage dashboard

A web page for College Club Seattle that shows how members use the club: how often they visit, which days and hours are busy, and which members have gone quiet (with a CSV download for outreach).

It reads three tables in the CCS Supabase project: `members`, `club_totals` and (later) `door_visits` / `reservations`.

## Set up

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase project settings, API). The service key is a master key. Keep it out of chat, email and Git.
   - `DASHBOARD_PASSWORD`: the password for the Members page. Everything else is open to anyone with the link (the site is marked noindex). Public data has member names removed; names are only sent after a correct password.
3. `npm run dev`, then open http://localhost:3000

With no Supabase settings, local development shows clearly labelled **sample data** (invented members), so the pages can be tried without touching real names.

## Deploy (Vercel)

Add the Supabase variables above in the Vercel project's Environment Variables, then deploy. The Members page stays locked (503) until `DASHBOARD_PASSWORD` is set. The data endpoint returns an error rather than sample data if Supabase is not configured.

## Loading the Shells and Reservations tabs

These two tabs read their own tables, filled from iCrew exports. Neither table holds a name.

| Tab | Table | iCrew export | Prepare it with |
|---|---|---|---|
| Shells | `shell_outings` | Shell usage (`ccs_shellusage.csv`) | `npm run shells:prepare -- ccs_shellusage.csv shell_outings.csv` |
| Reservations | `reservation_counts` | Reservations (`ccs_Reservations.csv`) | `npm run reservations:prepare -- ccs_Reservations.csv reservation_counts.csv` |

First time: run `db/shell_outings.sql` and `db/reservation_counts.sql` in the Supabase SQL editor. To load or refresh a tab: run its prepare command, `truncate` the table, then import the output CSV with the Supabase Table Editor. Until a table is loaded, its tab shows a plain "could not be loaded" message and the rest of the site is unaffected.

The prepare step runs on your own computer: shell rower names are swapped for scrambled codes (used only on the server to count different people), and reservations are reduced to counts per day, start hour and type.

## Checks

`npm run check` runs everything CI runs: lint, type check, unit tests, build, and browser tests (Playwright, against a production build with mocked data). Browser tests need Chromium: `npx playwright install chromium`.

GitHub Actions (`.github/workflows/ci.yml`) runs the same on every push and pull request.

## How the numbers are counted

- Members: adult members on the iCrew roster (staff and juniors removed).
- A visit: any day with a door entry or an iCrew booking. Door and iCrew match by name only.
- Groups: no visits, under 1 a month, 1–2, 2–4, and 4+ a month.
- Door data runs Jan 1 – Sep 27, 2026; bookings through Sep 30.
