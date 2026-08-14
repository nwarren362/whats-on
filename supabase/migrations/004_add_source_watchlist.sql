-- 004_add_source_watchlist.sql
-- Private editorial watchlist used for future event research.

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  source_type text not null default 'other'
    check (source_type in ('facebook_group', 'facebook_page', 'mairie', 'tourist_office', 'organiser', 'local_press', 'other')),
  area text,
  notes text,
  access_notes text,
  priority text not null default 'normal'
    check (priority in ('high', 'normal', 'low')),
  is_active boolean not null default true,
  added_by text,
  last_checked_at timestamptz,
  last_useful_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sources_active_priority_idx
  on public.sources(is_active, priority);

create index sources_area_idx
  on public.sources(area);

alter table public.sources enable row level security;

-- Deliberately no anonymous policies. Sources are available only through
-- the authenticated manage-events and research tools.

insert into public.sources
  (name, url, source_type, area, notes, access_notes, priority, added_by, last_useful_at)
values
  ('Tourisme Lot', 'https://www.tourisme-lot.com/', 'tourist_office', 'Lot', 'Agenda fiable pour les marchés gourmands, manifestations et événements datés.', null, 'high', 'Codex', now()),
  ('Vallée du Lot et Garonne Tourisme', 'https://tourisme.valleedulotetgaronne.com/agenda/', 'tourist_office', 'Vallée du Lot-et-Garonne', 'Agenda local structuré avec dates, lieux et images.', null, 'high', 'Codex', now()),
  ('La Dépêche – actualité locale', 'https://www.ladepeche.fr/', 'local_press', 'Lot et Lot-et-Garonne', 'Programmes détaillés et annonces de manifestations locales.', 'Certains articles peuvent être réservés aux abonnés.', 'high', 'Codex', now()),
  ('Mairie de Gavaudun', 'https://gavaudun.fr/category/actualites/', 'mairie', 'Gavaudun', 'Soirées gourmandes, concerts et animations du château et du village.', null, 'high', 'Codex', now()),
  ('Mairie de Fumel', 'https://mairiedefumel.fr/', 'mairie', 'Fumel', 'Agenda municipal et événements saisonniers.', null, 'normal', 'Codex', now()),
  ('Mairie de Monflanquin', 'https://monflanquin.fr/all-events/', 'mairie', 'Monflanquin', 'Marchés de producteurs, musique et événements de la bastide.', null, 'normal', 'Codex', now()),
  ('Montaigu-de-Quercy – Agenda', 'https://www.montaigu-de-quercy.fr/agenda-1/', 'mairie', 'Montaigu-de-Quercy', 'Marchés gourmands et événements communaux.', null, 'normal', 'Codex', now()),
  ('Comité des fêtes de Montcabrier', 'https://www.facebook.com/comitedesfetesmoncabrier', 'facebook_page', 'Montcabrier', 'Fêtes, marchés et animations de Montcabrier.', 'Facebook peut nécessiter une connexion.', 'high', 'Nigel', now()),
  ('Gavaudun – Comité des fêtes et animations', 'https://www.facebook.com/profile.php?id=100071594292937', 'facebook_page', 'Gavaudun', 'Programme musical et soirées gourmandes.', 'Facebook peut nécessiter une connexion.', 'high', 'Nigel', now()),
  ('Guinguette d’Albas', 'https://guinguettealbas.wordpress.com/agenda/', 'organiser', 'Albas', 'Agenda de la guinguette : repas, concerts et soirées saisonnières.', null, 'normal', 'Nigel', now()),
  ('Les Villégiatures', 'https://lesvillegiatures.com/', 'organiser', 'Biron et alentours', 'Concerts dans des lieux patrimoniaux.', null, 'normal', 'Nigel', now());
