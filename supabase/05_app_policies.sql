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
