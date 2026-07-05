-- =====================================================================
-- 19. PUSH NOTIFICATIONS (Web Push + Android FCM)
-- =====================================================================
-- Adds token storage for both delivery channels and an INSERT trigger on
-- `notifications` that fires the `send-push` Edge Function via pg_net, so
-- EVERY notification (announcement, seva, cleanliness, event, weekly report
-- reminder, etc.) automatically rings the user's device with a sound.
--
-- ONE-TIME SETUP (run once, replacing the placeholders):
--   1. enable pg_net (Supabase: Database > Extensions > "pg_net")
--   2. store the function URL + service role key so the trigger can call it:
--        insert into private.app_secrets (key, value) values
--          ('edge_base_url', 'https://<project-ref>.supabase.co/functions/v1'),
--          ('service_role_key', '<your service_role key>')
--        on conflict (key) do update set value = excluded.value;
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Private secrets store (only reachable by SECURITY DEFINER funcs / service role)
-- ---------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.app_secrets (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- Web Push subscriptions (PWA / browser — iOS 16.4+ home-screen, Android, desktop)
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);
create index if not exists idx_push_subs_profile on push_subscriptions(profile_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subs_own ON push_subscriptions;
create policy push_subs_own on push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Native FCM device tokens (Android APK / iOS native if ever built)
-- ---------------------------------------------------------------------
create table if not exists device_tokens (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'android',  -- android | ios | web
  created_at  timestamptz default now()
);
create index if not exists idx_device_tokens_profile on device_tokens(profile_id);

alter table device_tokens enable row level security;

drop policy if exists device_tokens_own ON device_tokens;
create policy device_tokens_own on device_tokens
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Trigger: on new notification, call the send-push Edge Function
-- ---------------------------------------------------------------------
create or replace function public.notify_push_on_insert()
returns trigger as $$
declare
  v_base_url text;
  v_key      text;
begin
  select value into v_base_url from private.app_secrets where key = 'edge_base_url';
  select value into v_key      from private.app_secrets where key = 'service_role_key';

  -- If not configured yet, skip silently (in-app notification still saved).
  if v_base_url is null or v_key is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'profile_id',   new.profile_id,
      'title',        new.title,
      'body',         coalesce(new.body, ''),
      'type',         coalesce(new.type, 'general'),
      'reference_id', new.reference_id
    )
  );

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_push on notifications;
create trigger trg_notify_push
  after insert on notifications
  for each row execute function public.notify_push_on_insert();
