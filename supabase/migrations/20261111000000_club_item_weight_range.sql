-- Weight class range (min/max lb) and manufacturer for shells and other boats.
-- A single value in the source means min = max. Null means weight not on file (never invent zero).
-- A change needs a matching "changed" line in the item's file, same as name/seats/skill/places/max weight.

alter table club.items
  add column min_weight_lbs integer
  check (min_weight_lbs is null or (min_weight_lbs between 50 and 800)),
  add column manufacturer text
  check (manufacturer is null or (char_length(manufacturer) between 1 and 80));

alter table club.items
  add constraint items_weight_range_order
  check (
    min_weight_lbs is null
    or max_weight_lbs is null
    or min_weight_lbs <= max_weight_lbs
  );

comment on column club.items.min_weight_lbs is
  'Optional minimum combined rower weight in pounds. With max_weight_lbs forms the weight class shown on Reservations. Null means weight not on file.';
comment on column club.items.manufacturer is
  'Optional boat maker (Sykes, Filippi, …). Null means maker not listed in the source record.';

create or replace function club.require_item_log_line() returns trigger language plpgsql as $$
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
    or new.places is distinct from old.places
    or new.max_weight_lbs is distinct from old.max_weight_lbs
    or new.min_weight_lbs is distinct from old.min_weight_lbs
    or new.manufacturer is distinct from old.manufacturer then
    if not exists (
      select 1 from club.item_log l
       where l.item_id = new.id and l.xact = pg_current_xact_id() and l.kind = 'changed'
         and (new.name = old.name or (l.details ->> 'nameFrom' = old.name and l.details ->> 'nameTo' = new.name))
         and (new.class_code = old.class_code or (l.details ->> 'classFrom' = old.class_code and l.details ->> 'classTo' = new.class_code))
         and (v_new_skill is not distinct from v_old_skill or (l.details ->> 'skillFrom' = v_old_skill and l.details ->> 'skillTo' = v_new_skill))
         and (new.places = old.places or (l.details ->> 'placesFrom' = old.places::text and l.details ->> 'placesTo' = new.places::text))
         and (new.max_weight_lbs is not distinct from old.max_weight_lbs
              or (l.details ->> 'maxWeightFrom' is not distinct from coalesce(old.max_weight_lbs::text, '')
                  and l.details ->> 'maxWeightTo' is not distinct from coalesce(new.max_weight_lbs::text, '')))
         and (new.min_weight_lbs is not distinct from old.min_weight_lbs
              or (l.details ->> 'minWeightFrom' is not distinct from coalesce(old.min_weight_lbs::text, '')
                  and l.details ->> 'minWeightTo' is not distinct from coalesce(new.min_weight_lbs::text, '')))
         and (new.manufacturer is not distinct from old.manufacturer
              or (l.details ->> 'manufacturerFrom' is not distinct from coalesce(old.manufacturer, '')
                  and l.details ->> 'manufacturerTo' is not distinct from coalesce(new.manufacturer, '')))
    ) then
      raise exception 'An item''s name, kind, skill level, places, weight class or manufacturer cannot change without a matching line in its file.' using errcode = '23514';
    end if;
  end if;
  return null;
end $$;

drop trigger if exists items_need_a_log_line on club.items;
create constraint trigger items_need_a_log_line
  after update of name, class_code, qualification_mode, required_qualification, places, max_weight_lbs, min_weight_lbs, manufacturer, retired_at on club.items
  deferrable initially deferred for each row execute function club.require_item_log_line();
