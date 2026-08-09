-- 003_add_weekly_recurrence.sql
-- Store a repeating weekly series as one curated event.

alter table public.events
  add column recurrence_frequency text not null default 'none',
  add column recurrence_until timestamptz;

alter table public.events
  add constraint events_recurrence_frequency_check
    check (recurrence_frequency in ('none', 'weekly')),
  add constraint events_recurrence_dates_check
    check (
      (recurrence_frequency = 'none' and recurrence_until is null)
      or
      (recurrence_frequency = 'weekly' and recurrence_until is not null)
    );

create index events_recurrence_until_idx
  on public.events(recurrence_until)
  where recurrence_frequency <> 'none';
