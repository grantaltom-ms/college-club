-- The executive page's priorities (Nov 11, 2026). Run this once in the Supabase SQL editor for the College Club project.
-- It makes the table and, only if the table is empty, loads the starting three priorities. Running it again changes nothing.
--
-- The table is locked to the server: row level security is on with no policies, so only the service role key (set in Vercel,
-- never in the browser) can read or change it. The executive team edits it from the page itself, with its editing password.
-- Text may hold live figure codes such as {{waitlist_now}}; the page replaces them with the dashboard's current numbers.

create table if not exists public.executive_priorities (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  summary text not null check (char_length(summary) between 1 and 300),
  facts text[] not null default '{}' check (cardinality(facts) <= 12),
  meaning text not null default '' check (char_length(meaning) <= 2000),
  question text not null default '' check (char_length(question) <= 500),
  careful text not null default '' check (char_length(careful) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.executive_priorities enable row level security;

insert into public.executive_priorities (sort_order, title, summary, facts, meaning, question, careful)
select * from (values
  (1, 'The waitlist that refills the club is almost gone.',
   'The waitlist that refills the club is almost gone, so keeping members is now the membership plan.',
   array[
     'The waitlist was {{waitlist_now}} in {{waitlist_month}}, down from {{waitlist_year_ago}} a year earlier and {{waitlist_two_years_ago}} two years earlier.',
     '{{resignations_12}} households resigned in the last 12 months, about {{resignations_per_month}} a month. Today''s waitlist would replace about {{months_of_cover}} months of that. Last winter ({{last_winter}}) {{last_winter_resignations}} resigned.',
     '{{rarely}} of {{member_households}} member households ({{rarely_share}}) came in less than once a month this year (visits through {{visits_through}}). They are the likeliest to leave.',
     'Dues-paying members were {{members_now}} in {{waitlist_month}}. The total has held steady for two years because applicants from the waitlist replaced the people who left.'
   ]::text[],
   'Until now a resignation cost the club little, because someone on the waitlist took the place. With the waitlist this short, each resignation this winter is very likely a lost household and lost dues. Keeping the members the club has is worth more than recruiting this season.',
   'What winter resignation number would the board call a success, and who owns reaching it?',
   'A few older monthly waitlist counts are estimates (they are flagged on the Membership page). A visit is a day with a door entry or a booking.'),
  (2, 'Rowers and non-rowers each need a strategy: rowing use is falling, and non-rowers are the least satisfied.',
   'Rowers and non-rowers each need their own strategy: rowing use is falling, and non-rowers are the least satisfied.',
   array[
     'Member outings in club boats from Jan 1 to {{rowing_through}}: {{rowing_now}} this year against {{rowing_before}} last year, {{rowing_change}}, with a similar number of boats in use. Team practices are not counted.',
     'In the 2026 member survey, gym and fitness (94%) and social events (93%) were rated very or somewhat important. Rowing split members: 42% very important, 30% not important.',
     'Households that say they never row rose from 34% (2025 survey) to 45% (2026 survey).',
     'The recommend score fell from 78 to 70. It is lowest among members who never row and members aged 33 to 50 (+59 each) and highest among regular rowers (+85).',
     'The {{regulars}} members who come weekly or more make {{regulars_entry_share}} of door entries. Most of them are early-morning rowers and gym users.'
   ]::text[],
   'These are two separate jobs, not a choice between them. Regular rowers are the club''s most loyal members and their use is falling, so the rowing strategy is about what stands between them (and the members who say they want to row) and the water. Non-rowers are now close to half of households, value the gym and social life most, and are the least enthusiastic, so their strategy is about making the club better for how they use it.',
   'Who will map out each of the two strategies, what does each aim for, and when will the board see them?',
   'Each survey is about 120 self-selected responses, two-thirds from members over 50, so year-to-year changes are signals rather than proof. Outings are reservations, not confirmed trips.'),
  (3, 'The building plan has large bills coming and almost none of them has a price.',
   'The building plan has large bills coming and almost none of them has a price.',
   array[
     'Exterior painting of both vessels, $60,156, is approved and scheduled for spring or summer 2027.',
     'The locker room remodel is the plan''s number one priority and has no price. About 25 projects planned for FY27 to FY32 have no price either, including the FY30 dry-dock group: both roofs, siding, the boathouse floor and water damage.',
     'In 2023 the club spent $64,800 on house projects against a $30,000 budget.',
     'Members'' top repair requests in the 2026 survey: the dock (about 25 comments, 12 “needs improvement” votes) and the gym (about 19 comments, 14 votes).'
   ]::text[],
   'Without prices the board cannot tell whether dues and savings will cover the next five years, or whether the dry-dock year will force a special assessment. The longer pricing waits, the fewer choices the club has.',
   'What will the next five years of building work cost, and how will the club pay for it?',
   'Building figures are from the House Committee''s capital planner and capital requests (reviewed Sep 2026); its actual-cost columns are empty, and its files are kept in one member''s personal Google account.')
) as seed (sort_order, title, summary, facts, meaning, question, careful)
where not exists (select 1 from public.executive_priorities);
