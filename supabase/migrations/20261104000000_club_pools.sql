-- Pools: a dock, the club room or the gym is one item with a number of places, instead of one place per item.
--
-- The building comparison: a parking lot with 60 spaces. The club does not care which space a car takes, only that the lot is
-- never over-full at any moment. A boat is still a single reserved space: one booking at a time, enforced exactly as before.
--
-- The database refuses these on its own, whatever the app does:
-- - a booking that would leave more people in a pool, at any moment, than it has places;
-- - one person holding two places in the same pool at overlapping times;
-- - a boat, kayak, paddle board or work space having more than one place;
-- - the number of places changing after the pool has been made;
-- - a private pool.
-- A single-place item keeps the exclusion rule it has had since step 2 (two bookings of one boat can never overlap).
--
-- A class still holds the whole room while it runs (the class and room rules from step 3 are unchanged and apply to a pool).
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

alter table club.items add column places integer not null default 1 check (places between 1 and 500);

-- A private boat is a boat: only a single-place item can be private.
alter table club.items add constraint items_pool_is_not_private check (not (is_private and places > 1));

create function club.guard_item_places() returns trigger language plpgsql as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.places is distinct from old.places then
    raise exception 'The number of places in a pool cannot be changed after it has been made.';
  end if;
  if new.places > 1 then
    select booking_type into v_type from club.item_classes where code = new.class_code;
    if v_type is null or v_type not in ('Dock Space', 'Gym Space', 'Room Space') then
      raise exception 'Only a dock, club room or gym space can have more than one place.';
    end if;
  end if;
  return new;
end $$;

create trigger items_places_guard before insert or update on club.items
  for each row execute function club.guard_item_places();

/* ---------- Bookings: the overlap rule is for single places; pools are counted ---------- */

-- True for a booking of a single-place item. Set by the database from the item, never by the app.
alter table club.bookings add column single_place boolean not null default true;

alter table club.bookings drop constraint bookings_no_double_booking;
alter table club.bookings add constraint bookings_no_double_booking
  exclude using gist (item_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('upcoming', 'completed', 'no_show') and single_place);

-- One person holds one place in a pool at a time. (For a single-place item the rule above already says it.)
alter table club.bookings add constraint bookings_one_place_each
  exclude using gist (item_id with =, booker_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
  where (status in ('upcoming', 'completed', 'no_show'));

-- Before a booking is saved: take this item's lock (the same one the serialize trigger takes, so requests for one item line up
-- one at a time), note whether the item has a single place, and for a pool count the busiest moment of the new booking: with this
-- booking in it, it may never be more than the number of places.
create function club.guard_booking_places() returns trigger language plpgsql as $$
declare
  v_places integer;
  v_peak integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));
  select places into v_places from club.items where id = new.item_id;
  new.single_place := coalesce(v_places = 1, true);
  if coalesce(v_places, 1) > 1 and new.status in ('upcoming', 'completed', 'no_show') then
    -- The busiest moment inside the new booking is the moment it starts, or the moment some other booking starts inside it.
    select coalesce(max(c.n), 0) into v_peak
      from (
        select (
          select count(*) from club.bookings x
           where x.item_id = new.item_id and x.status in ('upcoming', 'completed', 'no_show')
             and x.starts_at <= t.at and t.at < x.ends_at
        ) as n
          from (
            select new.starts_at as at
            union
            select b.starts_at from club.bookings b
             where b.item_id = new.item_id and b.status in ('upcoming', 'completed', 'no_show')
               and b.starts_at > new.starts_at and b.starts_at < new.ends_at
          ) t
      ) c;
    if v_peak + 1 > v_places then
      raise exception 'That pool is full for part of that time.' using errcode = '23P01';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_places_rule before insert on club.bookings
  for each row execute function club.guard_booking_places();

-- A booking's place count is fixed with the booking (the item cannot change either).
create or replace function club.guard_booking() returns trigger language plpgsql as $$
begin
  if new.item_id is distinct from old.item_id
    or new.booker_id is distinct from old.booker_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.single_place is distinct from old.single_place then
    raise exception 'A booking cannot be moved or handed over. Cancel it and book again.';
  end if;
  if new.status is distinct from old.status
     and old.status <> 'upcoming'
     and not (old.status in ('completed', 'no_show') and new.status in ('completed', 'no_show')) then
    raise exception 'A booking that is already % cannot change again.', replace(old.status, '_', ' ');
  end if;
  return new;
end $$;
