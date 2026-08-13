-- CHUNK 8 (schema files)

-- FILE: 46_ensure_sadhana_visible.sql
-- =====================================================================
-- 46. ENSURE SADHANA (TRACKERS) MODULE IS VISIBLE IN NAV
-- =====================================================================
-- Migration 42 was run before 39 on some installations, leaving the
-- 'trackers' module absent from organization_modules. This re-enables
-- it for every org that is missing it, and makes sure the global
-- module record has the name 'Sadhana'.
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. Ensure the global module row has the correct name
UPDATE public.modules
SET name = 'Sadhana'
WHERE key = 'trackers';

-- 2. Insert missing organization_modules rows for 'trackers'
INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, 'trackers', TRUE, 50
FROM   public.organizations o
WHERE  NOT EXISTS (
  SELECT 1 FROM public.organization_modules om
  WHERE  om.org_id = o.id AND om.module_key = 'trackers'
);

-- 3. Make sure any existing rows are enabled
UPDATE public.organization_modules
SET    enabled    = TRUE,
       updated_at = NOW()
WHERE  module_key = 'trackers'
  AND  enabled IS DISTINCT FROM TRUE;

-- 4. Also seed the Sadhana tracker definition for any org missing it
DO $do$
DECLARE
  v_org  RECORD;
  v_tid  UUID;
BEGIN
  FOR v_org IN SELECT id FROM public.organizations LOOP
    SELECT id INTO v_tid
    FROM   public.tracker_definitions
    WHERE  org_id = v_org.id AND name = 'Sadhana'
    LIMIT  1;

    IF v_tid IS NULL THEN
      INSERT INTO public.tracker_definitions
        (org_id, name, description, icon, color, cadence, submission_mode, has_scoring, score_label)
      VALUES
        (v_org.id, 'Sadhana', 'Daily spiritual practice report', 'BookOpen', '#f97316',
         'daily', 'self', TRUE, 'Sadhana Score')
      RETURNING id INTO v_tid;

      -- Core Sadhana fields
      INSERT INTO public.tracker_fields
        (tracker_id, key, label, field_type, unit, sort_order)
      VALUES
        (v_tid, 'wake_time',      'Wake-up Time',    'time',         NULL,      1),
        (v_tid, 'bed_time',       'To Bed Time',     'time',         NULL,      2),
        (v_tid, 'day_rest',       'Day Rest',        'duration_min', 'minutes', 3),
        (v_tid, 'japa_time',      'Japa Completed',  'time',         NULL,      4),
        (v_tid, 'japa_rounds',    'Japa Rounds',     'number',       'rounds',  5),
        (v_tid, 'reading',        'Reading',         'duration_min', 'minutes', 6),
        (v_tid, 'hearing',        'Hearing',         'duration_min', 'minutes', 7),
        (v_tid, 'mangal_arti',    'Mangal Arti',     'boolean',      NULL,      8),
        (v_tid, 'morning_class',  'Morning Class',   'boolean',      NULL,      9),
        (v_tid, 'evening_arti',   'Evening Arti',    'boolean',      NULL,      10),
        (v_tid, 'evening_class',  'Evening Class',   'boolean',      NULL,      11),
        (v_tid, 'service',        'Service',         'duration_min', 'minutes', 12),
        (v_tid, 'prasadam_noon',  'Noon Prasadam',   'boolean',      NULL,      13),
        (v_tid, 'prasadam_eve',   'Eve Prasadam',    'boolean',      NULL,      14);
    END IF;
  END LOOP;
END;
$do$;

NOTIFY pgrst, 'reload schema';


-- FILE: 47_fix_join_ambiguity_final.sql
-- =====================================================================
-- 47. FINAL FIX: ambiguous org_id in join / membership flow
-- =====================================================================
-- Run this in the Supabase SQL Editor if users get:
--   "column reference 'org_id' is ambiguous"
-- while joining an organization.
--
-- It re-creates every function in the join path with fully-qualified
-- table aliases so no `org_id` reference is ever ambiguous.
-- Idempotent: safe to re-run.
-- =====================================================================

-- -----------------------------------------------------------------
-- 1. TRIGGER: assign_default_role (fires on INSERT INTO memberships)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT r.id INTO v_role_id
  FROM public.roles AS r
  WHERE r.org_id = NEW.org_id AND r.is_default
  LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Make sure the trigger exists and is bound idempotently
DROP TRIGGER IF EXISTS trg_assign_default_role ON public.memberships;
CREATE TRIGGER trg_assign_default_role
  AFTER INSERT ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_default_role();

-- -----------------------------------------------------------------
-- 2. FUNCTION: current_org_id (used by RLS / UI)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Explicitly chosen active org (and membership still valid)
    (SELECT p.active_org_id
     FROM   public.profiles AS p
     WHERE  p.id = auth.uid()
       AND  p.active_org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships AS m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.active_org_id
                AND  m.status  = 'active'
            )
    ),
    -- 2. Legacy org_id column
    (SELECT p.org_id
     FROM   public.profiles AS p
     WHERE  p.id = auth.uid()
       AND  p.org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships AS m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.org_id
                AND  m.status  = 'active'
            )
    ),
    -- 3. Any single active membership (most recently joined first)
    (SELECT m.org_id
     FROM   public.memberships AS m
     WHERE  m.user_id = auth.uid()
       AND  m.status  = 'active'
     ORDER  BY m.joined_at DESC NULLS LAST
     LIMIT  1
    )
  );
$$;

-- -----------------------------------------------------------------
-- 3. FUNCTION: ensure_active_org (client auto-repair)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_active_org()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_org_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- Already set and valid? Done.
  SELECT p.active_org_id INTO v_org_id
  FROM   public.profiles AS p
  WHERE  p.id = v_uid
    AND  p.active_org_id IS NOT NULL
    AND  EXISTS (
           SELECT 1 FROM public.memberships AS m
           WHERE m.user_id = v_uid
             AND m.org_id = p.active_org_id
             AND m.status = 'active'
         );

  IF v_org_id IS NOT NULL THEN RETURN v_org_id; END IF;

  -- Pick the best active membership
  SELECT m.org_id INTO v_org_id
  FROM   public.memberships AS m
  WHERE  m.user_id = v_uid
    AND  m.status  = 'active'
  ORDER  BY m.joined_at DESC NULLS LAST
  LIMIT  1;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Write it back so future calls are fast
  UPDATE public.profiles AS p
  SET    active_org_id = v_org_id,
         org_id        = COALESCE(p.org_id, v_org_id),
         is_approved   = TRUE,
         updated_at    = NOW()
  WHERE  p.id = v_uid;

  RETURN v_org_id;
END;
$$;

-- -----------------------------------------------------------------
-- 4. FUNCTION: join_organization_by_code (the failing one)
-- -----------------------------------------------------------------
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
  FROM   public.organizations AS o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM   public.memberships AS m
  WHERE  m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    -- Already a member — make sure active_org_id is set
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;

    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings AS s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT r.id INTO v_default_role
  FROM   public.roles AS r
  WHERE  r.org_id = v_org.id AND r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- -----------------------------------------------------------------
-- 5. Also backfill any profiles that still have a NULL active_org_id
-- -----------------------------------------------------------------
UPDATE public.profiles AS p
SET   active_org_id = (
        SELECT m.org_id
        FROM   public.memberships AS m
        WHERE  m.user_id = p.id
          AND  m.status  = 'active'
        ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
        LIMIT  1
      ),
      org_id = COALESCE(
        p.org_id,
        (SELECT m.org_id
         FROM   public.memberships AS m
         WHERE  m.user_id = p.id
           AND  m.status  = 'active'
         ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
         LIMIT  1)
      ),
      is_approved = TRUE,
      updated_at  = NOW()
WHERE p.active_org_id IS NULL
  AND EXISTS (
        SELECT 1 FROM public.memberships AS m
        WHERE m.user_id = p.id
          AND m.status  = 'active'
      );

NOTIFY pgrst, 'reload schema';


-- FILE: 48_fix_join_variable_conflict.sql
-- =====================================================================
-- 48. FIX join_organization_by_code variable/column conflict
-- =====================================================================
-- Root cause:
--   join_organization_by_code RETURNS TABLE (org_id, org_name, status)
--   which means `org_id` and `status` are implicit PL/pgSQL variables.
--   Inside UPDATE/UPSERT statements, targets like:
--      SET org_id = ...
--      DO UPDATE SET status = ...
--   can still raise:
--      column reference "org_id" is ambiguous
--
-- Fix:
--   Recreate the function with `#variable_conflict use_column` so SQL
--   column names always win over PL/pgSQL variables when ambiguous.
--
-- Safe to re-run.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
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
  FROM   public.organizations AS o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  SELECT m.status INTO v_existing
  FROM   public.memberships AS m
  WHERE  m.org_id = v_org.id
    AND  m.user_id = v_uid;

  IF v_existing = 'active' THEN
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;

    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings AS s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (
    v_org.id,
    v_uid,
    v_status,
    CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END
  )
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  SELECT r.id INTO v_default_role
  FROM   public.roles AS r
  WHERE  r.org_id = v_org.id
    AND  r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_status = 'active' THEN
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';


-- FILE: 49_tracker_config_engine.sql
-- =====================================================================
-- 49. TRACKER CONFIG ENGINE — groups, calculated columns, WhatsApp
--     templates, and richer per-field configuration.
-- =====================================================================
-- Extends the generic tracker primitive (25_trackers.sql) with:
--   tracker_field_groups      — visual/scoring grouping of fields
--                                (e.g. "Body", "Pathan & Sravan")
--   tracker_calculated_columns— admin-defined roll-up columns
--                                (e.g. "Body", "Soul", "Total")
--   tracker_whatsapp_templates— configurable share-report templates,
--                                org-default (user_id NULL) or personal
--
-- Also extends tracker_fields with group assignment + display/scoring
-- toggles, all backwards compatible (safe defaults, no data loss).
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FIELD GROUPS
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_field_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id  UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  color       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tracker_field_groups_tracker
  ON public.tracker_field_groups (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. EXTEND tracker_fields — group assignment + display/aggregation config
-- ---------------------------------------------------------------------
ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.tracker_field_groups(id) ON DELETE SET NULL;

ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS show_input BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS show_marks BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Optional short display abbreviation (e.g. "TB", "WU", "JP") used in the
-- spreadsheet header and as the WhatsApp template variable name. Falls back
-- to the uppercased `key` when not set, so nothing breaks for existing
-- fields/templates. Kept separate from `key` (the stable machine id used by
-- scoring rules and historical tracker_field_values) so relabelling never
-- orphans historical data.
ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS short_code TEXT;

-- Weekly/monthly aggregation: how a day with no entry for this field
-- should be treated — 'zero' counts it against the denominator,
-- 'exclude' leaves it out of both numerator and denominator.
ALTER TABLE public.tracker_fields
  ADD COLUMN IF NOT EXISTS missed_day_behavior TEXT NOT NULL DEFAULT 'zero';

ALTER TABLE public.tracker_fields
  DROP CONSTRAINT IF EXISTS tracker_fields_missed_day_check;
ALTER TABLE public.tracker_fields
  ADD CONSTRAINT tracker_fields_missed_day_check
  CHECK (missed_day_behavior IN ('zero', 'exclude'));

CREATE INDEX IF NOT EXISTS idx_tracker_fields_group
  ON public.tracker_fields (group_id);

-- ---------------------------------------------------------------------
-- 3. CALCULATED COLUMNS
-- ---------------------------------------------------------------------
-- Admin-defined roll-up columns (Body / Soul / Total, or anything else).
-- `inputs` is a JSONB array of safe references — never executable code:
--   [{ "type": "field",  "ref": "wake_up_time" },
--    { "type": "group",  "ref": "body" },
--    { "type": "column", "ref": "body" }]
-- Evaluated in ascending sort_order, so columns referencing other
-- columns (e.g. Total = Body + Soul) must sort after their inputs.

CREATE TABLE IF NOT EXISTS public.tracker_calculated_columns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id     UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  inputs         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_highlighted BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tracker_calc_cols_tracker
  ON public.tracker_calculated_columns (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. WHATSAPP TEMPLATES
-- ---------------------------------------------------------------------
-- user_id NULL = the org-wide default template (set by an admin).
-- A row with user_id = auth.uid() is that member's personal override.

CREATE TABLE IF NOT EXISTS public.tracker_whatsapp_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id  UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Default',
  body        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tracker_wa_templates_tracker
  ON public.tracker_whatsapp_templates (tracker_id, user_id);

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------
ALTER TABLE public.tracker_field_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_calculated_columns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_whatsapp_templates   ENABLE ROW LEVEL SECURITY;

-- Groups: same visibility/write rules as tracker_fields
DROP POLICY IF EXISTS "tracker_groups_select" ON public.tracker_field_groups;
CREATE POLICY "tracker_groups_select" ON public.tracker_field_groups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id()
              AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own']))
  );

DROP POLICY IF EXISTS "tracker_groups_write" ON public.tracker_field_groups;
CREATE POLICY "tracker_groups_write" ON public.tracker_field_groups
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

-- Calculated columns: readable by anyone who can see the tracker, editable by admins
DROP POLICY IF EXISTS "tracker_calc_cols_select" ON public.tracker_calculated_columns;
CREATE POLICY "tracker_calc_cols_select" ON public.tracker_calculated_columns
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id()
              AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own']))
  );

DROP POLICY IF EXISTS "tracker_calc_cols_write" ON public.tracker_calculated_columns;
CREATE POLICY "tracker_calc_cols_write" ON public.tracker_calculated_columns
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

-- WhatsApp templates: everyone can read the org default + their own; admins
-- manage the default (user_id IS NULL), members manage only their own row.
DROP POLICY IF EXISTS "tracker_wa_templates_select" ON public.tracker_whatsapp_templates;
CREATE POLICY "tracker_wa_templates_select" ON public.tracker_whatsapp_templates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
    AND (user_id IS NULL OR user_id = auth.uid())
  );

DROP POLICY IF EXISTS "tracker_wa_templates_write" ON public.tracker_whatsapp_templates;
CREATE POLICY "tracker_wa_templates_write" ON public.tracker_whatsapp_templates
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
    AND (
      (user_id = auth.uid())
      OR (user_id IS NULL AND public.has_permission('trackers.manage'))
    )
  );

-- ---------------------------------------------------------------------
-- 6. Helper RPC — fetch a tracker's full config in one round trip
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tracker_config(p_tracker_id UUID)
RETURNS JSONB
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tracker', (SELECT to_jsonb(td) FROM public.tracker_definitions td WHERE td.id = p_tracker_id),
    'groups', (
      SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.sort_order), '[]'::jsonb)
      FROM public.tracker_field_groups g WHERE g.tracker_id = p_tracker_id AND g.is_active
    ),
    'fields', (
      SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.sort_order), '[]'::jsonb)
      FROM public.tracker_fields f WHERE f.tracker_id = p_tracker_id AND f.is_active
    ),
    'rules', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.sort_order), '[]'::jsonb)
      FROM public.tracker_scoring_rules r WHERE r.tracker_id = p_tracker_id
    ),
    'calculated_columns', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.sort_order), '[]'::jsonb)
      FROM public.tracker_calculated_columns c WHERE c.tracker_id = p_tracker_id AND c.is_active
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_tracker_config(UUID) TO authenticated;


-- FILE: 50_sadhana_config_upgrade.sql
-- =====================================================================
-- 50. UPGRADE THE DEFAULT SADHANA CONFIG TO THE SPREADSHEET LAYOUT
-- =====================================================================
-- Rebuilds public.seed_sadhana_tracker() to also create:
--   - Groups: "Body" (TB/WU/DR) and "Pathan & Sravan" (JAPA/Reading/
--     Hearing/MC/MA/Studies/Cleanliness), matching the reference sheet.
--   - Two new fields the old seed never had: Studies and Cleanliness.
--   - Rescaled marks (TB/WU/DR/JAPA = 175, Reading = 75, Hearing = 30,
--     MC/MA = 35, Studies = 70, Cleanliness = 35) instead of the old 0-10
--     per-activity scale.
--   - Calculated columns Body / Soul / Total (Total highlighted).
--   - A default WhatsApp report template using the new short codes.
--
-- Existing field `key`s (wake_up_time, to_bed_time, day_rest_min, ...)
-- are NOT renamed — renaming would orphan historical tracker_field_values
-- rows that reference them by key. Instead each field gets a `short_code`
-- (TB, WU, DR, ...) purely for display/WhatsApp — see migration 49.
--
-- Idempotent: safe to re-run against orgs that already have Sadhana.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.seed_sadhana_tracker(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tracker_id UUID;
  v_body_id    UUID;
  v_soul_id    UUID;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_tracker_id
  FROM public.tracker_definitions
  WHERE org_id = p_org_id AND name = 'Sadhana'
  LIMIT 1;

  IF v_tracker_id IS NULL THEN
    INSERT INTO public.tracker_definitions
      (org_id, name, description, icon, color, cadence, submission_mode, has_scoring, score_label)
    VALUES
      (p_org_id, 'Sadhana', 'Daily spiritual practice report', 'BookOpen', '#f97316',
       'daily', 'self', TRUE, 'Sadhana Score')
    RETURNING id INTO v_tracker_id;
  END IF;

  -- -------------------------------------------------------------------
  -- Groups
  -- -------------------------------------------------------------------
  INSERT INTO public.tracker_field_groups (tracker_id, key, label, sort_order)
  VALUES
    (v_tracker_id, 'body', 'Body', 10),
    (v_tracker_id, 'pathan_shravan', 'Pathan & Sravan', 20)
  ON CONFLICT (tracker_id, key) DO NOTHING;

  SELECT id INTO v_body_id FROM public.tracker_field_groups WHERE tracker_id = v_tracker_id AND key = 'body';
  SELECT id INTO v_soul_id FROM public.tracker_field_groups WHERE tracker_id = v_tracker_id AND key = 'pathan_shravan';

  -- -------------------------------------------------------------------
  -- Fields — original 10 (unchanged keys) + 2 new (Studies, Cleanliness)
  -- -------------------------------------------------------------------
  INSERT INTO public.tracker_fields (tracker_id, key, label, field_type, unit, sort_order)
  VALUES
    (v_tracker_id, 'wake_up_time',      'Wake-up Time',   'time',         NULL,   10),
    (v_tracker_id, 'to_bed_time',       'To Bed Time',    'time',         NULL,   20),
    (v_tracker_id, 'day_rest_min',      'Day Rest',       'duration_min', 'mins', 30),
    (v_tracker_id, 'japa_time',         'Japa Completed', 'time',         NULL,   40),
    (v_tracker_id, 'japa_rounds',       'Japa Rounds',    'number',       'rounds', 50),
    (v_tracker_id, 'reading_min',       'Reading',        'duration_min', 'mins', 60),
    (v_tracker_id, 'hearing_min',       'Hearing',        'duration_min', 'mins', 70),
    (v_tracker_id, 'morning_class',     'Morning Class',  'boolean',      NULL,   80),
    (v_tracker_id, 'mangal_arti',       'Mangal Arti',    'boolean',      NULL,   90),
    (v_tracker_id, 'studies_min',       'Studies',        'duration_min', 'mins', 100),
    (v_tracker_id, 'cleanliness_done',  'Cleanliness',    'boolean',      NULL,   110),
    (v_tracker_id, 'seva_hours',        'Seva',           'number',       'hrs',  120)
  ON CONFLICT (tracker_id, key) DO NOTHING;

  -- Group assignment + display/short-code config (safe to re-apply)
  UPDATE public.tracker_fields SET group_id = v_body_id, short_code = 'TB', show_input = TRUE,  show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'to_bed_time';
  UPDATE public.tracker_fields SET group_id = v_body_id, short_code = 'WU', show_input = TRUE,  show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'wake_up_time';
  UPDATE public.tracker_fields SET group_id = v_body_id, short_code = 'DR', show_input = TRUE,  show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'day_rest_min';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'JP_TIME',   show_input = TRUE,  show_marks = FALSE WHERE tracker_id = v_tracker_id AND key = 'japa_time';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'JP_ROUNDS', show_input = TRUE,  show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'japa_rounds';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'RD', show_input = FALSE, show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'reading_min';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'HR', show_input = FALSE, show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'hearing_min';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'MC', show_input = FALSE, show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'morning_class';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'MA', show_input = FALSE, show_marks = TRUE  WHERE tracker_id = v_tracker_id AND key = 'mangal_arti';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'STUDIES',     show_input = FALSE, show_marks = TRUE WHERE tracker_id = v_tracker_id AND key = 'studies_min';
  UPDATE public.tracker_fields SET group_id = v_soul_id, short_code = 'CLEANLINESS', show_input = FALSE, show_marks = TRUE WHERE tracker_id = v_tracker_id AND key = 'cleanliness_done';
  UPDATE public.tracker_fields SET short_code = 'SEVA' WHERE tracker_id = v_tracker_id AND key = 'seva_hours';

  -- -------------------------------------------------------------------
  -- Scoring rules — rescaled to the reference sheet's max marks.
  -- Japa's marks now come from rounds only (japa_time is informational,
  -- its old "Japa Timing" rule is removed so it doesn't double-count).
  -- -------------------------------------------------------------------
  DELETE FROM public.tracker_scoring_rules
  WHERE tracker_id = v_tracker_id AND field_key = 'japa_time' AND label = 'Japa Timing';

  UPDATE public.tracker_scoring_rules SET max_points = 175, config = '{"min":0,"full_score_at":16,"allow_partial":true}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'japa_rounds' AND label = 'Japa Rounds';
  UPDATE public.tracker_scoring_rules SET max_points = 175, config = '{"tiers":[{"by":"04:30","pts":175},{"by":"05:00","pts":122.5},{"by":"06:00","pts":70},{"by":"23:59","pts":0}]}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'wake_up_time' AND label = 'Wake-up';
  UPDATE public.tracker_scoring_rules SET max_points = 175, config = '{"tiers":[{"by":"22:00","pts":175},{"by":"23:00","pts":105},{"by":"23:59","pts":0}]}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'to_bed_time' AND label = 'Bed Time';
  UPDATE public.tracker_scoring_rules SET max_points = 175, config = '{"per_unit":8.75,"unit":15}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'day_rest_min' AND label = 'Day Rest Penalty';
  UPDATE public.tracker_scoring_rules SET max_points = 75, config = '{"min":0,"full_score_at":45,"allow_partial":true}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'reading_min' AND label = 'Reading';
  UPDATE public.tracker_scoring_rules SET max_points = 30, config = '{"min":0,"full_score_at":45,"allow_partial":true}'::jsonb
    WHERE tracker_id = v_tracker_id AND field_key = 'hearing_min' AND label = 'Hearing';
  UPDATE public.tracker_scoring_rules SET max_points = 35 WHERE tracker_id = v_tracker_id AND field_key = 'mangal_arti' AND label = 'Mangal Arti';
  UPDATE public.tracker_scoring_rules SET max_points = 35 WHERE tracker_id = v_tracker_id AND field_key = 'morning_class' AND label = 'Morning Class';
  -- Seva is kept informational (no marks) to match the reference sheet, which
  -- doesn't budget it into Body/Soul/Total — an admin can add a rule for it
  -- later via Settings if they want it scored.
  DELETE FROM public.tracker_scoring_rules
  WHERE tracker_id = v_tracker_id AND field_key = 'seva_hours' AND label = 'Seva';

  INSERT INTO public.tracker_scoring_rules (tracker_id, field_key, rule_type, label, max_points, config, sort_order)
  SELECT r.tracker_id, r.field_key, r.rule_type, r.label, r.max_points, r.config, r.sort_order
  FROM (VALUES
    (v_tracker_id::uuid, 'studies_min', 'range', 'Studies', 70::numeric,
     '{"min":0,"full_score_at":45,"allow_partial":true}'::jsonb, 105),
    (v_tracker_id, 'cleanliness_done', 'boolean', 'Cleanliness', 35::numeric, '{}'::jsonb, 115)
  ) AS r(tracker_id, field_key, rule_type, label, max_points, config, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tracker_scoring_rules sr
    WHERE sr.tracker_id = r.tracker_id AND sr.field_key = r.field_key AND sr.label = r.label
  );

  -- -------------------------------------------------------------------
  -- Calculated columns — Body / Soul / Total
  -- -------------------------------------------------------------------
  INSERT INTO public.tracker_calculated_columns (tracker_id, key, label, inputs, is_highlighted, sort_order)
  VALUES
    (v_tracker_id, 'body',  'Body',  jsonb_build_array(jsonb_build_object('type', 'group', 'ref', 'body')), FALSE, 10),
    (v_tracker_id, 'soul',  'Soul',  jsonb_build_array(jsonb_build_object('type', 'group', 'ref', 'pathan_shravan')), FALSE, 20),
    (v_tracker_id, 'total', 'Total', jsonb_build_array(jsonb_build_object('type', 'column', 'ref', 'body'), jsonb_build_object('type', 'column', 'ref', 'soul')), TRUE, 30)
  ON CONFLICT (tracker_id, key) DO NOTHING;

  -- -------------------------------------------------------------------
  -- Default WhatsApp report template
  -- -------------------------------------------------------------------
  INSERT INTO public.tracker_whatsapp_templates (tracker_id, user_id, name, body, is_default)
  VALUES (
    v_tracker_id, NULL, 'Default',
    E'Hare Krishna Prabhuji,\n\ndate : {DATE}\n\nTB: {TB}\nWU: {WU}\nDR: {DR}\nJP: {JP_TIME} ({JP_ROUNDS})\nRD: {RD}\nHR: {HR}\nMA: {MA}\nMC: {MC}\nSeva: {SEVA}\n\nys\n{DEVOTEE_NAME}',
    TRUE
  )
  ON CONFLICT (tracker_id, user_id, name) DO NOTHING;

  RETURN v_tracker_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.seed_sadhana_tracker(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- Re-run for every org that already has a Sadhana tracker, so the
-- upgrade lands for Surabhikunj (and anyone else already seeded) too —
-- not just new orgs going forward.
-- ---------------------------------------------------------------------
DO $do$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT DISTINCT org_id FROM public.tracker_definitions WHERE name = 'Sadhana'
  LOOP
    PERFORM public.seed_sadhana_tracker(o.org_id);
  END LOOP;
END $do$;


-- FILE: 51_counsellor_management.sql
-- =====================================================================
-- 51. COUNSELLOR MANAGEMENT
-- =====================================================================
-- Builds the full Counsellor <-> Counselli supervision system on TOP of
-- the existing generic primitives — no duplicate schema, no duplicate
-- calculation engines:
--
--   mentorship_types / mentorship_relationships (28_mentorship.sql)
--     -> already the CounsellorAssignment model (typed, versioned,
--        exclusive-by-default, assigned_by, started_at/ended_at).
--   RBAC roles/permissions (22_rbac.sql)
--     -> already has mentorship.view_own / view_all / manage.
--   tracker_entries + trackerScoring.js (25/49/50, src/lib/trackerScoring.js)
--     -> the single source of truth for Sadhana. Not touched here.
--   task_assignments / task_logs (26/41)
--     -> the single source of truth for Cleanliness + Seva/Service.
--
-- What this migration ADDS:
--   1. public.is_active_mentor_of(mentee_id) — the one helper that all
--      "counsellor can see this member's data" RLS checks call. This is
--      the backend enforcement the spec requires (never a frontend-only
--      filter).
--   2. RLS extensions on tracker_entries / tracker_field_values /
--      task_assignments / task_logs so an active counsellor of a member
--      can SELECT (never write) that member's existing reports.
--   3. mentorship_notes, mentorship_followups — private counsellor notes
--      and follow-up action items (view only, cannot touch scores).
--   4. mentorship_audit_log — assignment/transfer/role audit trail.
--   5. Admin RPCs: ensure_counsellor_role, add_member_role,
--      remove_member_role, admin_mentorship_overview, assign_mentee,
--      end_mentorship, mentee_assignment_history, admin_mentee_search.
--   6. Notification categories + trigger for assignment/transfer.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CORE AUTHORIZATION HELPER
-- ---------------------------------------------------------------------
-- The single choke point every "counsellor view" RLS policy calls.
-- A counsellor may see a member's data ONLY while an ACTIVE mentorship
-- relationship exists between them in the caller's current org.

CREATE OR REPLACE FUNCTION public.is_active_mentor_of(p_mentee_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mentorship_relationships mr
    WHERE mr.mentor_id = auth.uid()
      AND mr.mentee_id = p_mentee_id
      AND mr.status    = 'active'
      AND mr.org_id     = public.current_org_id()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_mentor_of(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. RLS EXTENSIONS — counsellor read access to existing reports
-- ---------------------------------------------------------------------
-- Sadhana (tracker_entries / tracker_field_values). View-only: the write
-- policies are untouched, so a counsellor can never edit/delete a
-- counselli's entries.

DROP POLICY IF EXISTS "tracker_entries_select" ON public.tracker_entries;
CREATE POLICY "tracker_entries_select" ON public.tracker_entries
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('trackers.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

DROP POLICY IF EXISTS "tracker_fv_select" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_select" ON public.tracker_field_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (
          te.user_id = auth.uid()
          OR public.has_permission('trackers.view_all')
          OR public.is_active_mentor_of(te.user_id)
        )
    )
  );

-- Cleanliness + Seva/Service (task_assignments / task_logs).
DROP POLICY IF EXISTS "task_assignments_select" ON public.task_assignments;
CREATE POLICY "task_assignments_select" ON public.task_assignments
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('tasks.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

DROP POLICY IF EXISTS "task_logs_select" ON public.task_logs;
CREATE POLICY "task_logs_select" ON public.task_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('tasks.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

-- Extend the existing my_assignments() RPC with an explicit 'mentee' scope
-- so the Counselli Profile screen can request one specific member's
-- Cleanliness/Seva history without needing tasks.view_all.
CREATE OR REPLACE FUNCTION public.my_assignments(
  p_module  TEXT DEFAULT 'service',
  p_scope   TEXT DEFAULT 'mine',      -- 'mine' | 'all' | 'mentee'
  p_user_id UUID DEFAULT NULL         -- required when p_scope = 'mentee'
)
RETURNS TABLE (
  id            UUID,
  module_key    TEXT,
  title         TEXT,
  instructions  TEXT,
  task_date     DATE,
  task_time     TIME,
  status        TEXT,
  priority      TEXT,
  requires_acceptance BOOLEAN,
  area_name     TEXT,
  user_id       UUID,
  assignee_name TEXT,
  assignee_avatar TEXT,
  coordinator_id   UUID,
  coordinator_name TEXT,
  coordinator_phone TEXT,
  verified_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  duration_min  INTEGER
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.module_key,
    COALESCE(a.title, t.name) AS title,
    COALESCE(a.instructions, t.instructions) AS instructions,
    a.task_date, a.task_time, a.status, a.priority, a.requires_acceptance,
    ar.name AS area_name,
    a.user_id,
    COALESCE(pu.display_name, pu.spiritual_name, pu.legal_name, pu.email) AS assignee_name,
    pu.avatar_url AS assignee_avatar,
    a.coordinator_id,
    COALESCE(pc.display_name, pc.spiritual_name, pc.legal_name) AS coordinator_name,
    pc.phone AS coordinator_phone,
    a.verified_at, a.completed_at, a.duration_min
  FROM public.task_assignments a
  LEFT JOIN public.task_templates t ON t.id = a.template_id
  LEFT JOIN public.task_areas ar     ON ar.id = a.area_id
  LEFT JOIN public.profiles pu       ON pu.id = a.user_id
  LEFT JOIN public.profiles pc       ON pc.id = a.coordinator_id
  WHERE a.org_id = public.current_org_id()
    AND a.module_key = p_module
    AND a.status <> 'cancelled'
    AND (
      (p_scope = 'mine'   AND a.user_id = auth.uid())
      OR (p_scope = 'all'    AND public.has_permission('tasks.view_all'))
      OR (p_scope = 'mentee' AND p_user_id IS NOT NULL AND a.user_id = p_user_id
          AND (public.has_permission('tasks.view_all') OR public.is_active_mentor_of(p_user_id)))
    )
  ORDER BY a.task_date DESC, a.task_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.my_assignments(TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. COUNSELLOR NOTES (private, view-only w.r.t. Sadhana data)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_notes_mentee
  ON public.mentorship_notes (mentee_id, created_at DESC);

ALTER TABLE public.mentorship_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_notes_select" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_select" ON public.mentorship_notes
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      public.is_active_mentor_of(mentee_id)
      OR public.has_permission('mentorship.manage')
      OR author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "mentorship_notes_insert" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_insert" ON public.mentorship_notes
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND author_id = auth.uid()
    AND (public.is_active_mentor_of(mentee_id) OR public.has_permission('mentorship.manage'))
  );

DROP POLICY IF EXISTS "mentorship_notes_update" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_update" ON public.mentorship_notes
  FOR UPDATE USING (author_id = auth.uid() OR public.has_permission('mentorship.manage'));

DROP POLICY IF EXISTS "mentorship_notes_delete" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_delete" ON public.mentorship_notes
  FOR DELETE USING (author_id = auth.uid() OR public.has_permission('mentorship.manage'));

DROP TRIGGER IF EXISTS trg_mentorship_notes_updated_at ON public.mentorship_notes;
CREATE TRIGGER trg_mentorship_notes_updated_at
  BEFORE UPDATE ON public.mentorship_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 4. FOLLOW-UP / ACTION ITEMS
-- ---------------------------------------------------------------------
-- Deliberately separate from tracker_entries — a counsellor can never
-- touch a Sadhana score through this table.

CREATE TABLE IF NOT EXISTS public.mentorship_followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mentorship_followups
  DROP CONSTRAINT IF EXISTS mentorship_followups_status_check;
ALTER TABLE public.mentorship_followups
  ADD CONSTRAINT mentorship_followups_status_check
  CHECK (status IN ('pending', 'completed'));

CREATE INDEX IF NOT EXISTS idx_mentorship_followups_mentee
  ON public.mentorship_followups (mentee_id, status, due_date);

ALTER TABLE public.mentorship_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_followups_select" ON public.mentorship_followups;
CREATE POLICY "mentorship_followups_select" ON public.mentorship_followups
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (public.is_active_mentor_of(mentee_id) OR public.has_permission('mentorship.manage') OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "mentorship_followups_write" ON public.mentorship_followups;
CREATE POLICY "mentorship_followups_write" ON public.mentorship_followups
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('mentorship.manage'))
  );

DROP TRIGGER IF EXISTS trg_mentorship_followups_updated_at ON public.mentorship_followups;
CREATE TRIGGER trg_mentorship_followups_updated_at
  BEFORE UPDATE ON public.mentorship_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 5. AUDIT LOG
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,          -- 'assigned' | 'transferred' | 'ended' | 'role_granted' | 'role_revoked'
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentee_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  relationship_id UUID REFERENCES public.mentorship_relationships(id) ON DELETE SET NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_audit_org
  ON public.mentorship_audit_log (org_id, created_at DESC);

ALTER TABLE public.mentorship_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_audit_select" ON public.mentorship_audit_log;
CREATE POLICY "mentorship_audit_select" ON public.mentorship_audit_log
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('mentorship.manage')
  );

-- No INSERT/UPDATE/DELETE policy: only written by SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------
-- 6. ROLE MANAGEMENT — additive grant/revoke (keeps other roles intact)
-- ---------------------------------------------------------------------
-- set_member_role() (32_fix_member_management.sql) REPLACES all of a
-- member's roles with one. That is wrong for "Member + Counsellor"
-- (a counsellor must keep their normal member role). These are the
-- additive equivalents.

CREATE OR REPLACE FUNCTION public.add_member_role(p_user_id UUID, p_role_id UUID)
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

  SELECT id INTO v_membership FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;
  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id = p_role_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'That role does not belong to this organization';
  END IF;

  INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
  VALUES (v_membership, p_role_id, auth.uid())
  ON CONFLICT (membership_id, role_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_member_role(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member_role(p_user_id UUID, p_role_id UUID)
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

  SELECT id INTO v_membership FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;
  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  DELETE FROM public.membership_roles
  WHERE membership_id = v_membership AND role_id = p_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_member_role(UUID, UUID) TO authenticated;

-- Idempotently ensures the current org has a "Counsellor" role granting
-- mentorship.view_own (the permission that unlocks the Counsellor
-- Dashboard). Safe to call repeatedly; returns the role id.
CREATE OR REPLACE FUNCTION public.ensure_counsellor_role()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID := public.current_org_id();
  v_role_id UUID;
BEGIN
  IF NOT public.has_permission('roles.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage roles';
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE org_id = v_org_id AND key = 'counsellor';

  IF v_role_id IS NULL THEN
    INSERT INTO public.roles (org_id, key, name, description, color, priority)
    VALUES (v_org_id, 'counsellor', 'Counsellor', 'Can view and support assigned counsellis', '#0891b2', 5)
    RETURNING id INTO v_role_id;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_role_id, 'mentorship.view_own')
  ON CONFLICT DO NOTHING;

  RETURN v_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_counsellor_role() TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ADMIN RPCs — assignment management
-- ---------------------------------------------------------------------

-- Every counsellor (any mentor with >=1 active relationship OR the
-- 'counsellor' role) with their counselli counts, for the management table.
CREATE OR REPLACE FUNCTION public.admin_mentorship_overview(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentor_id       UUID,
  mentor_name     TEXT,
  mentor_avatar   TEXT,
  mentor_phone    TEXT,
  is_active       BOOLEAN,
  active_mentees  BIGINT,
  assigned_since  TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    p.id, COALESCE(p.display_name, p.spiritual_name, p.legal_name), p.avatar_url, p.phone,
    p.is_active,
    COUNT(mr.id) FILTER (WHERE mr.status = 'active'),
    MIN(mr.started_at)
  FROM public.mentorship_relationships mr
  JOIN public.profiles p ON p.id = mr.mentor_id
  WHERE mr.org_id = public.current_org_id()
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
    AND public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
  GROUP BY p.id, p.display_name, p.spiritual_name, p.legal_name, p.avatar_url, p.phone, p.is_active
  ORDER BY COALESCE(p.display_name, p.spiritual_name, p.legal_name);
$$;

GRANT EXECUTE ON FUNCTION public.admin_mentorship_overview(UUID) TO authenticated;

-- All relationships for one mentor (current + ended), for "Manage Counsellis".
CREATE OR REPLACE FUNCTION public.mentor_relationships(p_mentor_id UUID, p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  mentee_id    UUID,
  mentee_name  TEXT,
  mentee_avatar TEXT,
  status       TEXT,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  notes        TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.id, mr.mentee_id,
         COALESCE(p.display_name, p.spiritual_name, p.legal_name), p.avatar_url,
         mr.status, mr.started_at, mr.ended_at, mr.notes
  FROM public.mentorship_relationships mr
  JOIN public.profiles p ON p.id = mr.mentee_id
  WHERE mr.org_id = public.current_org_id()
    AND mr.mentor_id = p_mentor_id
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
    AND (p_mentor_id = auth.uid() OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage']))
  ORDER BY (mr.status = 'active') DESC, mr.started_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.mentor_relationships(UUID, UUID) TO authenticated;

-- Member search for the "assign counselli" picker — reuses org_members(),
-- adds each candidate's current mentor (if any) so the UI can warn before
-- creating a conflicting assignment.
CREATE OR REPLACE FUNCTION public.admin_mentee_search(p_query TEXT DEFAULT '', p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  id                UUID,
  display_name      TEXT,
  avatar_url        TEXT,
  email             TEXT,
  current_mentor_id UUID,
  current_mentor_name TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_type_id UUID := p_type_id;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  IF v_type_id IS NULL THEN
    SELECT mt.id INTO v_type_id FROM public.mentorship_types mt
    WHERE mt.org_id = public.current_org_id() AND mt.name = 'Counsellor' LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT om.id, om.display_name, om.avatar_url, om.email,
         mr.mentor_id, COALESCE(pm.display_name, pm.spiritual_name, pm.legal_name)
  FROM public.org_members() om
  LEFT JOIN public.mentorship_relationships mr
    ON mr.mentee_id = om.id AND mr.type_id = v_type_id AND mr.status = 'active'
  LEFT JOIN public.profiles pm ON pm.id = mr.mentor_id
  WHERE p_query = '' OR om.display_name ILIKE '%' || p_query || '%'
     OR om.spiritual_name ILIKE '%' || p_query || '%'
     OR om.legal_name ILIKE '%' || p_query || '%'
     OR om.email ILIKE '%' || p_query || '%'
  ORDER BY om.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mentee_search(TEXT, UUID) TO authenticated;

-- Assign (or transfer) a counselli to a counsellor. If the mentee already
-- has an active relationship of the same type, it is ended (preserving
-- history) and the new one created — a "transfer", never a silent
-- duplicate. Enforces mentorship_types.max_mentees.
CREATE OR REPLACE FUNCTION public.assign_mentee(
  p_mentee_id UUID,
  p_mentor_id UUID,
  p_type_id   UUID DEFAULT NULL,
  p_notes     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_type_id    UUID := p_type_id;
  v_max        INTEGER;
  v_current    INTEGER;
  v_old        RECORD;
  v_new_id     UUID;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  IF p_mentee_id = p_mentor_id THEN
    RAISE EXCEPTION 'A member cannot be their own counsellor';
  END IF;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id FROM public.mentorship_types
    WHERE org_id = v_org_id AND name = 'Counsellor' LIMIT 1;
  END IF;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No mentorship type configured for this organization';
  END IF;

  SELECT max_mentees INTO v_max FROM public.mentorship_types WHERE id = v_type_id;
  IF v_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current FROM public.mentorship_relationships
    WHERE mentor_id = p_mentor_id AND type_id = v_type_id AND status = 'active';
    IF v_current >= v_max THEN
      RAISE EXCEPTION 'This counsellor already has the maximum number of counsellis (%)', v_max;
    END IF;
  END IF;

  -- End any existing active relationship of this type for the mentee (transfer)
  SELECT * INTO v_old FROM public.mentorship_relationships
  WHERE mentee_id = p_mentee_id AND type_id = v_type_id AND status = 'active';

  IF FOUND THEN
    IF v_old.mentor_id = p_mentor_id THEN
      -- Already assigned to this exact counsellor; nothing to do.
      RETURN v_old.id;
    END IF;
    UPDATE public.mentorship_relationships
    SET status = 'ended', ended_at = NOW(), updated_at = NOW()
    WHERE id = v_old.id;

    INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
    VALUES (v_org_id, 'transferred', auth.uid(), p_mentor_id, p_mentee_id, v_old.id,
            jsonb_build_object('from_mentor_id', v_old.mentor_id, 'to_mentor_id', p_mentor_id));
  END IF;

  INSERT INTO public.mentorship_relationships (org_id, type_id, mentor_id, mentee_id, assigned_by, notes)
  VALUES (v_org_id, v_type_id, p_mentor_id, p_mentee_id, auth.uid(), p_notes)
  RETURNING id INTO v_new_id;

  INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
  VALUES (v_org_id, 'assigned', auth.uid(), p_mentor_id, p_mentee_id, v_new_id, '{}'::jsonb);

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_mentee(UUID, UUID, UUID, TEXT) TO authenticated;

-- End a relationship (unassign) without creating a replacement.
CREATE OR REPLACE FUNCTION public.end_mentorship(p_relationship_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rel RECORD;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  SELECT * INTO v_rel FROM public.mentorship_relationships
  WHERE id = p_relationship_id AND org_id = public.current_org_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relationship not found';
  END IF;

  UPDATE public.mentorship_relationships
  SET status = 'ended', ended_at = NOW(), updated_at = NOW()
  WHERE id = p_relationship_id;

  INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
  VALUES (v_rel.org_id, 'ended', auth.uid(), v_rel.mentor_id, v_rel.mentee_id, v_rel.id, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_mentorship(UUID) TO authenticated;

-- Full assignment history for one mentee (current + all past counsellors).
CREATE OR REPLACE FUNCTION public.mentee_assignment_history(p_mentee_id UUID)
RETURNS TABLE (
  id          UUID,
  mentor_id   UUID,
  mentor_name TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  assigned_by_name TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.id, mr.mentor_id, COALESCE(pm.display_name, pm.spiritual_name, pm.legal_name),
         mr.status, mr.started_at, mr.ended_at,
         COALESCE(pa.display_name, pa.spiritual_name, pa.legal_name)
  FROM public.mentorship_relationships mr
  JOIN public.profiles pm ON pm.id = mr.mentor_id
  LEFT JOIN public.profiles pa ON pa.id = mr.assigned_by
  WHERE mr.org_id = public.current_org_id()
    AND mr.mentee_id = p_mentee_id
    AND (
      mr.mentee_id = auth.uid()
      OR public.is_active_mentor_of(p_mentee_id)
      OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
    )
  ORDER BY mr.started_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.mentee_assignment_history(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. NOTIFICATIONS
-- ---------------------------------------------------------------------

INSERT INTO public.notification_categories
  (key, label, description, icon, group_key, user_can_disable, default_push, default_inapp, default_whatsapp, sort_order)
VALUES
  ('mentorship.assigned', 'Counsellor Assigned', 'You have been assigned a counsellor, or a new counselli', 'Users', 'mentorship', TRUE, TRUE, TRUE, FALSE, 130)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, icon = EXCLUDED.icon,
      group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.mentorship_relationship_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    SELECT COALESCE(display_name, spiritual_name, legal_name) INTO v_mentor_name
    FROM public.profiles WHERE id = NEW.mentor_id;

    PERFORM public.notify(
      NEW.mentee_id, 'mentorship.assigned',
      'You have a new counsellor',
      COALESCE(v_mentor_name, 'Your counsellor') || ' is now supporting your sadhana.',
      NEW.id, '/mentorship', NEW.org_id
    );
    PERFORM public.notify(
      NEW.mentor_id, 'mentorship.assigned',
      'New counselli assigned',
      'A new member has been assigned to you.',
      NEW.id, '/mentorship', NEW.org_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mentorship_relationship_notify ON public.mentorship_relationships;
CREATE TRIGGER trg_mentorship_relationship_notify
  AFTER INSERT ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.mentorship_relationship_notify();

NOTIFY pgrst, 'reload schema';

