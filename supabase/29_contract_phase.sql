-- =====================================================================
-- 29. CONTRACT PHASE — Remove expand-phase shims & legacy domain tables
-- =====================================================================
-- PREREQUISITES: Migrations 20-28 must be applied AND verified.
-- All data in legacy tables has already been migrated to primitives.
--
-- Run only after:
--   1. Confirming tracker_entries has rows migrated from sadhana_reports
--   2. Confirming task_logs has rows migrated from cleaning_logs / service_allocations
--   3. Confirming resource_plans has rows migrated from meal_plans
--   4. Confirming mentorship_relationships has rows migrated from counsellor_id links
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. SAFETY CHECKS
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'tracker_definitions') THEN
    RAISE EXCEPTION 'Migration 25 (trackers) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'task_templates') THEN
    RAISE EXCEPTION 'Migration 26 (tasks) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'resource_types') THEN
    RAISE EXCEPTION 'Migration 27 (resources) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'mentorship_relationships') THEN
    RAISE EXCEPTION 'Migration 28 (mentorship) has not been applied. Aborting.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Drop backward-compat voices VIEW (shim from migration 20)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.voices;

-- ---------------------------------------------------------------------
-- 2. Drop profiles.counsellor_id (migrated to mentorship_relationships)
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_profiles_counsellor_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS counsellor_id;

-- The expand-phase trigger that synced profiles.counsellor_id must go too,
-- or every write to mentorship_relationships will error after the column is gone.
DROP TRIGGER IF EXISTS trg_sync_counsellor_id ON public.mentorship_relationships;
DROP FUNCTION IF EXISTS public.sync_counsellor_id();

-- ---------------------------------------------------------------------
-- 3. Drop legacy domain tables BEFORE altering profiles.role
--    Some legacy tables have RLS policies that reference profiles.role
--    (e.g., hearing_sources_modify). Dropping them first lets the
--    ALTER TYPE below succeed. CASCADE handles any stray FK references.
-- ---------------------------------------------------------------------

-- Sadhana / sources / scoring — all migrated to trackers
DROP TABLE IF EXISTS public.sadhana_reports          CASCADE;
DROP TABLE IF EXISTS public.sadhana_score_config     CASCADE;
DROP TABLE IF EXISTS public.sadhana_scoring_rules    CASCADE;
DROP TABLE IF EXISTS public.sadhana_config           CASCADE;
DROP TABLE IF EXISTS public.weekly_sadhana_reports   CASCADE;
DROP TABLE IF EXISTS public.hearing_sources          CASCADE;
DROP TABLE IF EXISTS public.reading_types            CASCADE;

-- Cleanliness → Tasks primitive
DROP TABLE IF EXISTS public.cleaning_logs            CASCADE;
DROP TABLE IF EXISTS public.cleaning_assignments     CASCADE;
DROP TABLE IF EXISTS public.cleaning_areas           CASCADE;

-- IM Services → Tasks primitive
DROP TABLE IF EXISTS public.service_preferences      CASCADE;
DROP TABLE IF EXISTS public.service_allocations      CASCADE;
DROP TABLE IF EXISTS public.services                 CASCADE;

-- Kitchen → Resources primitive
DROP TABLE IF EXISTS public.meal_plans               CASCADE;

-- ---------------------------------------------------------------------
-- 4. Convert profiles.role from user_role ENUM to TEXT
--    Values stay identical; this allows dropping the enum below.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'role'
      AND udt_name = 'user_role'
  ) THEN
    ALTER TABLE public.profiles ALTER COLUMN role TYPE TEXT USING role::TEXT;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Drop legacy ENUM types (safe now that all using columns are TEXT/gone)
-- ---------------------------------------------------------------------
DROP TYPE IF EXISTS public.user_role     CASCADE;
DROP TYPE IF EXISTS public.meal_type     CASCADE;
DROP TYPE IF EXISTS public.service_status CASCADE;
DROP TYPE IF EXISTS public.cleaning_status CASCADE;
DROP TYPE IF EXISTS public.scoring_rule_type CASCADE;
-- event_type and hierarchy_level still used by active tables — NOT dropped.

-- ---------------------------------------------------------------------
-- 6. Rewrite RLS policies that still call is_admin() / get_my_role()
--    (migration 24 rewrote most; these are any that slipped through)
-- ---------------------------------------------------------------------

-- organization_settings: was is_admin()
DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- organizations
DROP POLICY IF EXISTS "organizations_write" ON public.organizations;
CREATE POLICY "organizations_write" ON public.organizations
  FOR ALL USING (
    id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- departments
DROP POLICY IF EXISTS "departments_write" ON public.departments;
CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['departments.manage', 'org.manage_settings'])
  );

-- org_positions
DROP POLICY IF EXISTS "org_positions_write" ON public.org_positions;
CREATE POLICY "org_positions_write" ON public.org_positions
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- profiles update: was is_admin()
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.has_permission('members.manage')
  );

-- events write: was is_admin()
DROP POLICY IF EXISTS "events_write" ON public.events;
CREATE POLICY "events_write" ON public.events
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['events.manage', 'org.manage_settings'])
  );

-- announcements write/update/delete (was get_my_voice_id() / is_admin())
DROP POLICY IF EXISTS "announcements_select" ON public.announcements;
CREATE POLICY "announcements_select" ON public.announcements
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "announcements_update" ON public.announcements;
CREATE POLICY "announcements_update" ON public.announcements
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('announcements.manage')
  );

DROP POLICY IF EXISTS "announcements_delete" ON public.announcements;
CREATE POLICY "announcements_delete" ON public.announcements
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND public.has_permission('announcements.manage')
  );

-- notifications update/delete (was get_my_voice_id() / is_admin())
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (
    profile_id = auth.uid() AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS "notifications_update_self" ON public.notifications;
CREATE POLICY "notifications_update_self" ON public.notifications
  FOR UPDATE USING (
    profile_id = auth.uid() AND org_id = public.current_org_id()
  );

-- ---------------------------------------------------------------------
-- 7. Drop legacy helper functions (now fully replaced)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_voice_id();
DROP FUNCTION IF EXISTS public.get_my_role();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.update_sadhana_config_timestamp();

-- ---------------------------------------------------------------------
-- 8. Update handle_new_user() — role is now TEXT, email should be stored
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spiritual TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_display   TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    v_spiritual
  );
BEGIN
  -- Write only the columns that actually exist so sign-ups survive partial migrations.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='display_name')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, display_name, spiritual_name, email, role)
    VALUES (NEW.id, v_display, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, spiritual_name, email, role)
    VALUES (NEW.id, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, spiritual_name, role)
    VALUES (NEW.id, v_spiritual, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Clean up any remaining indexes named after old columns
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_sadhana_reports_org_date;
DROP INDEX IF EXISTS public.idx_sadhana_reports_profile_date;
DROP INDEX IF EXISTS public.idx_cleaning_logs_org_date;
DROP INDEX IF EXISTS public.idx_cleaning_logs_area_date;
DROP INDEX IF EXISTS public.idx_service_allocations_date;
DROP INDEX IF EXISTS public.idx_service_allocations_profile;
DROP INDEX IF EXISTS public.idx_meal_plans_date;

-- ---------------------------------------------------------------------
-- 10. Final status notice
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 29 complete. Legacy tables and shims removed.';
  RAISE NOTICE 'Active tables: organizations, profiles, memberships, roles, permissions,';
  RAISE NOTICE '  role_permissions, membership_roles, modules, module_configs,';
  RAISE NOTICE '  departments, org_positions, events, notifications, announcements,';
  RAISE NOTICE '  push_subscriptions, device_tokens,';
  RAISE NOTICE '  tracker_definitions, tracker_fields, tracker_scoring_rules,';
  RAISE NOTICE '  tracker_entries, tracker_field_values,';
  RAISE NOTICE '  task_categories, task_templates, task_areas, task_assignments, task_logs, task_preferences,';
  RAISE NOTICE '  resource_types, resource_plans, resource_plan_items,';
  RAISE NOTICE '  mentorship_types, mentorship_relationships.';
END $$;
