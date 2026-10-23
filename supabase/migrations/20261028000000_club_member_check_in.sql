-- Member check-in: members check themselves in, on the front-desk iPad or on their own phone.
--
-- The check-in record already had a place for "the member, on the iPad". This adds "the member, on their phone" and
-- tightens what a member's own tap can be: it says "I came" and nothing else, it is about themselves, it is for a boat or space
-- outing they are really on or a class chair they really hold, and it is never a correction (a first line for that record).
-- Members cannot record a no-show or undo a tap; staff do that, as before.
--
-- Applies to the invented test club only. Never applied to the live Supabase project in Phase 1.

alter table club.attendance_log
  drop constraint attendance_log_via_check,
  drop constraint attendance_log_who_matches_how;

alter table club.attendance_log
  add constraint attendance_log_via_check check (via in ('staff', 'automatic', 'ipad', 'phone')),
  -- Who did it and how must agree: the system does the automatic ones, staff the front-desk ones, a member the iPad and phone ones.
  add constraint attendance_log_who_matches_how check (
    (via = 'automatic' and by_kind = 'system')
    or (via = 'staff' and by_kind = 'staff')
    or (via in ('ipad', 'phone') and by_kind = 'member')
  ),
  -- A member's own tap: "I came", about themselves, for a boat or space outing or a class chair, and the first line for it.
  add constraint attendance_log_member_taps_are_simple check (
    via not in ('ipad', 'phone')
    or (outcome = 'attended' and previous_outcome is null and by_id is not null and by_id = member_id::text and kind in ('booking', 'class'))
  );

-- The person who taps has to be on the reservation: the booker or crew still aboard, or the one holding the class chair.
create function club.guard_member_check_in() returns trigger language plpgsql as $$
begin
  if new.via not in ('ipad', 'phone') then
    return new;
  end if;
  if new.kind = 'booking' then
    if not exists (
      select 1 from club.bookings b
      where b.id = new.booking_id
        and (b.booker_id = new.member_id
             or exists (select 1 from club.booking_crew c where c.booking_id = b.id and c.member_id = new.member_id and c.removed_at is null))
    ) then
      raise exception 'A member can only check in for an outing they are on.' using errcode = '23514';
    end if;
  elsif new.kind = 'class' and not exists (select 1 from club.class_signups g where g.id = new.signup_id and g.member_id = new.member_id) then
    raise exception 'A member can only check in for a class they hold a chair in.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger attendance_log_member_check_in before insert on club.attendance_log
  for each row execute function club.guard_member_check_in();
