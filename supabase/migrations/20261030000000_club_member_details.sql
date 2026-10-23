/*
  Correcting a person's details (name, email, phone).

  Staff can fix a mistyped email so the person can sign in. The building comparison: the front desk corrects a name or
  a phone number on a lease, and the tenant file always gets a line saying what it said before and what it says now.

  The database refuses two things on its own, whatever the app does:
  - changing the details of an adult who has left, or whose membership ended (the file is closed);
  - changing a name, email or phone without a matching line, written at the same moment, in the household's file.
*/

/* ---------- A new kind of line in the household's file ---------- */

alter table club.household_history drop constraint household_history_kind_check;
alter table club.household_history add constraint household_history_kind_check check (
  kind in ('joined', 'member_added', 'member_removed', 'member_updated', 'primary_changed', 'type_changed', 'qualification_granted', 'bookings_cancelled', 'signups_cancelled', 'rsvps_cancelled', 'membership_ended')
);

/* ---------- Closed files stay closed ---------- */

-- The same guard as before (a member never moves household, and never comes back once gone), with one more rule.
create or replace function club.guard_member() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'active' and exists (select 1 from club.households where id = new.household_id and status = 'ended') then
      raise exception 'A household whose membership ended cannot have active members.';
    end if;
  else
    if new.household_id is distinct from old.household_id then
      raise exception 'A member cannot be moved to a different household.';
    end if;
    -- Only an active member's status can change, and only to "removed" or "household_ended". Coming back is a new record.
    if new.status is distinct from old.status and old.status <> 'active' then
      raise exception 'A member who has left or whose membership ended cannot be made active again.';
    end if;
    -- Someone who has left, or whose membership ended, is history: their details stay as they were.
    if old.status <> 'active' and (
      new.first_name is distinct from old.first_name
      or new.last_name is distinct from old.last_name
      or new.email is distinct from old.email
      or new.phone is distinct from old.phone
    ) then
      raise exception 'The details of an adult who has left, or whose membership ended, cannot be changed.';
    end if;
  end if;
  return new;
end $$;

/* ---------- No change without a line in the file ---------- */

-- Checked at the end of the change, so the line may be written after the record it explains. The line must be about this
-- member, and for each detail that changed it must say what it was and what it is now.
create function club.require_member_details_line() returns trigger language plpgsql as $$
begin
  if new.first_name is not distinct from old.first_name
    and new.last_name is not distinct from old.last_name
    and new.email is not distinct from old.email
    and new.phone is not distinct from old.phone then
    return null;
  end if;
  if not exists (
    select 1 from club.household_history h
    where h.household_id = new.household_id
      and h.kind = 'member_updated'
      and h.details ->> 'memberId' = new.id::text
      and (new.first_name = old.first_name or (h.details ->> 'firstNameFrom' = old.first_name and h.details ->> 'firstNameTo' = new.first_name))
      and (new.last_name = old.last_name or (h.details ->> 'lastNameFrom' = old.last_name and h.details ->> 'lastNameTo' = new.last_name))
      and (new.email = old.email or (h.details ->> 'emailFrom' = old.email and h.details ->> 'emailTo' = new.email))
      and (new.phone = old.phone or (h.details ->> 'phoneFrom' = old.phone and h.details ->> 'phoneTo' = new.phone))
  ) then
    raise exception 'A member''s details cannot change without a matching line in the household''s file.' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger members_details_line after update of first_name, last_name, email, phone on club.members
  deferrable initially deferred for each row execute function club.require_member_details_line();
