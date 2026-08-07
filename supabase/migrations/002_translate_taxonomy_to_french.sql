-- 002_translate_taxonomy_to_french.sql
-- Change public-facing category and status names to French.
-- Slugs remain ASCII-only for use internally and in URLs.

update public.categories
set
  name = 'Événements',
  slug = 'evenements'
where slug = 'events';

update public.categories
set
  name = 'Gastronomie et vin',
  slug = 'gastronomie-vin'
where slug = 'food-wine';

update public.categories
set
  name = 'Marchés',
  slug = 'marches'
where slug = 'markets';

update public.categories
set
  name = 'Musique et culture',
  slug = 'musique-culture'
where slug = 'music-culture';

update public.categories
set
  name = 'Activités de plein air',
  slug = 'plein-air'
where slug = 'walks-outdoors';

update public.categories
set
  name = 'Festivals et fêtes',
  slug = 'festivals-fetes'
where slug = 'festivals-fetes';

update public.categories
set
  name = 'Autre',
  slug = 'autre'
where slug = 'other';


-- Translate public-facing status names.
-- Keep the existing English slugs because these are internal
-- application identifiers rather than text displayed to visitors.

update public.statuses
set name = 'Brouillon'
where slug = 'draft';

update public.statuses
set name = 'Publié'
where slug = 'published';

update public.statuses
set name = 'Archivé'
where slug = 'archived';

update public.statuses
set name = 'Annulé'
where slug = 'cancelled';