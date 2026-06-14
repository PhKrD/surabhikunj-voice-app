-- Notifications engine: auto-create notifications from key events.
-- Run after 01..10. Functions are SECURITY DEFINER so they can insert
-- recipient rows for all members regardless of per-user RLS.

-- New announcement -> notify every active member of the VOICE (except author)
create or replace function public.notify_voice_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (voice_id, profile_id, title, body, type, reference_id)
  select NEW.voice_id, p.id, 'Announcement: ' || NEW.title, NEW.body, 'general', NEW.id
  from public.profiles p
  where p.voice_id = NEW.voice_id
    and p.is_active = true
    and (NEW.created_by is null or p.id <> NEW.created_by);
  return NEW;
end;
$$;

drop trigger if exists trg_notify_announcement on public.announcements;
create trigger trg_notify_announcement
  after insert on public.announcements
  for each row execute function public.notify_voice_on_announcement();

-- New service allocation -> notify the assigned devotee
create or replace function public.notify_on_service_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_name text;
begin
  select name into v_service_name from public.services where id = NEW.service_id;
  insert into public.notifications (voice_id, profile_id, title, body, type, reference_id)
  values (
    NEW.voice_id,
    NEW.profile_id,
    'New service assigned',
    coalesce(v_service_name, 'Service') || ' on ' || to_char(NEW.service_date, 'DD Mon YYYY'),
    'service',
    NEW.service_id
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_service_allocation on public.service_allocations;
create trigger trg_notify_service_allocation
  after insert on public.service_allocations
  for each row execute function public.notify_on_service_allocation();
