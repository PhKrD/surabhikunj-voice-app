-- Missing/extended RLS policies for app features
-- Run after 01..04

-- ============================================================
-- SERVICES WRITE (needed by ServicesPage create/edit/archive)
-- ============================================================

drop policy if exists "services_write" on public.services;
create policy "services_write" on public.services
  for all
  using (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  )
  with check (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  );

-- ============================================================
-- SERVICE ALLOCATIONS WRITE (IM/admin can assign/update)
-- ============================================================

drop policy if exists "service_allocations_write" on public.service_allocations;
create policy "service_allocations_write" on public.service_allocations
  for all
  using (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  )
  with check (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  );

-- ============================================================
-- SERVICE PREFERENCES SELECT/WRITE
-- Devotees set their own preferences; IM/admin can read for scheduler
-- ============================================================

drop policy if exists "service_preferences_select" on public.service_preferences;
create policy "service_preferences_select" on public.service_preferences
  for select
  using (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  );

drop policy if exists "service_preferences_write" on public.service_preferences;
create policy "service_preferences_write" on public.service_preferences
  for all
  using (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  )
  with check (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  );

-- ============================================================
-- CLEANING ASSIGNMENTS SELECT/WRITE
-- Needed for admin area assignment workflow in CleanlinessPage
-- ============================================================

drop policy if exists "cleaning_assignments_select" on public.cleaning_assignments;
create policy "cleaning_assignments_select" on public.cleaning_assignments
  for select
  using (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
  );

drop policy if exists "cleaning_assignments_write" on public.cleaning_assignments;
create policy "cleaning_assignments_write" on public.cleaning_assignments
  for all
  using (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
    and is_admin()
  )
  with check (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = cleaning_assignments.profile_id
        and p.voice_id = get_my_voice_id()
    )
    and is_admin()
  );

-- ============================================================
-- PROFILES UPDATE HARDENING
-- Replace broad update policy with voice-scoped checks
-- ============================================================

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update
  using (
    voice_id = get_my_voice_id()
    and (
      id = auth.uid()
      or is_admin()
    )
  )
  with check (
    voice_id = get_my_voice_id()
    and (
      id = auth.uid()
      or is_admin()
    )
  );

-- ============================================================
-- NOTIFICATIONS INSERT/UPDATE
-- Required for in-app notification creation from client
-- ============================================================

drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert
  with check (
    voice_id = get_my_voice_id()
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc', 'dept_incharge', 'sadhana_incharge', 'counsellor')
    )
  );

drop policy if exists "notifications_update_self" on public.notifications;
create policy "notifications_update_self" on public.notifications
  for update
  using (voice_id = get_my_voice_id() and profile_id = auth.uid())
  with check (voice_id = get_my_voice_id() and profile_id = auth.uid());

-- ============================================================
-- EVENTS WRITE RECREATE (explicit WITH CHECK)
-- ============================================================

drop policy if exists "events_write" on public.events;
create policy "events_write" on public.events
  for all
  using (voice_id = get_my_voice_id() and is_admin())
  with check (voice_id = get_my_voice_id() and is_admin());
