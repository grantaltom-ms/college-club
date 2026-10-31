-- The honor snack bar iPad: a member puts snacks on their own household's account.
--
-- Until now every charge was typed in by staff, and the database refused anything else. A snack bought on the iPad is still
-- one ordinary charge (so it is billed, voided and locked with a closed month exactly like the rest), but it is entered by the
-- member themselves. So the table learns four things, and refuses everything else a member might try:
--   quantity, unit_cents  how many snacks, and the price of one when it was bought (the amount is always their product)
--   entry_token           a random token the iPad screen carried; the same token is recorded once, so a double tap is one purchase
--   created_by_id         the member who made the entry (staff entries have none)
-- A member's entry is only ever a snack-bar sale on their own tab; staff entries never carry the iPad's fields.

alter table club.charges
  add column quantity integer,
  add column unit_cents integer,
  add column entry_token text,
  add column created_by_id uuid references club.members (id) on delete restrict;

alter table club.charges drop constraint charges_created_by_kind_check;
alter table club.charges add constraint charges_created_by_kind_check check (created_by_kind in ('staff', 'member'));

-- The iPad's fields come together or not at all, and a member's entry is the one that has them.
alter table club.charges add constraint charges_snack_fields_come_together check (
  (quantity is null) = (unit_cents is null) and (quantity is null) = (entry_token is null) and (quantity is null) = (created_by_id is null)
);
alter table club.charges add constraint charges_member_entries_have_the_fields check ((created_by_kind = 'member') = (quantity is not null));

-- Shape: a sensible count, a sensible price, and an amount that is exactly the two multiplied.
alter table club.charges add constraint charges_snack_quantity_is_sensible check (quantity is null or quantity between 1 and 100);
alter table club.charges add constraint charges_snack_price_is_sensible check (unit_cents is null or unit_cents between 1 and 100000);
alter table club.charges add constraint charges_snack_amount_is_quantity_times_price check (quantity is null or amount_cents = quantity * unit_cents);
alter table club.charges add constraint charges_entry_token_shape check (entry_token is null or (char_length(entry_token) between 16 and 64 and entry_token ~ '^[A-Za-z0-9_-]+$'));

-- A member's entry is a snack-bar sale on their own tab. coalesce: a missing value must count as "not allowed", not "unknown".
alter table club.charges add constraint charges_member_entries_are_snack_sales check (
  created_by_kind = 'staff'
  or coalesce(category = 'snack_bar' and not adjustment and member_id is not null and created_by_id = member_id, false)
);

-- One purchase per screen: the same token can never be recorded twice.
create unique index charges_entry_token_unique on club.charges (entry_token) where entry_token is not null;

create or replace function club.guard_charge() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if club.month_is_billed(new.day) then
      raise exception 'That month was already billed, so a charge cannot be dated in it. Add an adjustment dated in an open month.' using errcode = '23514';
    end if;
    if new.status <> 'open' then
      raise exception 'A charge starts open.';
    end if;
    if new.member_id is not null and not exists (select 1 from club.members where id = new.member_id and household_id = new.household_id) then
      raise exception 'A charge can only name someone in the household it is charged to.' using errcode = '23514';
    end if;
    -- Only someone who is still an active member of an active household can put snacks on their own account.
    if new.created_by_kind = 'member'
       and not exists (
         select 1 from club.members m join club.households h on h.id = m.household_id
          where m.id = new.created_by_id and m.status = 'active' and h.status = 'active'
       ) then
      raise exception 'Only an active member can put snacks on their own account.' using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id
       or new.household_id is distinct from old.household_id
       or new.member_id is distinct from old.member_id
       or new.day is distinct from old.day
       or new.category is distinct from old.category
       or new.adjustment is distinct from old.adjustment
       or new.amount_cents is distinct from old.amount_cents
       or new.description is distinct from old.description
       or new.created_at is distinct from old.created_at
       or new.created_by_kind is distinct from old.created_by_kind
       or new.created_by_id is distinct from old.created_by_id
       or new.created_by_label is distinct from old.created_by_label
       or new.quantity is distinct from old.quantity
       or new.unit_cents is distinct from old.unit_cents
       or new.entry_token is distinct from old.entry_token then
      raise exception 'A charge cannot be changed. Void it and enter a new one.';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided charge cannot change again.';
    end if;
    if club.month_is_billed(old.day) then
      raise exception 'That charge was already billed. Add an adjustment dated in an open month instead.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
