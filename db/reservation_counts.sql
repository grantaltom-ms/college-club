-- Reservations by type for the Reservations tab: how many reservations of each type
-- started in each hour of each day. Run this once in the Supabase SQL editor for the
-- College Club project.
--
-- No names are stored: `npm run reservations:prepare` reduces the iCrew reservations
-- export to counts before anything is loaded.

create table if not exists public.reservation_counts (
  id bigint generated always as identity primary key,
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  item_type text not null,
  reservations integer not null check (reservations > 0),
  unique (day, hour, item_type)
);

-- Locked to the server: row level security with no policies means only the
-- service role key (set in Vercel, never in the browser) can read it.
alter table public.reservation_counts enable row level security;

-- To refresh with a new export later:
--   1. npm run reservations:prepare -- <new iCrew reservations export>.csv reservation_counts.csv
--   2. truncate public.reservation_counts;
--   3. Import reservation_counts.csv into the table with the Supabase Table Editor
--      (it has the columns day, hour, item_type, reservations; id fills itself in).
