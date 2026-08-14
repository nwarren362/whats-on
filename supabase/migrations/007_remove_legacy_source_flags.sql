-- 007_remove_legacy_source_flags.sql
-- Run only after the lifecycle editor and API have been deployed and tested.

drop index if exists public.sources_active_priority_idx;
drop index if exists public.sources_review_idx;

alter table public.sources
  drop column is_active,
  drop column needs_review;

