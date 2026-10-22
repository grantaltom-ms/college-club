-- What the app's database store needs to rebuild exactly what it saved.
--
-- 1. Who did something, when that someone is a member: the earlier tables kept the kind and the name but not which
--    member, so the app could not tell whose booking a member had made.
-- 2. The order things were created in. Several records are written in the same moment (a household's "joined" line and
--    its first adults), and the screens must show them in the order they were written. An identity column counts them.
-- 3. The order of seats on a multi-seat boat.
--
-- Nothing here changes what the earlier rules allow or refuse.

alter table club.bookings add column created_by_id text check (char_length(created_by_id) <= 64);
alter table club.bookings add column cancelled_by_id text check (char_length(cancelled_by_id) <= 64);

alter table club.booking_crew add column position integer not null default 0 check (position >= 0);

alter table club.households add column seq bigint generated always as identity;
alter table club.members add column seq bigint generated always as identity;
alter table club.member_qualifications add column seq bigint generated always as identity;
alter table club.household_history add column seq bigint generated always as identity;
alter table club.items add column seq bigint generated always as identity;
alter table club.out_of_service add column seq bigint generated always as identity;
alter table club.bookings add column seq bigint generated always as identity;

create unique index households_seq_idx on club.households (seq);
create unique index members_seq_idx on club.members (seq);
create unique index member_qualifications_seq_idx on club.member_qualifications (seq);
create unique index household_history_seq_idx on club.household_history (seq);
create unique index items_seq_idx on club.items (seq);
create unique index out_of_service_seq_idx on club.out_of_service (seq);
create unique index bookings_seq_idx on club.bookings (seq);

-- Returning something to service in the very moment it was taken out leaves an empty period: it never mattered, and
-- nothing is deleted. So the end may equal the start (it still may not come before it). Taking something out for a
-- stretch of zero length is still refused by the app.
alter table club.out_of_service drop constraint out_of_service_ends_after_start;
alter table club.out_of_service add constraint out_of_service_ends_after_start check (until_at is null or until_at >= from_at);
