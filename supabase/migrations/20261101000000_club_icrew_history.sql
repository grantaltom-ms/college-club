-- Step 10: the archive of bookings from the old reservation system (iCrew).
--
-- The building comparison: the old filing cabinet. When the club moves out of iCrew its past bookings are kept, so a member
-- can look up their own old outings and staff can answer "did she row last March?". The cabinet is not today's calendar: it
-- has no link to bookings, the check-in record or billing, so an old reservation can never become a no-show, count against a
-- limit or appear on an invoice. It is only ever added to.
--
-- iCrew has names but no emails, so people are not linked to members here. Each booking just carries the names it was
-- written with and a matching key (first word + last word, lower case). The app looks a member up by their key at the time
-- they ask, so a name that could not be matched on import can still be matched later, and a key shared by two members matches nobody.
--
-- The database refuses these on its own, whatever the app does:
-- - changing or removing anything in the archive, or emptying it;
-- - storing the same booking twice;
-- - a booking that ends before it starts, or whose day is not the Pacific day it starts on;
-- - an import record whose counts do not match the bookings that came with it (checked at the end of the change).
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

create table club.history_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null check (char_length(file_name) between 1 and 200),
  -- A fingerprint of the exact file, so the same file is only added once.
  file_fingerprint text not null unique check (file_fingerprint ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz not null,
  imported_by text not null check (char_length(imported_by) between 1 and 120),
  rows_in_file integer not null check (rows_in_file >= 1),
  rows_added integer not null check (rows_added >= 1),
  rows_skipped integer not null check (rows_skipped >= 0),
  first_day date not null,
  last_day date not null,
  seq bigint generated always as identity,
  constraint history_imports_counts_add_up check (rows_added + rows_skipped = rows_in_file)
);
create unique index history_imports_seq_idx on club.history_imports (seq);

create table club.legacy_reservations (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references club.history_imports (id) on delete restrict,
  -- Identifies the booking (iCrew's ID plus who it is for), so a booking is stored once however many files mention it.
  row_key text not null unique check (row_key ~ '^[0-9a-f]{64}$'),
  source_id text not null check (source_id ~ '^[0-9]{1,12}$'),
  day date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  booked_at timestamptz,
  item_type text not null check (char_length(item_type) between 1 and 60),
  item_name text not null check (char_length(item_name) between 1 and 120),
  oars text not null default '' check (char_length(oars) <= 120),
  booked_by text not null check (char_length(booked_by) between 1 and 120),
  rowers text not null default '' check (char_length(rowers) <= 200),
  -- What iCrew wrote for out and in, kept as written. The club does not treat them as proof anyone came.
  out_text text not null default '' check (char_length(out_text) <= 20),
  in_text text not null default '' check (char_length(in_text) <= 20),
  seq bigint generated always as identity,
  constraint legacy_reservations_ends_after_start check (ends_at > starts_at),
  constraint legacy_reservations_day_is_pacific_day check (day = (starts_at at time zone 'America/Los_Angeles')::date)
);
create unique index legacy_reservations_seq_idx on club.legacy_reservations (seq);
create index legacy_reservations_day_idx on club.legacy_reservations (day desc, seq desc);
create index legacy_reservations_import_idx on club.legacy_reservations (import_id);

create table club.legacy_reservation_people (
  reservation_id uuid not null references club.legacy_reservations (id) on delete restrict,
  name_key text not null check (char_length(name_key) between 1 and 120 and name_key = lower(btrim(name_key))),
  name text not null check (char_length(name) between 1 and 120),
  role text not null check (role in ('booker', 'rower')),
  primary key (reservation_id, name_key, role)
);
create index legacy_reservation_people_key_idx on club.legacy_reservation_people (name_key, reservation_id);

/* ---------- Only ever added to ---------- */

create function club.legacy_archive_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The archive of old bookings can only be added to, never changed or removed.';
end $$;

create trigger history_imports_no_change before update or delete on club.history_imports for each row execute function club.legacy_archive_is_append_only();
create trigger history_imports_no_truncate before truncate on club.history_imports for each statement execute function club.legacy_archive_is_append_only();
create trigger legacy_reservations_no_change before update or delete on club.legacy_reservations for each row execute function club.legacy_archive_is_append_only();
create trigger legacy_reservations_no_truncate before truncate on club.legacy_reservations for each statement execute function club.legacy_archive_is_append_only();
create trigger legacy_people_no_change before update or delete on club.legacy_reservation_people for each row execute function club.legacy_archive_is_append_only();
create trigger legacy_people_no_truncate before truncate on club.legacy_reservation_people for each statement execute function club.legacy_archive_is_append_only();

/* ---------- An import's counts must match the bookings that came with it ---------- */

-- Checked at the end of the change, so the import record may be written before its bookings. It fires for a new import record
-- and for every new booking, so bookings cannot be slipped into an import that was already saved.
create function club.check_history_import_counts() returns trigger language plpgsql as $$
declare
  v_import uuid;
  v_expected integer;
  v_actual integer;
  v_first date;
  v_last date;
  v_first_expected date;
  v_last_expected date;
begin
  -- (Two separate statements: PL/pgSQL would refuse a CASE that names a column the other table's rows do not have.)
  if tg_table_name = 'history_imports' then
    v_import := new.id;
  else
    v_import := new.import_id;
  end if;
  -- Every new booking queues this check, and by the time they run the whole import is in place, so once per import is enough.
  if current_setting('club.history_import_checked', true) = v_import::text then
    return null;
  end if;
  perform set_config('club.history_import_checked', v_import::text, true);
  select rows_added, first_day, last_day into v_expected, v_first_expected, v_last_expected from club.history_imports where id = v_import;
  select count(*), min(day), max(day) into v_actual, v_first, v_last from club.legacy_reservations where import_id = v_import;
  if v_actual <> v_expected or v_first is distinct from v_first_expected or v_last is distinct from v_last_expected then
    raise exception 'An import must come with exactly the bookings it says it added, covering exactly the days it says.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger history_imports_counts after insert on club.history_imports
  deferrable initially deferred for each row execute function club.check_history_import_counts();
create constraint trigger legacy_reservations_counts after insert on club.legacy_reservations
  deferrable initially deferred for each row execute function club.check_history_import_counts();

/* ---------- Locked to the owner ---------- */

alter table club.history_imports enable row level security;
alter table club.legacy_reservations enable row level security;
alter table club.legacy_reservation_people enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
