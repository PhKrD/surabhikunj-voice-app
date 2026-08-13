-- CHUNK 6 (schema files)

-- FILE: 33_fix_profile_org_ambiguity.sql
-- =====================================================================
-- 33. FIX PROFILE → ORGANIZATION AMBIGUITY
-- =====================================================================
-- profiles has TWO foreign-key columns pointing at organizations:
--   • org_id          – the member's primary / legacy org column
--   • active_org_id   – the currently-selected org for multi-org support
--
-- PostgREST 12 (shipped with newer Supabase projects) added automatic
-- relationship expansion in SELECT *. When two FKs on the same table
-- both point to the same foreign table, PostgREST cannot determine which
-- one to use and raises:
--   "Could not embed because more than one relationship was found
--    for 'profiles' and 'organizations'"
--
-- Fix: drop the FK *constraint* on active_org_id.
--   - The column is kept unchanged (still a UUID storing the active org).
--   - Data integrity is maintained by the memberships table + the
--     current_org_id() function that already validates the value.
--   - PostgREST sees only one FK path (org_id), so SELECT * on profiles
--     no longer errors.
-- =====================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_org_id_fkey;


-- FILE: 34_resolve_profile_org_embedding.sql
-- =====================================================================
-- 34. RESOLVE profiles / organizations RESOURCE-EMBEDDING AMBIGUITY
-- =====================================================================
-- PostgREST still sees more than one relationship between `profiles` and
-- `organizations`, so any `select('*, organizations(...)')` (or the legacy
-- `voices(...)` embed) fails with:
--   "Could not embed because more than one relationship was found
--    for 'profiles' and 'organizations'"
--
-- This migration makes the relationship unambiguous by keeping only the
-- primary `profiles.org_id -> organizations.id` FK and removing:
--   1. Any `profiles` FK to `organizations` that is NOT on `org_id`
--      (e.g. the leftover `active_org_id` FK).
--   2. The reverse `organizations.owner_id -> profiles.id` FK, which
--      also creates a `profiles` <-> `organizations` relation.
--
-- The columns themselves are kept; only the constraints are dropped so
-- PostgREST has a single, unambiguous path for resource embedding.
--
-- Idempotent: safe to re-run.
-- =====================================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  -- 1. Drop any profiles -> organizations FK that is NOT on the org_id column
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class src     ON src.oid     = con.conrelid
    JOIN pg_namespace sns ON sns.oid     = src.relnamespace
    JOIN pg_class tgt     ON tgt.oid     = con.confrelid
    JOIN pg_namespace tns ON tns.oid     = tgt.relnamespace
    JOIN pg_attribute a   ON a.attrelid  = src.oid
                         AND a.attnum    = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND sns.nspname = 'public' AND src.relname = 'profiles'
      AND tns.nspname = 'public' AND tgt.relname = 'organizations'
      AND a.attname <> 'org_id'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;

  -- 2. Drop the reverse organizations -> profiles owner_id FK
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class src     ON src.oid     = con.conrelid
    JOIN pg_namespace sns ON sns.oid     = src.relnamespace
    JOIN pg_class tgt     ON tgt.oid     = con.confrelid
    JOIN pg_namespace tns ON tns.oid     = tgt.relnamespace
    JOIN pg_attribute a   ON a.attrelid  = src.oid
                         AND a.attnum    = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND sns.nspname = 'public' AND src.relname = 'organizations'
      AND tns.nspname = 'public' AND tgt.relname = 'profiles'
      AND a.attname   = 'owner_id'
  LOOP
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

-- 3. Force PostgREST to rebuild its schema cache so the changes take effect
NOTIFY pgrst, 'reload schema';


-- FILE: 35_sync_profile_org_id.sql
-- =====================================================================
-- 35. SYNC profiles.org_id WITH ACTIVE ORGANIZATION
-- =====================================================================
-- The app still reads org context from profiles.org_id in many places, but
-- newer flows (multi-org, switch org) set only profiles.active_org_id. That
-- leaves profiles.org_id NULL, causing:
--   - .eq('org_id', null) SQL errors
--   - INSERT RLS violations because the inserted org_id is NULL
--
-- This migration:
--   1. Backfills profiles.org_id from active_org_id or the single active
--      membership, for any row where org_id is currently NULL.
--   2. Adds a trigger so future updates to active_org_id keep org_id in sync.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- -----------------------------------------------------------------
-- 1. Backfill org_id for existing users
-- -----------------------------------------------------------------
UPDATE public.profiles p
SET org_id = COALESCE(
  p.active_org_id,
  (
    SELECT m.org_id
    FROM public.memberships m
    WHERE m.user_id = p.id AND m.status = 'active'
    ORDER BY m.joined_at ASC
    LIMIT 1
  )
)
WHERE p.org_id IS NULL;

-- -----------------------------------------------------------------
-- 2. Keep org_id in sync with active_org_id going forward
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_org_id IS DISTINCT FROM OLD.active_org_id THEN
    NEW.org_id := NEW.active_org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_org_id ON public.profiles;
CREATE TRIGGER trg_sync_profile_org_id
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_org_id();


-- FILE: 36_fix_nav_labels.sql
-- =====================================================================
-- 36. FIX BLANK NAVIGATION LABELS
-- =====================================================================
-- my_navigation() used COALESCE(om.label_override, m.name). COALESCE only
-- falls back on NULL, so an empty-string label_override (easy to save from
-- the Settings screen) produced a nav item with no visible text — the
-- sidebar rendered a blank row where "Org Structure" should be.
--
-- Fix: treat blank/whitespace-only overrides as "no override" via NULLIF,
-- and clean up any empty overrides already stored.
--
-- Idempotent: safe to re-run.
-- =====================================================================

UPDATE public.organization_modules
SET label_override = NULL
WHERE label_override IS NOT NULL AND trim(label_override) = '';

UPDATE public.organization_modules
SET icon_override = NULL
WHERE icon_override IS NOT NULL AND trim(icon_override) = '';

CREATE OR REPLACE FUNCTION public.my_navigation()
RETURNS TABLE (
  key        TEXT,
  label      TEXT,
  icon       TEXT,
  route      TEXT,
  category   TEXT,
  sort_order INTEGER,
  config     JSONB
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    m.key,
    COALESCE(NULLIF(trim(om.label_override), ''), m.name)  AS label,
    COALESCE(NULLIF(trim(om.icon_override),  ''), m.icon)  AS icon,
    m.route,
    m.category,
    om.sort_order,
    om.config
  FROM public.organization_modules om
  JOIN public.modules m ON m.key = om.module_key
  WHERE om.org_id = public.current_org_id()
    AND om.enabled
    AND (
      m.required_permission IS NULL
      OR public.has_permission(m.required_permission)
    )
  ORDER BY om.sort_order, m.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_navigation() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- FILE: 38_fix_blank_nav_labels.sql
-- =====================================================================
-- 38. FIX BLANK NAV LABELS — AGGRESSIVE CLEANUP
-- =====================================================================
-- my_navigation() returns empty string labels when label_override is ''
-- or whitespace (COALESCE only skips NULL, not empty string). The client-
-- side trim+fallback in Sidebar.jsx should handle this, but we also clean
-- the database so the issue can never recurse.
--
-- This migration supersedes / is safe to run alongside migration 36.
-- Idempotent.
-- =====================================================================

-- 1. Wipe empty or whitespace-only label / icon overrides everywhere
UPDATE public.organization_modules
SET label_override = NULL
WHERE label_override IS NOT NULL AND trim(label_override) = '';

UPDATE public.organization_modules
SET icon_override = NULL
WHERE icon_override IS NOT NULL AND trim(icon_override) = '';

-- 2. Ensure the canonical module names are never blank
--    (defensive: re-set them to the correct English defaults if something
--     wiped them during an early migration / conflict)
UPDATE public.modules SET name = 'Dashboard'      WHERE key = 'dashboard'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Members'        WHERE key = 'members'     AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Departments'    WHERE key = 'departments' AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Org Structure'  WHERE key = 'hierarchy'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Events'         WHERE key = 'events'      AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Trackers'       WHERE key = 'trackers'    AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Tasks'          WHERE key = 'tasks'       AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Resource Plans' WHERE key = 'resources'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Mentorship'     WHERE key = 'mentorship'  AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Announcements'  WHERE key = 'announcements' AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Reports'        WHERE key = 'reports'     AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Residents'      WHERE key = 'residents'   AND (name IS NULL OR trim(name) = '');

-- 3. Replace my_navigation() with a triple-safe version:
--    • NULLIF trims blank label_override before COALESCE
--    • Falls back to key if name is somehow also blank
CREATE OR REPLACE FUNCTION public.my_navigation()
RETURNS TABLE (
  key        TEXT,
  label      TEXT,
  icon       TEXT,
  route      TEXT,
  category   TEXT,
  sort_order INTEGER,
  config     JSONB
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    m.key,
    COALESCE(
      NULLIF(trim(om.label_override), ''),
      NULLIF(trim(m.name), ''),
      m.key
    ) AS label,
    COALESCE(
      NULLIF(trim(om.icon_override), ''),
      NULLIF(trim(m.icon), ''),
      'Circle'
    ) AS icon,
    m.route,
    m.category,
    om.sort_order,
    om.config
  FROM public.organization_modules om
  JOIN public.modules m ON m.key = om.module_key
  WHERE om.org_id = public.current_org_id()
    AND om.enabled
    AND (
      m.required_permission IS NULL
      OR public.has_permission(m.required_permission)
    )
  ORDER BY om.sort_order, m.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_navigation() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- FILE: 39_enable_all_modules.sql
-- =====================================================================
-- 39. ENABLE ALL MODULES + FIX NAV LABELS FOR EVERY ORG
-- =====================================================================
-- Consolidates the fixes from migrations 36, 37, 38 into ONE script.
-- Safe to run even if those earlier ones were already applied.
-- Idempotent.
-- =====================================================================

-- -----------------------------------------------------------------
-- A. FIX BLANK LABELS IN modules TABLE
-- -----------------------------------------------------------------
UPDATE public.modules SET name = 'Dashboard'      WHERE key = 'dashboard'     AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Members'        WHERE key = 'members'       AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Departments'    WHERE key = 'departments'   AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Org Structure'  WHERE key = 'hierarchy'     AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Events'         WHERE key = 'events'        AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Sadhana'        WHERE key = 'trackers'      AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Tasks'          WHERE key = 'tasks'         AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Resource Plans' WHERE key = 'resources'     AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Mentorship'     WHERE key = 'mentorship'    AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Announcements'  WHERE key = 'announcements' AND trim(coalesce(name,'')) = '';
UPDATE public.modules SET name = 'Reports'        WHERE key = 'reports'       AND trim(coalesce(name,'')) = '';

-- Set the Trackers module name to 'Sadhana' globally (every org sees it as Sadhana by default)
UPDATE public.modules SET name = 'Sadhana' WHERE key = 'trackers';

-- -----------------------------------------------------------------
-- B. WIPE BLANK label_override / icon_override
-- -----------------------------------------------------------------
UPDATE public.organization_modules
SET label_override = NULL
WHERE label_override IS NOT NULL AND trim(label_override) = '';

UPDATE public.organization_modules
SET icon_override = NULL
WHERE icon_override IS NOT NULL AND trim(icon_override) = '';

-- -----------------------------------------------------------------
-- C. ENABLE EVERY MODULE FOR EVERY ORG
--    Insert missing rows first, then flip enabled = TRUE
-- -----------------------------------------------------------------
INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled    = TRUE,
    updated_at = NOW()
WHERE enabled IS DISTINCT FROM TRUE;

-- -----------------------------------------------------------------
-- D. REBUILD my_navigation() WITH TRIPLE-SAFE COALESCE
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_navigation()
RETURNS TABLE (
  key        TEXT,
  label      TEXT,
  icon       TEXT,
  route      TEXT,
  category   TEXT,
  sort_order INTEGER,
  config     JSONB
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    m.key,
    COALESCE(
      NULLIF(trim(om.label_override), ''),
      NULLIF(trim(m.name), ''),
      m.key
    ) AS label,
    COALESCE(
      NULLIF(trim(om.icon_override), ''),
      NULLIF(trim(m.icon), ''),
      'Circle'
    ) AS icon,
    m.route,
    m.category,
    om.sort_order,
    om.config
  FROM public.organization_modules om
  JOIN public.modules m ON m.key = om.module_key
  WHERE om.org_id = public.current_org_id()
    AND om.enabled
    AND (
      m.required_permission IS NULL
      OR public.has_permission(m.required_permission)
    )
  ORDER BY om.sort_order, m.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_navigation() TO authenticated;

-- -----------------------------------------------------------------
-- E. SEED SADHANA TRACKER FOR EVERY ORG THAT LACKS ONE
-- -----------------------------------------------------------------
DO $do$
DECLARE
  v_org    RECORD;
  v_tid    UUID;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    SELECT id INTO v_tid
    FROM public.tracker_definitions
    WHERE org_id = v_org.id AND name = 'Sadhana'
    LIMIT 1;

    IF v_tid IS NULL THEN
      INSERT INTO public.tracker_definitions
        (org_id, name, description, icon, color, cadence, submission_mode, has_scoring, score_label)
      VALUES
        (v_org.id, 'Sadhana', 'Daily spiritual practice report', 'BookOpen', '#f97316',
         'daily', 'self', TRUE, 'Sadhana Score')
      RETURNING id INTO v_tid;

      INSERT INTO public.tracker_fields (tracker_id, key, label, field_type, unit, sort_order)
      VALUES
        (v_tid, 'wake_up_time',  'Wake-up Time',   'time',         NULL,      10),
        (v_tid, 'to_bed_time',   'To Bed Time',    'time',         NULL,      20),
        (v_tid, 'day_rest_min',  'Day Rest',       'duration_min', 'minutes', 30),
        (v_tid, 'japa_time',     'Japa Completed', 'time',         NULL,      40),
        (v_tid, 'japa_rounds',   'Japa Rounds',    'number',       'rounds',  50),
        (v_tid, 'reading_min',   'Reading',        'duration_min', 'minutes', 60),
        (v_tid, 'hearing_min',   'Hearing',        'duration_min', 'minutes', 70),
        (v_tid, 'mangal_arti',   'Mangal Arti',    'boolean',      NULL,      80),
        (v_tid, 'morning_class', 'Morning Class',  'boolean',      NULL,      90),
        (v_tid, 'seva_hours',    'Seva',           'number',       'hours',   100)
      ON CONFLICT (tracker_id, key) DO NOTHING;

      INSERT INTO public.tracker_scoring_rules
        (tracker_id, field_key, rule_type, label, max_points, config, sort_order)
      SELECT v_tid, r.field_key, r.rule_type, r.label, r.max_points, r.config, r.sort_order
      FROM (VALUES
        ('japa_time',    'threshold', 'Japa Timing',       10::numeric, '{"tiers":[{"by":"07:00","pts":10},{"by":"08:00","pts":7},{"by":"09:00","pts":5},{"by":"23:59","pts":2}]}'::jsonb, 10),
        ('japa_rounds',  'range',     'Japa Rounds',       10::numeric, '{"min":0,"max":16,"full_score_at":16}'::jsonb, 20),
        ('wake_up_time', 'threshold', 'Wake-up',           10::numeric, '{"tiers":[{"by":"04:30","pts":10},{"by":"05:00","pts":7},{"by":"06:00","pts":4},{"by":"23:59","pts":0}]}'::jsonb, 30),
        ('to_bed_time',  'threshold', 'Bed Time',           5::numeric, '{"tiers":[{"by":"22:00","pts":5},{"by":"23:00","pts":3},{"by":"23:59","pts":0}]}'::jsonb, 40),
        ('day_rest_min', 'penalty',   'Day Rest Penalty',   0::numeric, '{"per_unit":0.5,"unit":15}'::jsonb, 50),
        ('reading_min',  'range',     'Reading',           10::numeric, '{"min":0,"max":45,"full_score_at":45}'::jsonb, 60),
        ('hearing_min',  'range',     'Hearing',           10::numeric, '{"min":0,"max":45,"full_score_at":45}'::jsonb, 70),
        ('mangal_arti',  'boolean',   'Mangal Arti',        5::numeric, '{}'::jsonb, 80),
        ('morning_class','boolean',   'Morning Class',      5::numeric, '{}'::jsonb, 90),
        ('seva_hours',   'range',     'Seva',              10::numeric, '{"min":0,"max":4,"full_score_at":4}'::jsonb, 100)
      ) AS r(field_key, rule_type, label, max_points, config, sort_order)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.tracker_scoring_rules sr
        WHERE sr.tracker_id = v_tid AND sr.field_key = r.field_key AND sr.label = r.label
      );
    END IF;
  END LOOP;
END $do$;

-- -----------------------------------------------------------------
-- F. RELOAD POSTGREST SCHEMA CACHE
-- -----------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

