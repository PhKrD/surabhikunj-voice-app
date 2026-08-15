-- Fix: pc_app_usage_events and pc_installed_apps upserts from the device
-- (VoiceKidsMonitorService, via SupabaseRest.upsert with on_conflict=...)
-- were failing with 42501 "new row violates row-level security policy",
-- even though a correct pc_*_device_insert policy already existed.
--
-- Root cause: PostgreSQL's INSERT ... ON CONFLICT DO UPDATE (what PostgREST's
-- upsert generates) needs to check for a conflicting row, which requires
-- SELECT-level RLS visibility into the table for the acting role. Both
-- tables only had a *_parent_select policy (pc_is_parent_of) — nothing let
-- the device see (and thus upsert-conflict-check) its own rows, so every
-- upsert attempt was rejected outright before the INSERT policy even had a
-- chance to apply. This silently broke app usage + installed-app reporting
-- from day one.
--
-- Fix: add a device-scoped SELECT policy (pc_is_device_auth) to both tables,
-- mirroring the existing pattern on pc_device_commands.

CREATE POLICY "pc_app_usage_device_select" ON public.pc_app_usage_events
  FOR SELECT
  USING (public.pc_is_device_auth(device_id));

CREATE POLICY "pc_installed_apps_device_select" ON public.pc_installed_apps
  FOR SELECT
  USING (public.pc_is_device_auth(device_id));
