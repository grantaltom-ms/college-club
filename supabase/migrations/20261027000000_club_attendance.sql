-- Step 5: the check-in record.
--
-- Every time someone is recorded as having come (attended) or not (no_show), one line is added here: who, when, how
-- (staff at the front desk, the system when the time ran out, or the member on the iPad in a later step), and what it
-- said before. Lines are only ever added. A correction is a new line, never an edit.
--
-- This also lets an outcome be corrected: a no-show can become attended and the other way round (staff correcting a
-- mistake, or the system's automatic no-show). Nothing else about a finished record can change, and the database
-- refuses any change of outcome that has no matching line here.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

/* ---------- The record ---------- */

create table club.attendance_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('booking', 'class', 'event')),
  -- Exactly one of these, matching kind.
  booking_id uuid references club.bookings (id) on delete restrict,
  signup_id uuid references club.class_signups (id) on delete restrict,
  rsvp_id uuid references club.event_rsvps (id) on delete restrict,
  member_id uuid not null references club.members (id) on delete restrict,
  at timestamptz not null,
  outcome text not null check (outcome in ('attended', 'no_show')),
  previous_outcome text check (previous_outcome in ('attended', 'no_show')),
  by_kind text not null check (by_kind in ('member', 'staff', 'system')),
  by_id text,
  by_label text not null check (char_length(by_label) between 1 and 120),
  via text not null check (via in ('staff', 'automatic', 'ipad')),
  note text check (char_length(note) <= 300),
  seq bigint generated always as identity,
  constraint attendance_log_one_target check (
    (kind = 'booking') = (booking_id is not null)
    and (kind = 'class') = (signup_id is not null)
    and (kind = 'event') = (rsvp_id is not null)
  ),
  -- Who did it and how must agree: the system does the automatic ones, staff do the front-desk ones, a member the iPad ones.
  constraint attendance_log_who_matches_how check (
    (via = 'automatic' and by_kind = 'system')
    or (via = 'staff' and by_kind = 'staff')
    or (via = 'ipad' and by_kind = 'member')
  ),
  -- A line that says nothing changed is a confirmation: only staff make those, and only on a human decision.
  constraint attendance_log_confirmation_is_staff check (previous_outcome is distinct from outcome or via = 'staff')
);

create unique index attendance_log_seq_idx on club.attendance_log (seq);
create index attendance_log_booking_idx on club.attendance_log (booking_id) where booking_id is not null;
create index attendance_log_signup_idx on club.attendance_log (signup_id) where signup_id is not null;
create index attendance_log_rsvp_idx on club.attendance_log (rsvp_id) where rsvp_id is not null;
create index attendance_log_member_idx on club.attendance_log (member_id, at desc);

create function club.attendance_log_is_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The check-in record can only be added to, never changed or removed.';
end $$;

create trigger attendance_log_no_change before update or delete on club.attendance_log
  for each row execute function club.attendance_log_is_append_only();
create trigger attendance_log_no_truncate before truncate on club.attendance_log
  for each statement execute function club.attendance_log_is_append_only();

/* ---------- An outcome can be corrected: attended and no-show can swap, nothing else about a finished record can change ---------- */

create or replace function club.guard_booking() returns trigger language plpgsql as $$
begin
  if new.item_id is distinct from old.item_id
    or new.booker_id is distinct from old.booker_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at then
    raise exception 'A booking cannot be moved or handed over. Cancel it and book again.';
  end if;
  if new.status is distinct from old.status
     and old.status <> 'upcoming'
     and not (old.status in ('completed', 'no_show') and new.status in ('completed', 'no_show')) then
    raise exception 'A booking that is already % cannot change again.', replace(old.status, '_', ' ');
  end if;
  return new;
end $$;

create or replace function club.guard_class_signup() returns trigger language plpgsql as $$
declare
  v_session club.class_sessions%rowtype;
  v_enrolled integer;
begin
  select * into v_session from club.class_sessions where id = new.session_id for update;

  if tg_op = 'INSERT' then
    if v_session.status <> 'scheduled' and new.status in ('enrolled', 'waitlisted') then
      raise exception 'That class was cancelled.' using errcode = '23514';
    end if;
  else
    if new.session_id is distinct from old.session_id or new.member_id is distinct from old.member_id then
      raise exception 'A sign-up cannot be moved to another class or another person.';
    end if;
    if new.status is distinct from old.status then
      if old.status not in ('enrolled', 'waitlisted')
         and not (old.status in ('attended', 'no_show') and new.status in ('attended', 'no_show')) then
        raise exception 'A sign-up that is already % cannot change again.', replace(old.status, '_', ' ');
      end if;
      if old.status = 'enrolled' and new.status = 'waitlisted' then
        raise exception 'Someone with a chair cannot go back to the waiting list.';
      end if;
      if old.status = 'waitlisted' and new.status not in ('enrolled', 'cancelled') then
        raise exception 'Someone waiting can only get a chair or leave the list.';
      end if;
    end if;
  end if;

  if new.status = 'enrolled' and (tg_op = 'INSERT' or old.status is distinct from 'enrolled') then
    select count(*) into v_enrolled from club.class_signups where session_id = new.session_id and status = 'enrolled' and id is distinct from new.id;
    if v_enrolled >= v_session.capacity then
      raise exception 'That class is full.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function club.guard_event_rsvp() returns trigger language plpgsql as $$
declare
  v_event club.events%rowtype;
  v_taken integer;
begin
  select * into v_event from club.events where id = new.event_id for update;

  if tg_op = 'INSERT' then
    if v_event.status <> 'scheduled' and new.status in ('going', 'waitlisted') then
      raise exception 'That event was cancelled.' using errcode = '23514';
    end if;
  else
    if new.event_id is distinct from old.event_id or new.member_id is distinct from old.member_id then
      raise exception 'An RSVP cannot be moved to another event or another person.';
    end if;
    if new.status is distinct from old.status then
      if old.status not in ('going', 'waitlisted')
         and not (old.status in ('attended', 'no_show') and new.status in ('attended', 'no_show')) then
        raise exception 'An RSVP that is already % cannot change again.', replace(old.status, '_', ' ');
      end if;
      if old.status = 'going' and new.status = 'waitlisted' then
        raise exception 'Someone with places cannot go back to the waiting list.';
      end if;
      if old.status = 'waitlisted' and new.status not in ('going', 'cancelled') then
        raise exception 'Someone waiting can only get places or leave the list.';
      end if;
    end if;
    if new.guests is distinct from old.guests and old.status not in ('going', 'waitlisted') then
      raise exception 'The guest count of a finished RSVP cannot change.';
    end if;
  end if;

  if new.status = 'going' and v_event.capacity is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'going' or new.guests is distinct from old.guests) then
    select coalesce(sum(1 + guests), 0) into v_taken from club.event_rsvps where event_id = new.event_id and status = 'going' and id is distinct from new.id;
    if v_taken + 1 + new.guests > v_event.capacity then
      raise exception 'That event is full.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

/* ---------- No outcome without a line in the record ---------- */

-- Checked at the end of the change, so the line may be written after the record it explains. The line must be written at
-- the same moment as the status change, say the same thing, and say what it was before.
create function club.require_attendance_line() returns trigger language plpgsql as $$
declare
  v_outcome text;
  v_previous text;
  v_found boolean;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  v_outcome := case when new.status in ('completed', 'attended') then 'attended' when new.status = 'no_show' then 'no_show' end;
  if v_outcome is null then
    return null;
  end if;
  v_previous := case when old.status in ('completed', 'attended') then 'attended' when old.status = 'no_show' then 'no_show' end;
  if tg_table_name = 'bookings' then
    select exists (select 1 from club.attendance_log where booking_id = new.id and outcome = v_outcome and previous_outcome is not distinct from v_previous and at = new.status_changed_at) into v_found;
  elsif tg_table_name = 'class_signups' then
    select exists (select 1 from club.attendance_log where signup_id = new.id and outcome = v_outcome and previous_outcome is not distinct from v_previous and at = new.status_changed_at) into v_found;
  else
    select exists (select 1 from club.attendance_log where rsvp_id = new.id and outcome = v_outcome and previous_outcome is not distinct from v_previous and at = new.status_changed_at) into v_found;
  end if;
  if not v_found then
    raise exception 'Attendance cannot change without a matching line in the check-in record.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger bookings_attendance_line after update of status on club.bookings
  deferrable initially deferred for each row execute function club.require_attendance_line();
create constraint trigger class_signups_attendance_line after update of status on club.class_signups
  deferrable initially deferred for each row execute function club.require_attendance_line();
create constraint trigger event_rsvps_attendance_line after update of status on club.event_rsvps
  deferrable initially deferred for each row execute function club.require_attendance_line();

/* ---------- Locked to the owner ---------- */

alter table club.attendance_log enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema club from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema club from authenticated;
  end if;
end $$;
