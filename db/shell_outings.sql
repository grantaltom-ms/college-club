-- Shell outings for the Shells tab: one row each time a club boat went out.
-- Run this once in the Supabase SQL editor for the College Club project.
--
-- No rower names are stored. `rower_key` is a scrambled code made by
-- `npm run shells:prepare`, used only on the server to count different rowers.

create table if not exists public.shell_outings (
  id bigint generated always as identity primary key,
  boat text not null,
  seats smallint,
  rigging text,
  day date not null,
  kind text not null check (kind in ('member', 'team')),
  team text,
  minutes integer,
  start_time time,
  end_time time,
  rower_key text
);

create index if not exists shell_outings_day_idx on public.shell_outings (day);

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.shell_outings enable row level security;

-- To refresh with a new export later:
--   1. npm run shells:prepare -- <new iCrew export>.csv shell_outings.csv
--   2. truncate public.shell_outings;
--   3. Import shell_outings.csv into the table with the Supabase Table Editor.
