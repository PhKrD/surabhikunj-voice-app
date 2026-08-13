-- =====================================================================
-- 24. RLS REWRITE — Policies driven by permissions, not role names
-- =====================================================================
-- Every policy written in 01_schema.sql / 05_app_policies.sql tests role
-- names directly, e.g.  get_my_role() IN ('counsellor','admin','vmc','oc').
-- That makes custom roles meaningless at the security layer: an org could
-- create a "Kitchen Head" role but the database would never honour it.
--
-- This migration re-expresses every policy in terms of has_permission(),
-- so a permission granted to ANY role — including one the org invented
-- five minutes ago — is enforced correctly.
--
-- Also introduces active-org switching, needed now that a user can belong
-- to more than one organization.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ACTIVE ORGANIZATION
-- ---------------------------------------------------------------------
-- With multi-org membership, "which org am I looking at right now?" must
-- be explicit. Resolution order:
--   1. profiles.active_org_id, if the user is still an active member there
--   2. their legacy profiles.org_id
--   3. their single active membership, if they only have one

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.profiles SET active_org_id = org_id
WHERE active_org_id IS NULL AND org_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.active_org_id
     FROM public.profiles p
     WHERE p.id = auth.uid()
       AND EXISTS (
         SELECT 1 FROM public.memberships m
         WHERE m.user_id = p.id AND m.org_id = p.active_org_id
           AND m.status = 'active'
       )),
    (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT m.org_id FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.status = 'active'
     ORDER BY m.joined_at NULLS LAST LIMIT 1)
  );
$$;

-- Switch the caller into another organization they belong to.
CREATE OR REPLACE FUNCTION public.switch_organization(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not an active member of that organization';
  END IF;

  UPDATE public.profiles
  SET active_org_id = p_org_id, updated_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_organization(UUID) TO authenticated;

-- Organizations the caller can switch into (for an org picker UI).
CREATE OR REPLACE FUNCTION public.my_organizations()
RETURNS TABLE (
  org_id    UUID,
  name      TEXT,
  slug      TEXT,
  logo_url  TEXT,
  status    TEXT,
  is_active BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, o.slug, o.logo_url, m.status,
         (o.id = public.current_org_id()) AS is_active
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY o.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_organizations() TO authenticated;

-- Organizations policy must allow seeing every org you belong to,
-- not only the active one (otherwise the switcher can't render).
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.memberships m
            WHERE m.org_id = organizations.id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "organizations_update" ON public.organizations;
CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 2. PROFILES  (global identity)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

-- Own row always; plus anyone who shares an organization with you.
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memberships me
      JOIN public.memberships them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid() AND them.user_id = profiles.id
    )
  );

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.has_permission('members.manage'));

-- ---------------------------------------------------------------------
-- 3. MEMBERSHIPS  (tightened from the placeholder in migration 21)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;

DROP POLICY IF EXISTS "memberships_update" ON public.memberships;
CREATE POLICY "memberships_update" ON public.memberships
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['members.manage', 'members.approve'])
  );

DROP POLICY IF EXISTS "memberships_insert_admin" ON public.memberships;
CREATE POLICY "memberships_insert_admin" ON public.memberships
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id() AND public.has_permission('members.invite')
  );

DROP POLICY IF EXISTS "memberships_delete" ON public.memberships;
CREATE POLICY "memberships_delete" ON public.memberships
  FOR DELETE USING (
    org_id = public.current_org_id() AND public.has_permission('members.remove')
  );

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('members.manage')
  );

-- ---------------------------------------------------------------------
-- 4. ORGANIZATION SETTINGS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 5. DEPARTMENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "departments_select" ON public.departments;
CREATE POLICY "departments_select" ON public.departments
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('departments.view')
  );

DROP POLICY IF EXISTS "departments_write" ON public.departments;
CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('departments.manage')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='department_members') THEN

    EXECUTE 'DROP POLICY IF EXISTS "department_members_select" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_select" ON public.department_members
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.departments d
                  WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "department_members_write" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_write" ON public.department_members
        FOR ALL USING (
          public.has_any_permission(ARRAY['departments.manage','departments.assign'])
          AND EXISTS (SELECT 1 FROM public.departments d
                      WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. ORG POSITIONS (hierarchy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_positions_select" ON public.org_positions;
CREATE POLICY "org_positions_select" ON public.org_positions
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.view')
  );

DROP POLICY IF EXISTS "org_positions_write" ON public.org_positions;
CREATE POLICY "org_positions_write" ON public.org_positions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.manage')
  );

-- ---------------------------------------------------------------------
-- 7. SADHANA REPORTS  (until the tracker primitive replaces them)
-- ---------------------------------------------------------------------
-- Previously: role IN ('counsellor','sadhana_incharge','admin','vmc','oc').
-- Now: anyone holding trackers.view_all, whatever their role is called.

DROP POLICY IF EXISTS "sadhana_select"     ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_insert_own" ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_update_own" ON public.sadhana_reports;

CREATE POLICY "sadhana_select" ON public.sadhana_reports
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.view_all'))
  );

CREATE POLICY "sadhana_insert" ON public.sadhana_reports
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      (profile_id = auth.uid() AND public.has_permission('trackers.submit'))
      OR public.has_permission('trackers.manage')
    )
  );

CREATE POLICY "sadhana_update" ON public.sadhana_reports
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

CREATE POLICY "sadhana_delete" ON public.sadhana_reports
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

DROP POLICY IF EXISTS "sadhana_config_select" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_select" ON public.sadhana_score_config
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "sadhana_config_write" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_write" ON public.sadhana_score_config
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('trackers.manage')
  );

-- ---------------------------------------------------------------------
-- 8. CLEANING  (until the task primitive replaces it)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "cleaning_areas_select" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_select" ON public.cleaning_areas
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "cleaning_areas_write" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_write" ON public.cleaning_areas
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "cleaning_logs_select" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_select" ON public.cleaning_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "cleaning_logs_insert" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_insert" ON public.cleaning_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.assign'))
  );

DROP POLICY IF EXISTS "cleaning_logs_update" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_update" ON public.cleaning_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.verify'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='cleaning_assignments') THEN
    EXECUTE 'ALTER TABLE public.cleaning_assignments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_select" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_select" ON public.cleaning_assignments
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.cleaning_areas a
                  WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_write" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_write" ON public.cleaning_assignments
        FOR ALL USING (
          public.has_any_permission(ARRAY['tasks.assign','tasks.manage'])
          AND EXISTS (SELECT 1 FROM public.cleaning_areas a
                      WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9. SERVICES  (until the task primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "services_write" ON public.services;
CREATE POLICY "services_write" ON public.services
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "service_allocations_select" ON public.service_allocations;
CREATE POLICY "service_allocations_select" ON public.service_allocations
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "service_allocations_write" ON public.service_allocations;
CREATE POLICY "service_allocations_write" ON public.service_allocations
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (
      profile_id = auth.uid()
      OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage','tasks.verify'])
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='service_preferences') THEN
    EXECUTE 'ALTER TABLE public.service_preferences ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_preferences_all" ON public.service_preferences';
    EXECUTE $p$
      CREATE POLICY "service_preferences_all" ON public.service_preferences
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('tasks.assign')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 10. MEAL PLANS  (until the resource primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "meal_plans_select" ON public.meal_plans;
CREATE POLICY "meal_plans_select" ON public.meal_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "meal_plans_write" ON public.meal_plans;
CREATE POLICY "meal_plans_write" ON public.meal_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- ---------------------------------------------------------------------
-- 11. EVENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('events.view')
  );

DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['events.create','events.manage'])
  );

DROP POLICY IF EXISTS "events_write" ON public.events;
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete" ON public.events
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='event_rsvp') THEN
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_select" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_select" ON public.event_rsvp
        FOR SELECT USING (
          profile_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.events e
                     WHERE e.id = event_id AND e.org_id = public.current_org_id()
                       AND public.has_permission('events.attendance'))
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_write" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_write" ON public.event_rsvp
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('events.attendance')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 12. ANNOUNCEMENTS
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='announcements') THEN
    EXECUTE 'DROP POLICY IF EXISTS "announcements_select" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_select" ON public.announcements
        FOR SELECT USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.view')
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "announcements_write" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_write" ON public.announcements
        FOR ALL USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.manage')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 13. NOTIFICATIONS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('notifications.send'))
  );

-- ---------------------------------------------------------------------
-- 14. Retire the hardcoded role guard on profile updates
-- ---------------------------------------------------------------------
-- Role no longer lives on profiles; it lives in membership_roles, which has
-- its own policy. Approval moved to memberships.status. This trigger keeps
-- the legacy columns locked down while they still exist.

CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_permission(ARRAY['members.manage','roles.assign']) THEN
    NEW.role        := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.org_id      := OLD.org_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 15. Signup: create a global identity only. No auto-join to any org.
-- ---------------------------------------------------------------------
-- Previously every new user was silently attached to Surabhikunj via
-- bootstrap_current_user_to_default_voice(). On a real platform, joining an
-- organization is an explicit act (invite, join code, or founding one).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, spiritual_name, email, is_approved)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    NEW.email,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Kept for backwards compatibility with the deployed bundle, but it is now
-- a no-op unless VITE_DEFAULT_VOICE_ID-style bootstrapping is deliberately
-- re-enabled by an operator.
CREATE OR REPLACE FUNCTION public.bootstrap_current_user_to_default_voice()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;
