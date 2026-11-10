-- Coaches-only boats, guarded by the database as well as the app (Grant, Nov 10, 2026): only coaches and club staff can book a
-- 4x (quad or four) or an 8x (eight). Until now the rule lived only in the app's booking check; this adds a second line of defence
-- underneath it, so a booking that slipped past the app (a bug, or a script writing to the database directly) is still refused.
--
-- What it adds:
-- - item_classes.coaches_only: the rules file's coachesOnly flag, mirrored on start-up like the rest of the class (syncRules);
-- - a check on every new booking: on a club boat whose class is coaches-only, a booking a member makes must have an active coach
--   (a member staff marked as a coach, still active, in an active household) as its booker. Staff bookings are never refused for
--   this. A private boat is left to its own list of owners and invited people, whatever its size.
--
-- Bookings already made are left alone, as in the app: a coach who is unmarked keeps the bookings they made. A booking's item and
-- booker can never change (bookings_guard), so checking new bookings is enough.

alter table club.item_classes add column coaches_only boolean not null default false;

create function club.guard_coaches_only_booking() returns trigger language plpgsql as $$
begin
  if new.created_by_kind = 'member'
     and exists (
       select 1 from club.items i join club.item_classes c on c.code = i.class_code
        where i.id = new.item_id and c.coaches_only and not i.is_private
     )
     and not exists (
       select 1 from club.members m join club.households h on h.id = m.household_id
        where m.id = new.booker_id and m.is_coach and m.status = 'active' and h.status = 'active'
     ) then
    raise exception 'This boat can only be booked by coaches and club staff.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger bookings_coaches_only before insert on club.bookings
  for each row execute function club.guard_coaches_only_booking();
