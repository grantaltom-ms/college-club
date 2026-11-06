-- Events and Marketing dashboard page: one row per promoted club event.
-- Counts only. No member names or personal data ever go in this table.
-- Pattern follows db/membership_monthly.sql: RLS on, no policies, so only the
-- Vercel service role can read it; the /api/events route strips nothing because
-- there is nothing personal to strip.
--
-- door_entries_window = Brivo front-door entries during the event's evening
-- window (for the two September Thursday events: entry hours 16-20 local).
-- door_comparison = free text giving the baseline the window was compared to.
-- Either may be null when no door comparison was run for that event.
-- rsvp_persons counts members + their guests (iCrew's header figure);
-- rsvp_members counts individual members registered.

create table if not exists public.event_scoreboard (
  id bigint generated always as identity primary key,
  event_name text not null,
  event_date date not null,
  price_label text,
  capacity int,
  times_promoted int,
  rsvp_members int,
  rsvp_persons int,
  door_entries_window int,
  door_comparison text,
  status text not null default 'held' check (status in ('held', 'upcoming')),
  note text,
  unique (event_name, event_date)
);

alter table public.event_scoreboard enable row level security;

-- Seed: load db/event_scoreboard.csv (same content as the copy Grant holds)
-- through the Supabase CSV import, matching columns by name.
