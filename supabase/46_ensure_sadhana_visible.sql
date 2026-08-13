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
