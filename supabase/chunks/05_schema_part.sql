-- CHUNK 5 (schema files)

-- FILE: 27_resources.sql
-- =====================================================================
-- 27. RESOURCES — Generic planning primitive
-- =====================================================================
-- Generalises `meal_plans` into a flexible planning engine for any
-- resource an organization wants to schedule: food menus, inventory
-- allocation, equipment booking, room reservations, prasad distribution,
-- budget line items, etc.
--
-- Architecture:
--   resource_types     — org-defined categories (Meal, Room, Equipment…)
--   resource_plans     — a scheduled plan for one resource type on one date
--   resource_plan_items— the individual items (dishes, quantities, notes)
--
-- Surabhikunj's meal_plans are migrated into this model.
-- The old table remains for the current bundle; it is deprecated in
-- the contract phase.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RESOURCE TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                  -- "Meal Plan", "Room Booking"
  icon        TEXT DEFAULT 'UtensilsCrossed',
  color       TEXT DEFAULT '#f59e0b',
  description TEXT,

  -- Period controls how one plan covers: 'day' | 'week' | 'month'
  period      TEXT NOT NULL DEFAULT 'day',

  -- Free-form labels for sub-types within a plan (meal types, time slots…)
  -- e.g. ["Breakfast", "Lunch", "Dinner"]
  slots       TEXT[] NOT NULL DEFAULT '{}',

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.resource_types
  DROP CONSTRAINT IF EXISTS resource_types_period_check;
ALTER TABLE public.resource_types
  ADD CONSTRAINT resource_types_period_check
  CHECK (period IN ('day', 'week', 'month'));

CREATE INDEX IF NOT EXISTS idx_resource_types_org
  ON public.resource_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. RESOURCE PLANS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_type_id UUID NOT NULL REFERENCES public.resource_types(id) ON DELETE CASCADE,
  plan_date       DATE NOT NULL,
  slot            TEXT,           -- e.g. "Lunch" — must match one of resource_types.slots
  title           TEXT,           -- optional human label
  notes           TEXT,
  is_special      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, resource_type_id, plan_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_resource_plans_org_date
  ON public.resource_plans (org_id, resource_type_id, plan_date);

-- ---------------------------------------------------------------------
-- 3. RESOURCE PLAN ITEMS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plan_items (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id  UUID NOT NULL REFERENCES public.resource_plans(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,             -- dish name, item name, quantity label
  quantity TEXT,                      -- "500 g", "2 trays", free-form
  notes    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_resource_plan_items_plan
  ON public.resource_plan_items (plan_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Meal Plan resource type + migrate meal_plans
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_type_id    UUID;
  v_plan_id    UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Create the Meal Plan resource type
  INSERT INTO public.resource_types (org_id, name, icon, color, period, slots)
  VALUES (
    v_org_id,
    'Meal Plan',
    'UtensilsCrossed',
    '#f59e0b',
    'day',
    ARRAY['Breakfast', 'Lunch', 'Dinner', 'Special Prasad']
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.resource_types WHERE org_id = v_org_id AND name = 'Meal Plan' LIMIT 1;
  END IF;

  -- Migrate meal_plans → resource_plans + resource_plan_items
  FOR v_plan_id IN
    INSERT INTO public.resource_plans
      (org_id, resource_type_id, plan_date, slot, notes, is_special, created_by, created_at, updated_at)
    SELECT
      m.org_id,
      v_type_id,
      m.plan_date,
      CASE m.meal_type::text
        WHEN 'breakfast'     THEN 'Breakfast'
        WHEN 'lunch'         THEN 'Lunch'
        WHEN 'dinner'        THEN 'Dinner'
        WHEN 'prasad_special' THEN 'Special Prasad'
        ELSE m.meal_type::text
      END,
      m.notes,
      m.is_special,
      m.created_by,
      m.created_at,
      m.updated_at
    FROM public.meal_plans m
    WHERE m.org_id = v_org_id
    ON CONFLICT (org_id, resource_type_id, plan_date, slot) DO NOTHING
    RETURNING id
  LOOP
    -- Create one item per menu entry
    INSERT INTO public.resource_plan_items (plan_id, name, sort_order)
    SELECT
      v_plan_id,
      unnest_item,
      row_number() OVER ()
    FROM (
      SELECT unnest(mp.menu_items) AS unnest_item
      FROM public.meal_plans mp
      JOIN public.resource_plans rp ON rp.id = v_plan_id
      WHERE mp.org_id = v_org_id
        AND mp.plan_date = rp.plan_date
    ) sub
    WHERE unnest_item IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.resource_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resource_types_select" ON public.resource_types;
CREATE POLICY "resource_types_select" ON public.resource_types
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_types_write" ON public.resource_types;
CREATE POLICY "resource_types_write" ON public.resource_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

DROP POLICY IF EXISTS "resource_plans_select" ON public.resource_plans;
CREATE POLICY "resource_plans_select" ON public.resource_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_plans_write" ON public.resource_plans;
CREATE POLICY "resource_plans_write" ON public.resource_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- Items inherit from plans
DROP POLICY IF EXISTS "resource_plan_items_select" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_select" ON public.resource_plan_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
        AND public.has_permission('resources.view')
    )
  );

DROP POLICY IF EXISTS "resource_plan_items_write" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_write" ON public.resource_plan_items
  FOR ALL USING (
    public.has_permission('resources.manage')
    AND EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_resource_plans_updated_at ON public.resource_plans;
CREATE TRIGGER trg_resource_plans_updated_at
  BEFORE UPDATE ON public.resource_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 28_mentorship.sql
-- =====================================================================
-- 28. MENTORSHIP — Generic relationship primitive
-- =====================================================================
-- Replaces the single `profiles.counsellor_id` FK with a typed,
-- versioned, many-to-one (or many-to-many) relationship model any
-- organization can use for:
--   spiritual counsellor / devotee (Surabhikunj)
--   manager / employee
--   senior volunteer / junior volunteer
--   teacher / student
--   buddy / new member
--
-- Architecture:
--   mentorship_types         — org-defined relationship types
--   mentorship_relationships — the actual links (mentor ↔ mentee)
--
-- Existing counsellor_id FK values are migrated.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MENTORSHIP TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                    -- "Counsellor", "Buddy"
  mentor_label     TEXT NOT NULL DEFAULT 'Mentor',   -- label for the mentor side
  mentee_label     TEXT NOT NULL DEFAULT 'Mentee',   -- label for the mentee side
  description      TEXT,
  icon             TEXT DEFAULT 'Users',
  color            TEXT DEFAULT '#0891b2',

  -- Maximum mentees a single mentor can hold (NULL = unlimited)
  max_mentees      INTEGER,

  -- Whether the org enforces a 1-mentor limit per mentee for this type
  exclusive        BOOLEAN NOT NULL DEFAULT TRUE,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_types_org
  ON public.mentorship_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. MENTORSHIP RELATIONSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_relationships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type_id     UUID NOT NULL REFERENCES public.mentorship_types(id) ON DELETE CASCADE,
  mentor_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, type_id, mentee_id)   -- exclusive: one mentor per mentee per type
);

ALTER TABLE public.mentorship_relationships
  DROP CONSTRAINT IF EXISTS mentorship_relationships_status_check;
ALTER TABLE public.mentorship_relationships
  ADD CONSTRAINT mentorship_relationships_status_check
  CHECK (status IN ('active', 'ended', 'paused'));

CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentor
  ON public.mentorship_relationships (mentor_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentee
  ON public.mentorship_relationships (mentee_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_org
  ON public.mentorship_relationships (org_id, type_id, status);

-- ---------------------------------------------------------------------
-- 3. GUARD — mentor cannot be their own mentee
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_self_mentorship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mentor_id = NEW.mentee_id THEN
    RAISE EXCEPTION 'A member cannot be their own mentor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_mentorship ON public.mentorship_relationships;
CREATE TRIGGER trg_prevent_self_mentorship
  BEFORE INSERT OR UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_mentorship();

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Counsellor type + migrate counsellor_id
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id  UUID;
  v_type_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.mentorship_types
    (org_id, name, mentor_label, mentee_label, description, icon, color,
     max_mentees, exclusive, sort_order)
  VALUES
    (v_org_id, 'Counsellor', 'Counsellor', 'Counsellee',
     'Spiritual guidance and sadhana review',
     'Users', '#0891b2', NULL, TRUE, 10)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.mentorship_types WHERE org_id = v_org_id AND name = 'Counsellor' LIMIT 1;
  END IF;

  -- Migrate profiles.counsellor_id → mentorship_relationships
  INSERT INTO public.mentorship_relationships
    (org_id, type_id, mentor_id, mentee_id, status)
  SELECT
    v_org_id,
    v_type_id,
    counsellor_id,
    id,
    'active'
  FROM public.profiles
  WHERE org_id = v_org_id
    AND counsellor_id IS NOT NULL
    AND counsellor_id <> id
  ON CONFLICT (org_id, type_id, mentee_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 5. SYNC TRIGGER — keep the legacy counsellor_id column in sync
-- ---------------------------------------------------------------------
-- During the expand phase, some code still reads profiles.counsellor_id.
-- Any write to mentorship_relationships mirrors back.

CREATE OR REPLACE FUNCTION public.sync_counsellor_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_counsellor_type BOOLEAN;
BEGIN
  SELECT name = 'Counsellor' INTO v_is_counsellor_type
  FROM public.mentorship_types WHERE id = COALESCE(NEW.type_id, OLD.type_id);

  IF NOT v_is_counsellor_type THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status <> 'active') THEN
    UPDATE public.profiles
    SET counsellor_id = NULL, updated_at = NOW()
    WHERE id = OLD.mentee_id AND counsellor_id = OLD.mentor_id;
  ELSE
    UPDATE public.profiles
    SET counsellor_id = NEW.mentor_id, updated_at = NOW()
    WHERE id = NEW.mentee_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_counsellor_id ON public.mentorship_relationships;
CREATE TRIGGER trg_sync_counsellor_id
  AFTER INSERT OR UPDATE OF mentor_id, mentee_id, status OR DELETE
  ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.sync_counsellor_id();

-- ---------------------------------------------------------------------
-- 6. HELPERS
-- ---------------------------------------------------------------------

-- Mentees the caller mentors, with their latest tracker scores
CREATE OR REPLACE FUNCTION public.my_mentees(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentee_id   UUID,
  type_id     UUID,
  type_name   TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentee_id, mr.type_id, mt.name, mr.status, mr.started_at
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  WHERE mr.mentor_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name, mr.started_at;
$$;

-- Who mentors the caller
CREATE OR REPLACE FUNCTION public.my_mentor(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentor_id     UUID,
  type_id       UUID,
  type_name     TEXT,
  status        TEXT,
  started_at    TIMESTAMPTZ,
  mentor_name   TEXT,
  mentor_avatar TEXT,
  mentor_phone  TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentor_id, mr.type_id, mt.name, mr.status, mr.started_at,
         p.spiritual_name, p.avatar_url, p.phone
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  JOIN public.profiles p           ON p.id  = mr.mentor_id
  WHERE mr.mentee_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_mentees(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_mentor(UUID)  TO authenticated;

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.mentorship_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_types_select" ON public.mentorship_types;
CREATE POLICY "mentorship_types_select" ON public.mentorship_types
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "mentorship_types_write" ON public.mentorship_types;
CREATE POLICY "mentorship_types_write" ON public.mentorship_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('mentorship.manage')
  );

-- A mentee sees their own relationship; a mentor sees their mentees;
-- admins with mentorship.view_all see everything.
DROP POLICY IF EXISTS "mentorship_rels_select" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_select" ON public.mentorship_relationships
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      mentee_id = auth.uid()
      OR mentor_id = auth.uid()
      OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
    )
  );

DROP POLICY IF EXISTS "mentorship_rels_write" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_write" ON public.mentorship_relationships
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('mentorship.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_mentorship_rels_updated_at ON public.mentorship_relationships;
CREATE TRIGGER trg_mentorship_rels_updated_at
  BEFORE UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 29_contract_phase.sql
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


-- FILE: 30_onboarding.sql
-- =====================================================================
-- 30. ONBOARDING — Founding and joining an organization
-- =====================================================================
-- Migration 24 removed the implicit "every signup joins the default VOICE"
-- behaviour and documented that joining should become an explicit act:
-- "invite, join code, or founding one". None of those were ever built, so a
-- brand-new signup landed in a dead end: no membership -> my_organizations()
-- returns nothing -> the app has no org context and no way to obtain one.
--
-- This migration supplies the two missing entry points:
--
--   create_organization()       found a new org, become its owner
--   join_organization_by_code() request to join an existing org
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JOIN CODE — the shareable token members use to find an org
-- ---------------------------------------------------------------------
-- Short, uppercase, unambiguous alphabet (no O/0, I/1) so it can be read
-- aloud or printed on a noticeboard without transcription errors.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS join_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_i        INTEGER;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..7 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill any org created before this migration
UPDATE public.organizations
SET join_code = public.generate_join_code()
WHERE join_code IS NULL;

ALTER TABLE public.organizations ALTER COLUMN join_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_join_code
  ON public.organizations (join_code);

-- ---------------------------------------------------------------------
-- 2. CREATE ORGANIZATION — the founder path
-- ---------------------------------------------------------------------
-- SECURITY DEFINER because the caller has no membership yet and therefore
-- cannot satisfy any org-scoped RLS policy. Everything it writes is keyed
-- to auth.uid(), so a caller can only ever enrol themselves.

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_locale   TEXT DEFAULT 'en-IN'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_name       TEXT := nullif(trim(p_name), '');
  v_base_slug  TEXT;
  v_slug       TEXT;
  v_suffix     INTEGER := 0;
  v_org_id     UUID;
  v_code       TEXT;
  v_membership UUID;
  v_owner_role UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create an organization';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  IF length(v_name) < 3 THEN
    RAISE EXCEPTION 'Organization name must be at least 3 characters';
  END IF;

  -- Derive a unique URL-safe slug
  v_base_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'org';
  END IF;

  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug   := v_base_slug || '-' || v_suffix;
  END LOOP;

  v_code := public.generate_join_code();

  -- The org itself. A trigger from migration 23 seeds the module catalog.
  INSERT INTO public.organizations
    (name, slug, join_code, status, plan, timezone, locale, owner_id)
  VALUES
    (v_name, v_slug, v_code, 'active', 'free', p_timezone, p_locale, v_uid)
  RETURNING id INTO v_org_id;

  -- Settings row so the org has a branding/terminology surface immediately
  INSERT INTO public.organization_settings (org_id) VALUES (v_org_id)
  ON CONFLICT DO NOTHING;

  -- Roles (owner/admin/manager/member) and modules. Both are idempotent;
  -- seed_default_modules is also fired by trigger, this is belt-and-braces.
  PERFORM public.seed_default_roles(v_org_id);
  PERFORM public.seed_default_modules(v_org_id);

  -- Founder becomes an active member straight away
  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org_id, v_uid, 'active', NOW())
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = 'active', joined_at = COALESCE(memberships.joined_at, NOW())
  RETURNING id INTO v_membership;

  -- ...holding the wildcard 'owner' role
  SELECT r.id INTO v_owner_role
  FROM public.roles r
  WHERE r.org_id = v_org_id AND r.key = 'owner';

  IF v_owner_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
    VALUES (v_membership, v_owner_role, v_uid)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Make it the active org and clear the legacy approval gate
  UPDATE public.profiles p
  SET active_org_id = v_org_id,
      org_id        = COALESCE(p.org_id, v_org_id),
      is_approved   = TRUE,
      updated_at    = NOW()
  WHERE p.id = v_uid;

  RETURN json_build_object('org_id', v_org_id, 'slug', v_slug, 'join_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. JOIN BY CODE — the member path
-- ---------------------------------------------------------------------
-- Creates a membership. Whether it is immediately usable depends on the
-- org's own policy: organization_settings.features.requireApproval. When
-- approval is required the membership starts 'pending' and an admin with
-- members.approve promotes it; otherwise the member is active at once.

CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_org          RECORD;
  v_requires     BOOLEAN;
  v_status       TEXT;
  v_membership   UUID;
  v_default_role UUID;
  v_existing     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join an organization';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Join code is required';
  END IF;

  SELECT o.id, o.name, o.status INTO v_org
  FROM public.organizations o
  WHERE o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM public.memberships m
  WHERE m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO v_requires
  FROM public.organization_settings s
  WHERE s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT id INTO v_default_role
  FROM public.roles
  WHERE org_id = v_org.id AND is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles
    SET active_org_id = v_org.id,
        org_id        = COALESCE(org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. PENDING MEMBERSHIPS — so the UI can explain the wait
-- ---------------------------------------------------------------------
-- my_organizations() deliberately lists active memberships only. Without
-- this the onboarding screen cannot distinguish "you have not joined
-- anything" from "you are waiting to be approved".

CREATE OR REPLACE FUNCTION public.my_pending_memberships()
RETURNS TABLE (org_id UUID, org_name TEXT, requested_at TIMESTAMPTZ)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, m.created_at
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'pending'
  ORDER BY m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.my_pending_memberships() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. APPROVE / REJECT a pending membership
-- ---------------------------------------------------------------------
-- Gated on members.approve so any org-defined role carrying that
-- permission can act, not just a hardcoded admin role name.

CREATE OR REPLACE FUNCTION public.approve_membership(
  p_user_id UUID,
  p_approve BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.current_org_id();
BEGIN
  IF NOT public.has_permission('members.approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve members';
  END IF;

  IF p_approve THEN
    UPDATE public.memberships
    SET status = 'active', joined_at = COALESCE(joined_at, NOW()), updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;

    UPDATE public.profiles
    SET is_approved = TRUE, updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.memberships
    SET status = 'left', updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_membership(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Let a signed-in user with no membership read an org's public shell
-- ---------------------------------------------------------------------
-- Needed so the join screen can confirm "you are about to join <name>".
-- Exposes nothing beyond name/slug for a code the caller already holds.

CREATE OR REPLACE FUNCTION public.peek_organization(p_code TEXT)
RETURNS TABLE (org_name TEXT, member_count BIGINT)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.name,
         (SELECT count(*) FROM public.memberships m
          WHERE m.org_id = o.id AND m.status = 'active')
  FROM public.organizations o
  WHERE o.join_code = upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    AND o.status = 'active'
    AND auth.uid() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.peek_organization(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ORG MEMBER DIRECTORY — driven by memberships, not profiles.org_id
-- ---------------------------------------------------------------------
-- The members screen used to filter profiles by org_id. Since joining is now
-- recorded in `memberships`, and a pending member deliberately has no
-- profiles.org_id yet, that query cannot see join requests at all. This RPC
-- makes membership the source of truth so pending members are visible and
-- therefore approvable.

CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
  status         TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id,
         COALESCE(m.display_name, p.display_name),
         p.spiritual_name,
         p.legal_name,
         p.email,
         p.avatar_url,
         p.role,
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Status notice
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 30 complete: organizations can now be founded and joined.';
  RAISE NOTICE 'Existing org join codes:';
END $$;

SELECT name, slug, join_code FROM public.organizations ORDER BY created_at;


-- FILE: 31_fix_handle_new_user.sql
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
-- Drop the pre-RBAC create_organization(TEXT,TEXT,TEXT,TEXT) overload from
-- migration 20. Migration 30 defined a new create_organization(TEXT,TEXT,TEXT)
-- (different arg count/names) but Postgres treats that as an overload, not a
-- replacement, so both now exist. PostgREST cannot pick between them when the
-- app calls create_organization with only p_name, and fails with PGRST203
-- ("Could not choose the best candidate function"). The 20_platform_core
-- version also predates memberships/roles/join_code, so it must not win.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_organization(TEXT, TEXT, TEXT, TEXT);


-- FILE: 32_fix_member_management.sql
-- =====================================================================
-- 32. FIX MEMBER MANAGEMENT
-- =====================================================================
-- MembersPage.jsx lets an admin pick a role for a member from the org's
-- `roles` table, then saved that choice by writing profiles.role (the
-- legacy free-text column). Since migration 22, actual access control is
-- resolved from membership_roles / role_permissions, not profiles.role, so
-- every "role change" made through that screen was a silent no-op: the
-- dropdown looked like it worked, nothing about the member's real
-- permissions ever changed.
--
-- This migration:
--   1. Extends org_members() to also report each member's current RBAC
--      role (role_id/role_name), so the UI can show what is actually true.
--   2. Adds set_member_role(), which writes membership_roles instead of
--      the dead profiles.role column.
--   3. Aligns the "members" module's required_permission with the
--      members.manage the /members route already demands, so a member who
--      cannot use the page never sees it in navigation and gets silently
--      bounced back to "/" after clicking it.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. org_members() — report each member's actual RBAC role too
-- ---------------------------------------------------------------------
-- DROP required because we're adding columns to the return type; Postgres
-- does not allow CREATE OR REPLACE to change a function's return signature.

DROP FUNCTION IF EXISTS public.org_members();

CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
  role_id        UUID,
  role_name      TEXT,
  status         TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id,
         COALESCE(m.display_name, p.display_name),
         p.spiritual_name,
         p.legal_name,
         p.email,
         p.avatar_url,
         p.role,
         top_role.role_id,
         top_role.role_name,
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN LATERAL (
    SELECT r.id AS role_id, r.name AS role_name
    FROM public.membership_roles mr
    JOIN public.roles r ON r.id = mr.role_id
    WHERE mr.membership_id = m.id
    ORDER BY r.priority DESC
    LIMIT 1
  ) top_role ON TRUE
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. set_member_role() — the write path org_members() was missing
-- ---------------------------------------------------------------------
-- Replaces whatever role(s) the membership currently holds with a single
-- chosen one. Demoting the organization's last '*' holder is blocked by
-- trg_prevent_last_owner_removal (fires on the DELETE below).

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_role_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_membership UUID;
BEGIN
  IF NOT public.has_permission('roles.assign') THEN
    RAISE EXCEPTION 'You do not have permission to assign roles';
  END IF;

  SELECT id INTO v_membership
  FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'That role does not belong to this organization';
  END IF;

  DELETE FROM public.membership_roles WHERE membership_id = v_membership;
  INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
  VALUES (v_membership, p_role_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Nav visibility should match what the route actually allows
-- ---------------------------------------------------------------------
-- /members (App.jsx) requires members.manage. The catalog only required
-- members.view, so a plain member saw "Members" in their sidebar, clicked
-- it, and was bounced straight back to "/" with no explanation.

UPDATE public.modules
SET required_permission = 'members.manage'
WHERE key = 'members';

