# CCS member usage dashboard

A password-protected web page for College Club Seattle that shows how members use the club: how often they visit, which days and hours are busy, and which members have gone quiet (with a CSV download for outreach).

It reads three tables in the CCS Supabase project: `members`, `club_totals` and (later) `door_visits` / `reservations`.

## Set up

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase project settings, API). The service key is a master key. Keep it out of chat, email and Git.
   - Optional password: `REQUIRE_PASSWORD=1` plus `DASHBOARD_PASSWORD`. Without `REQUIRE_PASSWORD=1` the dashboard is open to anyone with the link (the page is marked noindex so search engines skip it).
3. `npm run dev`, then open http://localhost:3000

With no Supabase settings, local development shows clearly labelled **sample data** (invented members), so the pages can be tried without touching real names.

## Deploy (Vercel)

Add the Supabase variables above in the Vercel project's Environment Variables, then deploy. If `REQUIRE_PASSWORD=1` is set, the site refuses to open (503) until `DASHBOARD_PASSWORD` is also set. The data endpoint returns an error rather than sample data if Supabase is not configured.

## Checks

`npm run check` runs everything CI runs: lint, type check, unit tests, build, and browser tests (Playwright, against a production build with mocked data). Browser tests need Chromium: `npx playwright install chromium`.

GitHub Actions (`.github/workflows/ci.yml`) runs the same on every push and pull request.

## How the numbers are counted

- Members: adult members on the iCrew roster (staff and juniors removed).
- A visit: any day with a door entry or an iCrew booking. Door and iCrew match by name only.
- Groups: no visits, under 1 a month, 1–2, 2–4, and 4+ a month.
- Door data runs Jan 1 – Sep 27, 2026; bookings through Sep 30.
