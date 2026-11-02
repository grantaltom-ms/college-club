/*
  Fixing and retiring equipment that is already in the club.

  The building comparison: the unit list. The office can correct a unit's name or size on the list, and can take a unit off the
  list for good, and every correction and retirement is a line in that unit's own file. Nothing is ever erased, and a retired unit
  can be put back.

  The database refuses these on its own, whatever the app does:
  - an item's name, kind, skill level, number of places or retirement changing without a matching line in its file, written in
    the very same change (checked at the end of the change, so the line may come after);
  - a line in an item's file being changed or removed;
  - a booking, or a practice's reservation of a boat, being made on a retired item;
  - a retired item being changed in any way but its name, or its retirement being rewritten;
  - an item turning into another kind of thing (a shell stays a shell, a kayak stays a kayak), or into a bigger or smaller boat
    than an upcoming booking has people for;
  - a pool turning into a single place or a single place into a pool, or a pool shrinking below the most people booked into it
    at one moment.

  Fitting a coach's lineup into a smaller boat is the app's check alone: a past practice never ends in the database, and the
  database has no clock of its own to tell a past one from a coming one.

  Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.
*/

/* ---------- Retired ---------- */

alter table club.items add column retired_at timestamptz;
alter table club.items add column retired_by_label text check (char_length(retired_by_label) between 1 and 120);
alter table club.items add column retired_reason text check (char_length(btrim(retired_reason)) between 1 and 200);
alter table club.items add constraint items_retirement_is_complete check (
  (retired_at is null) = (retired_by_label is null) and (retired_at is null) = (retired_reason is null)
);

/* ---------- The file of each item ---------- */

create table club.item_log (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references club.items (id) on delete restrict,
  at timestamptz not null,
  kind text not null check (kind in ('changed', 'retired', 'restored')),
  by_label text not null check (char_length(by_label) between 1 and 120),
  text text not null check (char_length(text) between 1 and 1500),
  -- For a "changed" line, the old and new value of each thing that changed (nameFrom and nameTo, classFrom and classTo,
  -- skillFrom and skillTo, placesFrom and placesTo). For a "retired" line, the reason.
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  -- The change this line was written in, so an item's change can only be explained by a line from the same change.
  xact xid8 not null default pg_current_xact_id(),
  seq bigint generated always as identity,
  constraint item_log_retired_has_a_reason check (kind <> 'retired' or char_length(btrim(coalesce(details ->> 'reason', ''))) between 1 and 200)
);

create unique index item_log_seq_idx on club.item_log (seq);
create index item_log_item_idx on club.item_log (item_id);

-- Lines are added to, never changed or removed.
create function club.guard_item_log() returns trigger language plpgsql as $$
begin
  raise exception 'A line in an item''s file cannot be changed or removed.';
end $$;

create trigger item_log_no_change before update or delete on club.item_log
  for each row execute function club.guard_item_log();
create trigger item_log_no_truncate before truncate on club.item_log
  for each statement execute function club.guard_item_log();

/* ---------- Pools: the size can change, never below what is booked ---------- */

-- Replaces the guard from the pools migration. A pool can be resized (never to or from a single place), and never below the most
-- people booked into it at one moment. Only upcoming bookings count: they are the ones still to come or under way, and the database
-- has no clock of its own to tell a past booking from a coming one.
create or replace function club.guard_item_places() returns trigger language plpgsql as $$
declare
  v_type text;
  v_peak integer;
begin
  if tg_op = 'UPDATE' and new.places is distinct from old.places then
    if old.places = 1 or new.places = 1 then
      raise exception 'An item cannot become a pool, or stop being one, after it has been made. Only the size of a pool can change.';
    end if;
    -- The lock a booking of this item takes, so a booking and a resize arriving together line up one at a time.
    perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
    select coalesce(max(c.n), 0) into v_peak
      from (
        select (
          select count(*) from club.bookings x
           where x.item_id = new.id and x.status = 'upcoming' and x.starts_at <= t.at and t.at < x.ends_at
        ) as n
          from (select b.starts_at as at from club.bookings b where b.item_id = new.id and b.status = 'upcoming') t
      ) c;
    if v_peak > new.places then
      raise exception 'That pool has % people in it at once, so it cannot have fewer than % places.', v_peak, v_peak using errcode = '23514';
    end if;
  end if;
  if new.places > 1 then
    select booking_type into v_type from club.item_classes where code = new.class_code;
    if v_type is null or v_type not in ('Dock Space', 'Gym Space', 'Room Space') then
      raise exception 'Only a dock, club room or gym space can have more than one place.';
    end if;
  end if;
  return new;
end $$;

/* ---------- A shell stays a shell, and an upcoming booking still has a seat for everyone in it ---------- */

create function club.guard_item_class() returns trigger language plpgsql as $$
declare
  v_old_type text;
  v_new_type text;
  v_seats integer;
begin
  if new.class_code is not distinct from old.class_code then
    return new;
  end if;
  select booking_type into v_old_type from club.item_classes where code = old.class_code;
  select booking_type, seats into v_new_type, v_seats from club.item_classes where code = new.class_code;
  if v_old_type is distinct from v_new_type then
    raise exception 'An item cannot change what kind of thing it is: a shell stays a shell. Retire it and add the right kind.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  if exists (
    select 1 from club.bookings b
     where b.item_id = new.id and b.status = 'upcoming'
       and 1 + (select count(*) from club.booking_crew c where c.booking_id = b.id and c.removed_at is null) > v_seats
  ) then
    raise exception 'An upcoming booking of this item has more people in it than the new size has seats.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger items_class_guard before update of class_code on club.items
  for each row execute function club.guard_item_class();

/* ---------- A retirement is made and undone, never rewritten; a retired item is only renamed ---------- */

create function club.guard_item_retirement() returns trigger language plpgsql as $$
begin
  if old.retired_at is not null and new.retired_at is not null then
    if new.retired_at is distinct from old.retired_at
      or new.retired_by_label is distinct from old.retired_by_label
      or new.retired_reason is distinct from old.retired_reason then
      raise exception 'A retirement cannot be changed. Bring the item back, then retire it again.';
    end if;
    if new.class_code is distinct from old.class_code
      or new.qualification_mode is distinct from old.qualification_mode
      or new.required_qualification is distinct from old.required_qualification
      or new.places is distinct from old.places then
      raise exception 'A retired item can only be renamed. Bring it back to change anything else.';
    end if;
  end if;
  return new;
end $$;

create trigger items_retirement_guard before update on club.items
  for each row execute function club.guard_item_retirement();

/* ---------- Nothing is booked, or reserved for a practice, on a retired item ---------- */

create function club.guard_retired_booking() returns trigger language plpgsql as $$
begin
  if exists (select 1 from club.items where id = new.item_id and retired_at is not null) then
    raise exception 'A retired item cannot be booked.';
  end if;
  return new;
end $$;

create trigger bookings_retired_item_guard before insert on club.bookings
  for each row execute function club.guard_retired_booking();

create function club.guard_retired_practice_boat() returns trigger language plpgsql as $$
begin
  if new.ended_at is null and exists (select 1 from club.items where id = new.item_id and retired_at is not null) then
    raise exception 'A retired boat cannot be reserved for a practice.';
  end if;
  return new;
end $$;

create trigger practice_boats_retired_guard before insert on club.practice_boats
  for each row execute function club.guard_retired_practice_boat();

/* ---------- No change without a line in the item's file ---------- */

-- Checked at the end of the change, so the line may be written after the item it explains. The line must be about this item and
-- written in this very change. For a name, kind, skill level or number of places that changed it must say what it was and what it is
-- now. A retirement needs a "retired" line and a return a "restored" line.
create function club.require_item_log_line() returns trigger language plpgsql as $$
declare
  v_old_skill text := case when old.qualification_mode = 'code' then old.required_qualification else old.qualification_mode end;
  v_new_skill text := case when new.qualification_mode = 'code' then new.required_qualification else new.qualification_mode end;
begin
  if new.retired_at is distinct from old.retired_at then
    if not exists (
      select 1 from club.item_log l
       where l.item_id = new.id and l.xact = pg_current_xact_id() and l.kind = case when new.retired_at is null then 'restored' else 'retired' end
    ) then
      raise exception 'An item cannot be retired or brought back without a matching line in its file.' using errcode = '23514';
    end if;
  end if;
  if new.name is distinct from old.name
    or new.class_code is distinct from old.class_code
    or v_new_skill is distinct from v_old_skill
    or new.places is distinct from old.places then
    if not exists (
      select 1 from club.item_log l
       where l.item_id = new.id and l.xact = pg_current_xact_id() and l.kind = 'changed'
         and (new.name = old.name or (l.details ->> 'nameFrom' = old.name and l.details ->> 'nameTo' = new.name))
         and (new.class_code = old.class_code or (l.details ->> 'classFrom' = old.class_code and l.details ->> 'classTo' = new.class_code))
         and (v_new_skill is not distinct from v_old_skill or (l.details ->> 'skillFrom' = v_old_skill and l.details ->> 'skillTo' = v_new_skill))
         and (new.places = old.places or (l.details ->> 'placesFrom' = old.places::text and l.details ->> 'placesTo' = new.places::text))
    ) then
      raise exception 'An item''s name, kind, skill level or places cannot change without a matching line in its file.' using errcode = '23514';
    end if;
  end if;
  return null;
end $$;

create constraint trigger items_need_a_log_line after update of name, class_code, qualification_mode, required_qualification, places, retired_at on club.items
  deferrable initially deferred for each row execute function club.require_item_log_line();

/* ---------- Locked to the owner ---------- */

alter table club.item_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
