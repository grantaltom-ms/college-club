-- Practices and lineups: a coached or organized rowing session that reserves its boats and holds a crew list, and the coach flag
-- that lets a member set one up.
--
-- The building comparison: booking the rooftop for a resident event. The office holds the roof (the boats) for the evening, so
-- no tenant can book it for themselves while the event runs, and the organizer writes down who stands where. Tenants who had
-- already booked the roof are not turned away by the database: the app flags them to the organizer and the office.
--
-- The database refuses these on its own, whatever the app does:
-- - a member being marked, or unmarked, as a coach without a matching line in the household's file;
-- - a practice run by someone who is not an active coach, or set up by a member for someone else;
-- - a practice changing its name, notes, times, coach or maker, being brought back once cancelled, or being removed;
-- - a boat reserved by two practices at overlapping times, a private boat or anything that is not a boat on a practice, and a
--   booking made on a boat while a practice has it reserved (both checks share the boat's lock with bookings, so two requests
--   arriving together cannot both get in);
-- - a boat line or a seat line being removed, or changed in any way except being ended, once, with who ended it and when;
-- - a seat that is not in the boat, a person in two seats of one practice, two people in one seat, or a person who is not an
--   active member of an active household, in a seat;
-- - a member seating someone unless they are the active coach who runs that practice.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

/* ---------- Coaches ---------- */

alter table club.members add column is_coach boolean not null default false;

alter table club.household_history drop constraint household_history_kind_check;
alter table club.household_history add constraint household_history_kind_check check (
  kind in ('joined', 'member_added', 'member_removed', 'member_updated', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'signups_cancelled', 'rsvps_cancelled', 'quickbooks_linked', 'coach_changed', 'membership_ended')
);

-- Checked at the end of the change, so the line may be written after the record it explains. The line must be about this
-- member and say which way the flag went.
create function club.require_coach_line() returns trigger language plpgsql as $$
begin
  if new.is_coach is not distinct from old.is_coach then
    return null;
  end if;
  if not exists (
    select 1 from club.household_history h
    where h.household_id = new.household_id
      and h.kind = 'coach_changed'
      and h.details ->> 'memberId' = new.id::text
      and h.details ->> 'coach' = case when new.is_coach then 'yes' else 'no' end
  ) then
    raise exception 'A member cannot be marked, or unmarked, as a coach without a matching line in the household''s file.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger members_coach_line after update of is_coach on club.members
  deferrable initially deferred for each row execute function club.require_coach_line();

-- A member who is not active cannot be newly marked as a coach.
create function club.guard_coach_flag() returns trigger language plpgsql as $$
begin
  if new.is_coach and not old.is_coach and new.status <> 'active' then
    raise exception 'Only an active member can be marked as a coach.';
  end if;
  return new;
end $$;

create trigger members_coach_is_active before update of is_coach on club.members
  for each row execute function club.guard_coach_flag();

/* ---------- Practices ---------- */

create table club.practices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  -- The coach running it, or null when staff run it.
  coach_id uuid references club.members (id) on delete restrict,
  created_at timestamptz not null,
  created_by_kind text not null check (created_by_kind in ('staff', 'member')),
  created_by_id text check (char_length(created_by_id) <= 64),
  created_by_label text not null check (char_length(created_by_label) between 1 and 120),
  status_changed_at timestamptz not null,
  cancelled_by_kind text check (cancelled_by_kind in ('staff', 'member')),
  cancelled_by_id text check (char_length(cancelled_by_id) <= 64),
  cancelled_by_label text check (char_length(cancelled_by_label) between 1 and 120),
  cancel_reason text check (char_length(cancel_reason) between 1 and 200),
  seq bigint generated always as identity,
  constraint practices_ends_after_start check (ends_at > starts_at),
  constraint practices_created_by_member_is_named check ((created_by_kind = 'member') = (created_by_id is not null)),
  -- A coach sets up a practice they run themselves; staff may name a coach or run it.
  -- (coalesce: with no coach named the comparison is unknown, and a check treats unknown as passing.)
  constraint practices_member_runs_their_own check (created_by_kind <> 'member' or coalesce(created_by_id = coach_id::text, false)),
  constraint practices_cancel_is_complete check (
    (status = 'cancelled') = (cancelled_by_kind is not null) and (cancelled_by_kind is null) = (cancelled_by_label is null)
  ),
  constraint practices_cancelled_by_member_is_named check (cancelled_by_kind is null or (cancelled_by_kind = 'member') = (cancelled_by_id is not null)),
  constraint practices_reason_only_when_cancelled check (cancel_reason is null or status = 'cancelled')
);

create unique index practices_seq_idx on club.practices (seq);
create index practices_starts_idx on club.practices (starts_at);

create function club.guard_practice_insert() returns trigger language plpgsql as $$
begin
  if new.status <> 'scheduled' then
    raise exception 'A practice starts out scheduled.';
  end if;
  if new.coach_id is not null and not exists (
    select 1 from club.members m join club.households h on h.id = m.household_id
     where m.id = new.coach_id and m.is_coach and m.status = 'active' and h.status = 'active'
  ) then
    raise exception 'A practice is run by an active coach, or by staff.';
  end if;
  return new;
end $$;

create trigger practices_insert_guard before insert on club.practices
  for each row execute function club.guard_practice_insert();

create function club.guard_practice() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.name is distinct from old.name or new.notes is distinct from old.notes
       or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
       or new.coach_id is distinct from old.coach_id or new.created_at is distinct from old.created_at
       or new.created_by_kind is distinct from old.created_by_kind or new.created_by_id is distinct from old.created_by_id
       or new.created_by_label is distinct from old.created_by_label or new.seq is distinct from old.seq then
      raise exception 'A practice''s name, notes, times, coach and maker cannot change. Cancel it and set up a new one.';
    end if;
    if new.status is distinct from old.status then
      if old.status <> 'scheduled' or new.status <> 'cancelled' then
        raise exception 'A cancelled practice cannot be brought back.';
      end if;
      return new;
    end if;
    if new.status_changed_at is distinct from old.status_changed_at or new.cancelled_by_kind is distinct from old.cancelled_by_kind
       or new.cancelled_by_id is distinct from old.cancelled_by_id or new.cancelled_by_label is distinct from old.cancelled_by_label
       or new.cancel_reason is distinct from old.cancel_reason then
      raise exception 'A practice can be cancelled once; after that its record cannot change.';
    end if;
    return new;
  end if;
  raise exception 'A practice cannot be removed.';
end $$;

create trigger practices_no_change before update or delete on club.practices
  for each row execute function club.guard_practice();
create trigger practices_no_truncate before truncate on club.practices
  for each statement execute function club.guard_practice();

/* ---------- The boats a practice reserves ---------- */

create table club.practice_boats (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references club.practices (id) on delete restrict,
  item_id uuid not null references club.items (id) on delete restrict,
  added_at timestamptz not null,
  added_by_kind text not null check (added_by_kind in ('staff', 'member')),
  added_by_id text check (char_length(added_by_id) <= 64),
  added_by_label text not null check (char_length(added_by_label) between 1 and 120),
  ended_at timestamptz,
  ended_by_kind text check (ended_by_kind in ('staff', 'member')),
  ended_by_id text check (char_length(ended_by_id) <= 64),
  ended_by_label text check (char_length(ended_by_label) between 1 and 120),
  seq bigint generated always as identity,
  constraint practice_boats_end_is_complete check ((ended_at is null) = (ended_by_kind is null) and (ended_at is null) = (ended_by_label is null)),
  constraint practice_boats_ends_after_added check (ended_at is null or ended_at >= added_at),
  constraint practice_boats_added_by_member_is_named check ((added_by_kind = 'member') = (added_by_id is not null)),
  constraint practice_boats_ended_by_member_is_named check (ended_by_kind is null or (ended_by_kind = 'member') = (ended_by_id is not null))
);

create unique index practice_boats_seq_idx on club.practice_boats (seq);
-- A boat is on a practice once at a time. Ended lines stay as the record.
create unique index practice_boats_one_active_idx on club.practice_boats (practice_id, item_id) where ended_at is null;
create index practice_boats_item_idx on club.practice_boats (item_id) where ended_at is null;

create function club.guard_practice_boat_insert() returns trigger language plpgsql as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
begin
  select starts_at, ends_at, status into v_start, v_end, v_status from club.practices where id = new.practice_id;
  if not exists (
    select 1 from club.items i join club.item_classes c on c.code = i.class_code
     where i.id = new.item_id and not i.is_private and i.places = 1 and c.booking_type in ('Shell', 'Kayak', 'Paddle Board')
  ) then
    raise exception 'Only a club boat, kayak or paddle board can be reserved for a practice.' using errcode = '23514';
  end if;
  if new.ended_at is null then
    -- The same lock a booking of this boat takes, so a booking and a reservation arriving together line up one at a time.
    perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));
    if v_status <> 'scheduled' then
      raise exception 'A cancelled practice cannot reserve a boat.';
    end if;
    if exists (
      select 1 from club.practice_boats b join club.practices p on p.id = b.practice_id
       where b.item_id = new.item_id and b.ended_at is null and b.practice_id <> new.practice_id and p.status = 'scheduled'
         and tstzrange(p.starts_at, p.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      raise exception 'That boat is already reserved for another practice at that time.' using errcode = '23P01';
    end if;
  end if;
  return new;
end $$;

create trigger practice_boats_insert_guard before insert on club.practice_boats
  for each row execute function club.guard_practice_boat_insert();

create function club.guard_practice_boat() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.ended_at is null and new.ended_at is not null
       and new.id = old.id and new.practice_id = old.practice_id and new.item_id = old.item_id
       and new.added_at = old.added_at and new.added_by_kind = old.added_by_kind
       and new.added_by_id is not distinct from old.added_by_id and new.added_by_label = old.added_by_label and new.seq = old.seq then
      return new;
    end if;
    raise exception 'A boat line on a practice cannot be changed. It can only be ended, once.';
  end if;
  raise exception 'A boat line on a practice cannot be removed.';
end $$;

create trigger practice_boats_no_change before update or delete on club.practice_boats
  for each row execute function club.guard_practice_boat();
create trigger practice_boats_no_truncate before truncate on club.practice_boats
  for each statement execute function club.guard_practice_boat();

-- A boat taken off a practice takes its seats with it. Checked at the end of the change, so the seats may be ended after the boat.
create function club.require_seats_ended() returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from club.practice_seats s where s.practice_id = new.practice_id and s.item_id = new.item_id and s.ended_at is null
  ) then
    raise exception 'A boat cannot come off a practice while people are still seated in it.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger practice_boats_seats_ended after update of ended_at on club.practice_boats
  deferrable initially deferred for each row execute function club.require_seats_ended();

/* ---------- Bookings and reservations ---------- */

-- A member cannot book a boat a practice has reserved at that time. (The other way round is allowed: a practice may be set up over
-- bookings already made. The app flags them; nothing is cancelled.)
create function club.booking_practice_free() returns trigger language plpgsql as $$
begin
  if new.status not in ('upcoming', 'completed', 'no_show') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text, 0));
  if exists (
    select 1 from club.practice_boats b join club.practices p on p.id = b.practice_id
     where b.item_id = new.item_id and b.ended_at is null and p.status = 'scheduled'
       and tstzrange(p.starts_at, p.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'That boat is reserved for a practice at that time.' using errcode = '23P01';
  end if;
  return new;
end $$;

create trigger bookings_practice_free before insert on club.bookings
  for each row execute function club.booking_practice_free();

/* ---------- The lineup ---------- */

create table club.practice_seats (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references club.practices (id) on delete restrict,
  item_id uuid not null references club.items (id) on delete restrict,
  seat integer not null check (seat between 1 and 12),
  -- The side this person rows on, or none (sculling).
  side text check (side in ('port', 'starboard')),
  member_id uuid not null references club.members (id) on delete restrict,
  added_at timestamptz not null,
  added_by_kind text not null check (added_by_kind in ('staff', 'member')),
  added_by_id text check (char_length(added_by_id) <= 64),
  added_by_label text not null check (char_length(added_by_label) between 1 and 120),
  ended_at timestamptz,
  ended_by_kind text check (ended_by_kind in ('staff', 'member')),
  ended_by_id text check (char_length(ended_by_id) <= 64),
  ended_by_label text check (char_length(ended_by_label) between 1 and 120),
  ended_reason text check (char_length(ended_reason) between 1 and 400),
  seq bigint generated always as identity,
  constraint practice_seats_end_is_complete check (
    (ended_at is null) = (ended_by_kind is null) and (ended_at is null) = (ended_by_label is null) and (ended_at is null) = (ended_reason is null)
  ),
  constraint practice_seats_ends_after_added check (ended_at is null or ended_at >= added_at),
  constraint practice_seats_added_by_member_is_named check ((added_by_kind = 'member') = (added_by_id is not null)),
  constraint practice_seats_ended_by_member_is_named check (ended_by_kind is null or (ended_by_kind = 'member') = (ended_by_id is not null))
);

create unique index practice_seats_seq_idx on club.practice_seats (seq);
-- One person in a seat at a time, and one seat per person in a practice. Ended lines stay as the record.
create unique index practice_seats_one_person_per_seat_idx on club.practice_seats (practice_id, item_id, seat) where ended_at is null;
create unique index practice_seats_one_seat_per_person_idx on club.practice_seats (practice_id, member_id) where ended_at is null;
create index practice_seats_member_idx on club.practice_seats (member_id) where ended_at is null;

create function club.guard_practice_seat_insert() returns trigger language plpgsql as $$
declare
  v_status text;
  v_coach uuid;
  v_seats integer;
begin
  select p.status, p.coach_id into v_status, v_coach from club.practices p where p.id = new.practice_id;
  select c.seats into v_seats from club.items i join club.item_classes c on c.code = i.class_code where i.id = new.item_id;
  if new.seat > coalesce(v_seats, 0) then
    raise exception 'That boat has only % seats.', coalesce(v_seats, 0) using errcode = '23514';
  end if;
  if new.added_by_kind = 'member' and (
    v_coach is null or new.added_by_id is distinct from v_coach::text
    or not exists (select 1 from club.members m where m.id = v_coach and m.is_coach and m.status = 'active')
  ) then
    raise exception 'Only the coach who runs a practice, or club staff, can seat people in it.';
  end if;
  if new.ended_at is null then
    if v_status <> 'scheduled' then
      raise exception 'A cancelled practice has no lineup.';
    end if;
    if not exists (select 1 from club.practice_boats b where b.practice_id = new.practice_id and b.item_id = new.item_id and b.ended_at is null) then
      raise exception 'Only a boat that is on the practice has seats to fill.' using errcode = '23514';
    end if;
    if not exists (
      select 1 from club.members m join club.households h on h.id = m.household_id
       where m.id = new.member_id and m.status = 'active' and h.status = 'active'
    ) then
      raise exception 'Only an active member can be seated.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger practice_seats_insert_guard before insert on club.practice_seats
  for each row execute function club.guard_practice_seat_insert();

create function club.guard_practice_seat() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.ended_at is null and new.ended_at is not null
       and new.id = old.id and new.practice_id = old.practice_id and new.item_id = old.item_id and new.seat = old.seat
       and new.side is not distinct from old.side and new.member_id = old.member_id
       and new.added_at = old.added_at and new.added_by_kind = old.added_by_kind
       and new.added_by_id is not distinct from old.added_by_id and new.added_by_label = old.added_by_label and new.seq = old.seq then
      return new;
    end if;
    raise exception 'A seat line cannot be changed. It can only be ended, once.';
  end if;
  raise exception 'A seat line cannot be removed.';
end $$;

create trigger practice_seats_no_change before update or delete on club.practice_seats
  for each row execute function club.guard_practice_seat();
create trigger practice_seats_no_truncate before truncate on club.practice_seats
  for each statement execute function club.guard_practice_seat();

/* ---------- Locked to the owner ---------- */

alter table club.practices enable row level security;
alter table club.practice_boats enable row level security;
alter table club.practice_seats enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
