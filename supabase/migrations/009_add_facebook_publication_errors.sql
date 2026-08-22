-- Remember failed Facebook publication attempts so the admin list can surface
-- events which need attention before they are tried again.

alter table public.events
  add column facebook_publish_error text,
  add column facebook_publish_attempted_at timestamptz;

create index events_facebook_attention_idx
  on public.events (facebook_publish_attempted_at)
  where facebook_post_id is null and facebook_publish_error is not null;
