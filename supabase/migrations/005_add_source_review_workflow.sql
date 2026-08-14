-- 005_add_source_review_workflow.sql
-- Track automatically discovered sources until their reusable details are verified.

alter table public.sources
  add column needs_review boolean not null default false,
  add column review_reason text,
  add column discovered_from_event_id uuid
    references public.events(id)
    on delete set null;

create index sources_review_idx
  on public.sources(needs_review, is_active);

