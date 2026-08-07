-- 001_initial_schema.sql

create extension if not exists pgcrypto;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  sort_order integer not null default 0,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  description text,

  start_at timestamptz,
  end_at timestamptz,
  expires_at timestamptz,

  location_name text,

  category_id uuid not null
    references public.categories(id)
    on update cascade
    on delete restrict,

  status_id uuid not null
    references public.statuses(id)
    on update cascade
    on delete restrict,

  source_url text,
  image_url text,

  featured boolean not null default false,

  editor_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_start_at_idx
  on public.events(start_at);

create index events_expires_at_idx
  on public.events(expires_at);

create index events_category_id_idx
  on public.events(category_id);

create index events_status_id_idx
  on public.events(status_id);

create index events_featured_idx
  on public.events(featured);

insert into public.categories (name, slug, sort_order)
values
  ('Events', 'events', 10),
  ('Food & Wine', 'food-wine', 20),
  ('Markets', 'markets', 30),
  ('Music & Culture', 'music-culture', 40),
  ('Walks & Outdoors', 'walks-outdoors', 50),
  ('Festivals & Fêtes', 'festivals-fetes', 60),
  ('Other', 'other', 90);

insert into public.statuses (name, slug, sort_order, is_public)
values
  ('Draft', 'draft', 10, false),
  ('Published', 'published', 20, true),
  ('Archived', 'archived', 30, false),
  ('Cancelled', 'cancelled', 40, false);

alter table public.categories enable row level security;
alter table public.statuses enable row level security;
alter table public.events enable row level security;

create policy "Public can read active categories"
on public.categories
for select
to anon
using (is_active = true);

create policy "Public can read statuses"
on public.statuses
for select
to anon
using (true);

create policy "Public can read published current events"
on public.events
for select
to anon
using (
  exists (
    select 1
    from public.statuses s
    where s.id = events.status_id
      and s.is_public = true
  )
  and (
    expires_at is null
    or expires_at >= now()
  )
);