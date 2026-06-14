-- Announcements feature
-- Run after 01..07. Voice-scoped announcements posted by leadership and
-- readable by all members of the VOICE.

create table if not exists public.announcements (
  id          uuid primary key default uuid_generate_v4(),
  voice_id    uuid not null references public.voices(id) on delete cascade,
  title       text not null,
  body        text,
  is_pinned   boolean default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_announcements_voice_created
  on public.announcements(voice_id, is_pinned desc, created_at desc);

alter table public.announcements enable row level security;

-- SELECT: all members of the same VOICE
drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select" on public.announcements
  for select using (voice_id = get_my_voice_id());

-- INSERT: leadership roles, posting as themselves, within their VOICE
drop policy if exists "announcements_insert" on public.announcements;
create policy "announcements_insert" on public.announcements
  for insert with check (
    voice_id = get_my_voice_id()
    and created_by = auth.uid()
    and get_my_role() in ('admin', 'vmc', 'oc', 'im', 'dept_incharge', 'sadhana_incharge', 'counsellor')
  );

-- UPDATE/DELETE: the author or an admin, within their VOICE
drop policy if exists "announcements_update" on public.announcements;
create policy "announcements_update" on public.announcements
  for update
  using (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()))
  with check (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()));

drop policy if exists "announcements_delete" on public.announcements;
create policy "announcements_delete" on public.announcements
  for delete using (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()));

-- Keep updated_at fresh
drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function update_updated_at();
