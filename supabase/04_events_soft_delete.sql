-- Add soft-delete support for events on existing databases
alter table public.events
add column if not exists is_active boolean not null default true;

create index if not exists idx_events_voice_active_start
  on public.events (voice_id, is_active, start_datetime desc);
