-- 008_add_facebook_publication.sql
-- Store an editable Facebook caption and prevent duplicate publication.

alter table public.events
  add column facebook_message text,
  add column facebook_post_id text,
  add column facebook_published_at timestamptz;

alter table public.events
  add constraint events_facebook_message_length_check
    check (facebook_message is null or char_length(facebook_message) <= 5000),
  add constraint events_facebook_publication_pair_check
    check (
      (facebook_post_id is null and facebook_published_at is null)
      or
      (facebook_post_id is not null and facebook_published_at is not null)
    );

create unique index events_facebook_post_id_uidx
  on public.events(facebook_post_id)
  where facebook_post_id is not null;

comment on column public.events.facebook_message is
  'Editable Facebook caption prepared for this event.';

comment on column public.events.facebook_post_id is
  'Facebook Graph API post ID; its presence prevents duplicate publication.';

comment on column public.events.facebook_published_at is
  'Time at which the event was successfully published to Facebook.';
