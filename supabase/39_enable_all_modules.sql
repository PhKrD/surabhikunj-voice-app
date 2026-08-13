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
