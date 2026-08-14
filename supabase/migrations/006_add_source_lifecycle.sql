-- 006_add_source_lifecycle.sql
-- Replace overlapping source flags with one clear editorial lifecycle.
-- Legacy columns remain temporarily so the currently deployed editor keeps working
-- during the staged rollout. Migration 007 removes them after verification.

alter table public.sources
  add column lifecycle_status text not null default 'verified'
    check (lifecycle_status in ('review', 'verified'));

update public.sources
set lifecycle_status = case when needs_review then 'review' else 'verified' end;

alter table public.events
  add column source_tracking_ignored_url text;

create index sources_lifecycle_priority_idx
  on public.sources(lifecycle_status, priority);
