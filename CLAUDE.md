# CCS reservation system: project guide for Claude Code

This file is the standing brief for the **College Club Seattle (CCS) reservation and member system**. It replaces the Oct 20 CLAUDE.md, which was never committed to the repo. This one was rebuilt on Oct 22, 2026 from the Phase 1 kickoff prompt. The system is a **standalone product**: it is separate from the member usage dashboard that shares this repo (see "The dashboard next door").

Read `AGENTS.md` too: this repo runs Next.js 16, which differs from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.

## Who you're working for and how to talk to them

Grant Carlson is a board member and House Committee chair at College Club Seattle, a member-owned rowing and social club on Lake Union. Grant is not a software engineer.

- Explain in plain English, with comparisons to running an apartment building (units, leases, tenants, a front desk, a rent ledger).
- Ask questions as multiple choice, recommended option first, with room for Grant's own answer.
- Skip comprehension checks. Explain, then move on.
- Never say something is finished until lint, type check, build and every test pass. Show the results.

Other people: Caitlin Sogn and Julia (staff) will edit this system with Claude Code themselves. Write code and settings so they can.

## Decisions made on Oct 22, 2026

- **Build path: full replacement.** This app, on Vercel, will become both the CCS public website and its reservation and events system, replacing Wix and iCrew. (Open question 2: answered.)
- **Build on what exists.** Repo `grantaltom-ms/college-club`, Vercel project `college-club` (college-club-gamma.vercel.app). No new repo, Vercel project or Supabase project.
- **Standalone.** The reservation system shares nothing with the dashboard except the repo, the Vercel project and the brand stylesheet. No shared code, tables or data.
- **Built in isolation.** Phase 1 uses fake data only. Nothing goes live to members. Wix, iCrew, Mailchimp, QuickBooks and Brivo are not touched.
- **The household is the unit of membership and billing.** One QuickBooks record is one household. Each adult gets their own login, all linked to the household. Ending a household removes every login in it at once. Juniors and staff are not members in this system. (Open question 8, juniors: answered, out of scope.)
- **QuickBooks:** CSV exports later (one charge line per household per month). No live connection. Nothing in Phase 1.
- **Accounts and domain** are owned by a CCS-owned email shared by a few people, not by one person. Never hard-code keys or passwords. Use environment variables and update `.env.example`.
- **Rollout:** a small pilot group first, then a single cutover date for everyone. Boat reservations move all at once, so never design for iCrew and this system both taking boat bookings.
- **Staff edit with Claude Code.** Keep booking rules and billing logic separate from page content. Every change goes through a preview plus automated checks. Rule settings are editable as data, not code.
- **Git:** branch, pull request, merge, every time. Never commit straight to `main`. Never merge a pull request without Grant's approval.

Answers Grant gave to the Phase 1 plan (Oct 22, 2026):

- Dashboard page files move into a `(dashboard)` route-group folder. Every dashboard URL stays exactly the same. Grant approved this move.
- `/club` is visible locally, in CI and on Vercel preview deployments. It returns "page not found" on the production site.
- Crew on a multi-seat boat do **not** count toward their own limits, but a crew member can't be in two boats at the same time.
- Taking a boat out of service keeps existing bookings. Staff get a list of affected members. Nothing is cancelled automatically.
- Members see only "Booked" on a taken slot, and "Yours" on their own bookings. Staff see names.
- "7 days ahead" means today plus the next 7 calendar days, counted on the Pacific clock.
- Grant turns on GitHub branch protection (pull request plus passing checks required before merge). Steps are in the first pull request.

## Build order (10 steps)

1. Household and member structure, with fake test households
2. Bookable equipment and spaces, with reservation rules (boats first)
3. Fitness classes with capacity and waitlists
4. Events and RSVPs, including links from Mailchimp emails straight to an RSVP
5. Staff admin screen
6. Real logins (one per adult, tied to the household)
7. Importing real members from CCS records
8. Public website pages in the CCS look
9. QuickBooks CSV export
10. iCrew history import and cutover tools

**Phase 1 was steps 1 and 2.** Grant then asked for the Postgres store and step 3 (Oct 22, "Postgres Store then Step 3"). Do not build steps 4 to 10 until Grant says so. Where a Phase 1 choice affects them, leave room for it and say so. Finish step 1, open a pull request, and wait for Grant's review before starting step 2.

## The dashboard next door (do not touch)

The repo also holds the CCS member usage dashboard. The board uses it. Its pages are open to anyone with the link (no login, marked noindex), and member names are stripped on the server before anything reaches the browser. It reads the **live** Supabase project `hgjcnuwxhemynnvsnmou`, which holds real member data (`members`, `qb_members`, `club_totals`, `shell_outings`, `reservation_counts`, `roadmap`).

- Don't change any dashboard page or URL: `/`, `/visits`, `/timing`, `/shells`, `/reservations`, `/email`, `/goals`. Board members have these links.
- Don't change or reuse its tables. `reservation_counts` is dashboard data, not bookings.
- The dashboard tests must keep passing untouched.
- Never connect reservation-system work to the live Supabase project.
- Its page files live in `src/app/(dashboard)/`. The folder name is invisible in URLs.

## Where the reservation system lives

| Thing | Place |
|---|---|
| Member pages | `src/app/club/` (URLs start with `/club`) |
| Data requests | `src/app/api/club/` |
| Logic: households, members, rules | `src/club/` |
| Database tables | their own database schema, `club` |
| Database changes | `supabase/migrations/`, versioned, never applied to the live project in Phase 1 |

Inside `src/club/`: `engine/` holds the rules (the lease terms; every change needs tests), `store/` holds where data is kept (`memory.ts` for the in-memory sample, `postgres.ts` for Postgres; both fit one `ClubStore` interface, so the rules never know which), `sample/` holds the invented households, `identity.ts` is the one "who is the current member" function, `enabled.ts` decides whether `/club` exists at all.

The new tables are an apartment building: household = the lease, member = a person on the lease, household history = the tenant file, qualification = "certified to use the rooftop grill", bookable item = a unit, rule set = the house rules.

## Safety rules for Phase 1

- **`/club` only exists when sample data is allowed** (`src/club/enabled.ts`): in development, or with `CCS_ALLOW_SAMPLE_DATA=1`, and never when `VERCEL_ENV=production`. Otherwise it answers "page not found".
- **The "act as this test member" picker** is the stand-in for login until step 6. It follows the same on/off switch. It is tested absent in a production setting.
- **Every permission check goes through `getCurrentActor()`** in `src/club/identity.ts`. Step 6 replaces what is inside that function and nothing else.
- **Never use `SUPABASE_URL` or the service key for club work.** Club code uses its own `CLUB_DATABASE_URL` (local or test databases only). The Postgres store (`createClubPool`) and the tests both refuse any database address that looks like Supabase. With `CLUB_DATABASE_URL` unset the member area runs on the in-memory sample.
- Fake data only. Invented names only. Never real member data.
- Stop and ask before: spending money (including Supabase branches and paid Vercel features); deleting any file, table or data; connecting to the live Supabase project or applying a migration to it; touching Wix, iCrew, Mailchimp, QuickBooks, Brivo or real member data; changing any dashboard page, table or URL; merging a pull request or changing Vercel production; changing any decision in this file.
- Vercel runs Node 24. CI runs Node 24 as of this change, so tests match what goes live.

## What to keep from iCrew, and where to do better

Keep: members see what's free and book a boat or space themselves; booking windows and limits that stop one person hogging equipment; boats tied to skill levels; staff can take a boat out of service; multi-seat boats are booked as one outing.

Do better:
- One CCS-branded login and site, not a separate iCrew-branded app.
- Built for the whole club (rowing, fitness, social, spaces), not just a boathouse.
- Track whether a booking was actually used. iCrew only counts reservations.
- Keep a real record of when a household joins and leaves. iCrew has none.
- Rules are settings staff can change, not things a vendor configures.
- Every member and household gets a permanent internal ID from day one, with empty slots for QuickBooks, Brivo and Mailchimp IDs. (iCrew and Brivo share no ID today and match by name only.)

## Step 1: households and members (fake data only)

- **Household:** permanent ID, display name ("The Lindqvist household"), membership type (Resident = 33 and over, Intermediate = under 33, Non-Resident = lives farther away and visits rarely), status (active, or ended with an end date), join date, empty slots for QuickBooks ID and notes.
- **Member (one adult):** permanent ID, household, first and last name, email, phone, role (primary or additional adult), status, empty slots for Brivo credential ID, Mailchimp contact ID and future login ID.
- **Qualifications:** a member can hold rowing qualifications (sculling levels). Each records a level, who granted it, and when. Staff grant them; members can't give themselves one.
- **History:** a log per household of every change that matters (joined, member added or removed, type changed, membership ended), with date, what changed, and who changed it. The log can only be added to, never edited.
- **Ending a membership:** every member in the household is blocked from new bookings at once, and all future bookings are cancelled and logged. Past bookings stay as history.
- **Fake data:** about 14 invented households covering a single adult, couples, a three-adult household, each membership type, one ended household, one that joined this month, members with and without rowing qualifications, and one member whose email is shared with a partner. Invented names only; boat names come from `src/lib/shells.ts` when step 2 needs them.
- **Test member picker** and **one "current member" function**, as described above.

## Step 2: bookable equipment and spaces, with rules (built Oct 22; in review)

One engine for everything bookable: Shell, Kayak, Paddle Board, Dock Space, Gym Space, Room Space, Work Space. Fully set up in the fake data: shells, kayaks, paddle boards, plus Dock Space to prove the engine is general.

Each item: name, type, seat count for boats (1 single, 2 double, 4 quad or four), qualification needed (if any), in-service or out-of-service status with reason and expected return date, and the rule set that applies. Rules attach to a type of item (for example "all singles") and individual items can override them.

Every number below is a **placeholder** until staff confirm real values (open question 5). Mark them as placeholders in the settings and on screen during testing.

| Rule | Placeholder value |
|---|---|
| How far ahead a member can book | 7 days |
| When new days open for booking | Midnight Pacific, a rolling window |
| Bookable hours | 5 AM to 8 PM (the club's member hours) |
| Time slots | 30-minute steps |
| Shortest and longest booking | 30 minutes and 2 hours |
| Future bookings one member can hold at once, per type | 2 |
| Bookings one member can have per day, per type | 1 |
| Latest time to cancel without it counting as a no-show | 2 hours before start |
| Gap between bookings of the same boat | 0 minutes (setting exists, off) |
| Qualification needed | Per boat class |

Behavior:
- **No double booking, ever.** Two requests for the same boat at overlapping times at the same moment produce exactly one booking. Enforced in the database (an overlap constraint), not only in the page.
- **Multi-seat boats:** the person booking owns the booking and adds other active members as crew. Each crew member must also be qualified. Crew don't count toward their own limits, but can't be in two boats at once.
- **Clear refusals** in plain language ("You can book up to 7 days ahead. Saturday opens Thursday at midnight."), never a bare error.
- **Cancelling:** members cancel their own bookings. Late cancellations are recorded as late.
- **Out of service:** blocks new bookings. Existing overlapping bookings stay; staff get a list of affected members.
- **Attendance:** every booking ends as upcoming, completed, cancelled, late-cancelled or no-show. Fields and states now; the marking screen comes later.
- **Staff override:** staff can book past the rules (for a lesson). Each override is logged with a reason. A test staff identity in the picker is enough for now.
- **Time zone:** store exact moments, show Pacific time. Clocks fall back on Nov 1, 2026; no lost or doubled slots that day.
- **Screens:** a day view by item (filter by type; members see "Booked" or "Yours"), a booking form that shows the rules and why anything is refused, and "My bookings" with cancel. Plain and functional, CCS fonts and colors, works on a phone.

### Step 2 as built

- **Rules are data.** `src/club/settings/booking-rules.json` holds every number (all marked placeholder) and the item classes (single, double, quad, kayak, paddle board, dock space). Rules layer: defaults, then the class ("all singles"), then the single item. `parseRuleBook` refuses typos and contradictions in words ("maxMinutes (100) must be a whole number of 30-minute slots"), so staff edits are caught by the tests. The database has matching tables (`booking_rule_defaults`, `item_classes`, `items`) so the staff screen in step 5 can edit the same data.
- **The engine** is `src/club/engine/bookings.ts`. `checkBooking` returns every reason a booking is refused, in a fixed order, in plain language, and marks which ones staff may set aside. `createBooking`, `cancelBooking`, `markAttendance`, `takeOutOfService`, `returnToService` do the work, each as one all-or-nothing change.
- **Facts versus rules.** Staff can book past the *rules* (window, hours, step, length, limits, qualification, gap) with a recorded reason, and the record lists exactly which rules were set aside. Staff can never set aside a *fact*: the slot is taken, the item is out of service, the time has passed, the member has left, nobody in two boats at once.
- **Time.** Every time is a real moment; days, hours and "midnight" are Pacific. Slots are stepped in real elapsed time, so Nov 1, 2026 (25 hours) has no lost or doubled slot and Mar 14, 2027 (23 hours) is handled. Late-cancel cutoffs count real hours.
- **No double booking, two layers.** The engine checks first and explains. The database (`club.bookings`, migration `20261023000000`) also refuses an overlap by itself with an exclusion constraint, and lines up competing requests for one item with a lock (without it, colliding requests stalled for about a second on a deadlock instead of getting a clean "taken").
- **Household link.** Ending a membership or removing an adult cancels their future bookings (not late; staff-cancelled), takes them off other people's boats as crew (the booking stays), leaves bookings under way and past ones alone, and writes it to the household's file. All in the same all-or-nothing change.
- **Screens.** `/club/book` (day view, filter by type, days in the window), `/club/book/new` (form that runs the real rule check and shows the rules), `/club/my-bookings` (staff see "All bookings"), `/club/equipment` (staff only: take out of service, return, see affected members).
- **The test clock.** `CCS_CLUB_NOW` (for example `2026-10-28T20:00:00Z`) freezes "now" for the member area, in development and tests only. It does nothing where the member area is switched off.

### The Postgres store (built Oct 22, after step 2)

- **What it is.** `PgClubStore` (`src/club/store/postgres.ts`) keeps the same `ClubStore` interface as the in-memory copy, so the rules engine did not change. With `CLUB_DATABASE_URL` set, `/club` reads and writes Postgres (a local or throwaway one only; hosted Supabase addresses are refused). With `CCS_ALLOW_SAMPLE_DATA=1` too, the invented club is loaded the first time, only if the database has no households.
- **How a change works.** Take one database-wide "writers" lock (shared by every app server), load the current records, let the engine change a working copy, write back exactly what changed, all in one transaction. Writers therefore take turns and always start from the truth. That is what makes a member's limits and "nobody in two boats" race-free (open question G, now answered), with the database's overlap rule still underneath as a second line of defence. Readers take a consistent snapshot and never wait for writers.
- **Rules and the database.** `booking-rules.json` is still the source of the rules; `syncRules` mirrors it into the rule tables on start-up so items can point at their classes. In step 5 the staff screen edits those tables instead.
- **What it loads.** All households, members, history, items and out-of-service entries, and bookings that ended in the last 90 days (`historyDays`). Older bookings stay in the database; the screens' "Past" list shows the last 90 days until a full-history view exists.
- **Never deletes.** The store refuses to delete anything and refuses to rewrite a history line. Bookings are cancelled by status, as in real life.
- **Proof.** The household, booking, household-plus-booking and daylight-saving tests run on both stores (the Postgres run needs `CLUB_TEST_DATABASE_URL`; CI always sets it). Extra tests check that Postgres holds exactly the same sample club as memory, that two app servers sharing one database cannot beat a limit, a slot or a "two boats" rule by racing, that the database overlap rule is translated into a plain refusal, and that the booking browser tests pass on a Postgres-backed server.

Not built yet, on purpose: the attendance-marking screen for boat outings, the staff admin screen, emails or texts.

## Step 3: fitness classes with chairs and a waiting list (built Oct 22; in review)

Grant's answers (Oct 22): the waiting list moves up **automatically and instantly**, first in line first; nobody can be **in two places at once** (two classes, or a class and their own boat, as booker or crew); a class **holds a gym or room space** (members cannot book that space while it runs); **no money** in step 3 (classes are included in membership; fees wait for the QuickBooks step). Assumed unless Grant objects: only staff create and change classes; members see just "full" and their own waiting-list place, never other names; classes have their own section next to Book rather than being folded into My bookings.

The building comparison: a class session is a scheduled use of the clubhouse room. The chairs are its unit count; the waiting list is the applicant queue; a sign-up is a lease on one chair for one evening.

- **Pieces.** A *class* ("Morning Yoga": usual chairs, length, room, instructor, optional own rules). A *session* is one dated occurrence with its own number of chairs, and it holds its room. A *sign-up* is one name on one session's sheet: `enrolled` (has a chair), `waitlisted`, or how it ended: `cancelled`, `late_cancelled`, `attended`, `no_show`.
- **Rules are data.** `src/club/settings/class-rules.json` (placeholders, like the boat rules): sign-up window (14 days, opens at midnight Pacific), closes 30 minutes before, leave without penalty until 2 hours before, the automatic move-up runs until 2 hours before, waiting list up to 10, 5 upcoming places at once (a waiting spot counts), 1 class a day. A class can override any of them under its own `rules`. A typo is refused in words by `parseClassRules`.
- **The engine** is `src/club/engine/classes.ts`: `checkSignUp` (every reason in plain words, read only), `signUp`, `leaveClass`, `markClassAttendance`, `createClass`, `planSessions` / `scheduleSessions` (single or weekly; weekly keeps the same Pacific clock time across the Nov 1 and Mar 14 clock changes), `cancelSession`, `setCapacity`, `sessionView`, and `classLedger`. `engine/ledger.ts` combines it with the boat ledger as `clubLedger`: ending a household or removing an adult now also takes them off future classes (not as a late cancellation), moves the waiting lists up behind them, and writes `signups_cancelled` to the household's file.
- **The waiting list.** A chair freed by someone leaving, by more chairs, or by a member leaving the club goes to the first person waiting, in the same all-or-nothing change. After the move-up cutoff (2 hours before) a free chair goes to whoever asks first, and someone already waiting can take it. Order is the order names were written (database `seq`), so someone who leaves and comes back goes to the end.
- **Facts, not rules.** Unlike boats, staff **cannot** set aside class rules for one member: they raise the chairs instead. Reason: a sign-up has no room in its record for an override reason, and "add a chair" is the honest tool. Open question L.
- **One place at a time.** A chair *or* a waiting spot holds the person's time. Booking a boat is refused if you (or your crew) are in a class then (`in_class`); signing up is refused if a boat is booked then (`boat_busy`) or another class overlaps (`person_busy`). A class holding a room makes `checkBooking` refuse that room (`room_in_use`), for staff too.
- **The database enforces** (migration `20261025000000_club_classes.sql`, tested against a real Postgres): chairs never over-filled, a room never used by two classes or by a class and a booking at once (one lock per room shared by both checks), one live line per person per session, sign-ups only move forward, a session cannot be moved or revived, chairs cannot drop below the people in them. Each rule was broken on purpose to prove a test notices.
- **Screens.** `/club/classes` (pick a day, see chairs left, your place), `/club/classes/[sessionId]` (the rules in words, why a sign-up is refused, sign up / join the waiting list / take a free chair / leave; staff also see the sheet and names, mark attendance, change chairs, cancel the class and see who to contact), `/club/my-classes`, and for staff `/club/classes/manage` (add a class, schedule one date or a weekly run, with every clash explained before anything is saved). The `/club/book` day view shows a room held by a class as "Class".
- **Sample data.** Invented Boathouse gym and Clubhouse room; Morning Yoga, Erg Conditioning, Stretch & Mobility for a fortnight; tomorrow's Erg Conditioning is full (4 chairs) with two people waiting.
- **Not built, on purpose:** emails or texts (a member whose waiting spot became a chair only sees it in My classes; open question N), an attendance screen beyond the buttons on the class page, fees, class series editing (cancel one session and schedule another).

## Testing (required; nothing is done until all of this passes)

CI runs on every push and pull request: install, lint, type check, unit tests, build, browser tests.

- **End-to-end core flow:** pick a test member, find a free single, book it, see it in My bookings, cancel it, see the slot free again. Second flow: book a double with a qualified crewmate.
- **Rule edge tests:** exactly at the booking window and one minute past; max length and one step over; per-member limit and one over; unqualified member on a restricted boat; booking during an out-of-service period.
- **Repeated and realistic use:** book, cancel, rebook many times and limits still count right; many members fill a whole day; the window rolls over at midnight; twenty simultaneous attempts on one boat and slot produce exactly one booking.
- **Household tests:** ending a household blocks every member, cancels future bookings, logs every change, and leaves past history intact.
- **Daylight saving:** bookings on Nov 1, 2026 and the days around it.
- **Safety:** the picker and `/club` are absent in a production setting. No dashboard page shows member names. Dashboard tests pass unchanged.
- All external services are mocked. Tests never touch the live Supabase project or any real service.
- The engine tests run on **both stores** (memory, and Postgres when `CLUB_TEST_DATABASE_URL` is set). Anything the engine does must give the same answer on each. The booking browser tests also run against a Postgres-backed server (Playwright project `postgres`).
- Database rules are tested against a real Postgres (`CLUB_TEST_DATABASE_URL`; CI provides a throwaway one). Without that variable those tests are skipped and say so.

## Open questions

Numbers 2, 5 and 8 keep the numbering from the lost Oct 20 file.

- ~~2. Build path~~ Answered Oct 22: full replacement on Vercel.
- 5. Real booking-rule values (every number in the step 2 table is a placeholder). Waiting on staff.
- ~~8. Juniors~~ Answered Oct 22: out of scope.
- A. Can an ended household come back? Phase 1 says no: a returning household is a new record, so the old history stays closed. Needs Grant's confirmation.
- B. Real qualification names and levels. Phase 1 uses placeholder sculling levels 1 to 3 plus sweep.
- C. A shared email (partners on one address) will clash with "one login per adult" in step 6. Decide how those two logins are told apart.
- D. When the production switch-on happens: the date the `/club` area becomes visible on the production site, and who approves it.
- E. Who gets which Vercel/Supabase/GitHub accounts under the CCS-owned email.
- ~~G. Postgres-backed store and racing requests~~ Answered Oct 22: built. Changes take turns under one database-wide lock, so limits and "two boats" are checked against fresh data. If the club ever gets busy enough for that to be a bottleneck (hundreds of simultaneous bookings), the lock can be narrowed to per-member and per-item locks; not needed now.
- H. Past outings nobody has marked show as "Awaiting attendance record" until the marking screen exists (it comes later). Should unmarked outings count as completed after some days?
- I. What does a late cancellation lead to (a warning after N, a fee, nothing)? Phase 1 only records it.
- J. When a member leaves, other people's boats lose that crew member but keep the booking. Confirm that is what staff want, or whether the owner should be told.
- K. Real class rule values. Every number in `class-rules.json` is a placeholder (open question 5 covers boats).
- L. Should staff be able to sign a member into a class past the rules (a full class, the daily limit) with a recorded reason, as they can for boats? Step 3 says no; staff raise the chairs instead. Confirm.
- M. Past classes nobody has marked show "Awaiting attendance record" (same as question H for boat outings).
- N. Nobody is told when the waiting list moves them up. Step 3 shows it in My classes only. Email or text comes later; decide who sends it and when.
- O. A late cancellation of a class is only recorded (same as question I for boats).
- ~~F. Next.js security advisory~~ Answered Oct 22: Grant merged the upgrade to 16.4.2 (PR 11) before this system was merged. The random "version is affected" build failure is gone.

## Session log

### Oct 22, 2026
- Read the repo (README, AGENTS.md, `src/lib`, `db/`, tests, CI). Found CLAUDE.md missing from every branch; Grant asked for a new one from the kickoff prompt (this file).
- Plan agreed with Grant (answers listed under Decisions above).
- **Built (step 1):**
  - Dashboard pages moved into a `(dashboard)` route group, URLs unchanged; the 52 existing browser tests pass untouched.
  - Member area at `/club`: test-member picker (`/club/act-as`), household page with adults, qualifications and history, and a staff list of all households. Read only.
  - `src/club/`: household rules engine (join, add and remove an adult, change type, grant a qualification, end a membership all-or-nothing), booking-eligibility check, in-memory store, 14 invented households, the single `getCurrentActor()` function, and the on/off switch.
  - Database migration `supabase/migrations/20261022000000_club_households.sql` (schema `club`), with an append-only history table, one-primary-per-household, staff-only qualification grants, and `club.end_household()`. Tested against a real Postgres, and the tests were shown to fail when the migration is deliberately broken.
  - CI: Node 24, a throwaway Postgres service, database tests that cannot be skipped in CI, and two extra production-style servers that prove `/club` and the picker do not exist on the live site.
- **Decided / assumed (Grant to confirm in review):**
  - Removing an adult from a household also blocks them and cancels their future bookings, the same way ending a household does. Not in the original spec.
  - Ended households are final; a returning household is a new record (open question A).
  - Step 1 has no bookings yet, so "cancel future bookings" goes through a `BookingLedger` hook that does nothing until step 2 plugs the real calendar in. Tests prove the hook is called and that a failure rolls everything back.
  - The in-memory store runs the screens; the Postgres store is built in step 2, where the double-booking rule needs it.
- **Next:** Grant reviews step 1, then step 2 (bookable items, rules, booking engine, day view, booking form, My bookings).
- **Blocked / needs Grant:** turn on GitHub branch protection; set `CCS_ALLOW_SAMPLE_DATA=1` in Vercel **Preview** only if previews should show `/club`; real qualification names (B). `supabase/config.toml` has not been tried with the Supabase CLI (no Docker in the cloud session).

### Oct 22, 2026 (later): step 1 merged, step 2 built
- **Done:** Grant merged his two pull requests (Next.js 16.4.2 security upgrade, roster note) and approved merging step 1 once CI passed; step 1 merged as PR 12. Step 2 then built on a fresh branch from `main`.
- **Built (step 2):** rules as data with a checker; the booking engine (all of the behaviors above); invented boats using the shell names from the dashboard sample plus kayaks, paddle boards and dock slips; day view, booking form, My bookings, staff equipment page; second migration with the overlap constraint, tested against a real Postgres including 20 simultaneous requests and a 100-request storm.
- **Found and fixed on the way:** (1) twenty colliding database inserts sometimes took seconds (deadlock detection) instead of failing cleanly; fixed with a per-item lock in the database. (2) A test run after merging showed the browser tests assumed a fresh server; they now look in the right list and pass three runs in a row.
- **Decided / assumed (Grant to confirm in review):** staff overrides cover the club rules but never facts; crew leaving the club lose their seat but the booking stays; a staff cancellation is never recorded as the member's late cancellation; unmarked past outings show "Awaiting attendance record"; a person can hold a dock space while on the water (only boats, kayaks and paddle boards put someone in one place).
- **Next:** Grant reviews step 2. Then the 10-step order continues with step 3 (fitness classes) only if Grant says so; the Postgres store (open question G) is the main gap before any pilot.
- **Blocked / needs Grant:** real values for the placeholder rules (open question 5); real qualification names (B); branch protection on `main`.

### Oct 22, 2026 (evening): the Postgres store
- **Asked by Grant:** "Postgres Store then Step 3".
- **Built:** `PgClubStore` and its wiring (`getClubStore` picks it when `CLUB_DATABASE_URL` is set); a third migration (who-did-it IDs, creation order, crew seat order, empty out-of-service periods allowed); sample loading into an empty database; a second Playwright project that runs the member-area specs on a Postgres-backed server.
- **Found by running both stores:** the in-memory store allowed returning a boat to service in the same instant it was taken out; the database insisted the period end strictly later. Settled in the database's favour with a note (an empty period means it never mattered).
- **Proof it can fail:** with the writers lock removed, the two-server races, the limit bypass and the household-ending race all fail; with crew saving or member IDs removed, the equivalence and round-trip tests fail.
- **Decided / assumed (Grant to confirm):** one database-wide writers lock (simple and correct; narrowable later); the screens show the last 90 days of bookings; the rules file stays the source of the rules until step 5.
- **Next:** a short plan and questions for step 3 (fitness classes), then build.
- **Blocked / needs Grant:** same as before (rule numbers, qualification names, branch protection).

### Oct 22, 2026 (night): step 3, fitness classes
- **Asked by Grant:** "Postgres Store then Step 3", then answers 1a, 2a, 3a, 4a (waiting list moves up automatically; nobody in two places; a class holds its room; no money in step 3).
- **Built:** class rules as data; the class engine; the combined leave-the-club ledger; migration `20261025000000_club_classes.sql`; the Postgres mapping for classes, sessions and sign-ups; sample gym, room and three classes; four screens plus staff set-up; the day view shows a class holding a room; browser tests on the in-memory and Postgres servers (core flow, a full class and its waiting list, boat versus class both ways, staff scheduling clashes, names hidden from members, phone width), and the hidden-on-the-live-site checks cover every new page and handler.
- **Proof it can fail:** the engine tests were run with the move-up removed, reversed or never stopping, the boat and class checks removed, late-cancel rules broken, and the room check removed: each broke tests. The migration was broken seven ways (chair limit, one live line, class room overlap, class-versus-booking room check, ending a household, chairs below taken, reviving a finished line): each broke a database test.
- **Mistake caught on the way:** while breaking things on purpose I ran a `git checkout` on one file and wiped a few uncommitted helper functions from `queries.ts`. I rewrote them from the earlier read and re-ran the whole suite before going on. Lesson: keep a copy before breaking a file, never reset it.
- **Decided / assumed (Grant to confirm in review):** staff cannot override class rules (open question L); no emails (N); one class a day and five places at once as placeholders; a waiting spot counts as a place for limits and for "one place at a time"; a sign-up closes 30 minutes before the start.
- **Checks at the end:** lint and type check clean; 600 unit tests (including the database tests on a real Postgres) all pass; the production build works; 124 browser tests pass (in-memory server, Postgres-backed server, and the two production-style servers that prove every new page and handler is "not found" on the live site); the dashboard tests pass untouched.
- **Next:** Grant reviews the Postgres store and step 3 (they are in one pull request, step 3 is the last commit). Step 4 (events and RSVPs) only if Grant says so.
- **Blocked / needs Grant:** same as before (rule numbers for boats and classes, qualification names, branch protection).
