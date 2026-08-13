-- =====================================================================
-- 25. TRACKERS — Generic self-reporting primitive
-- =====================================================================
-- Replaces `sadhana_reports` / `sadhana_score_config` with a configurable
-- engine that any organization can use for any kind of tracked metric:
-- practice logs, attendance, habit tracking, volunteer hours, etc.
--
-- Sadhana is seeded as the first tracker for Surabhikunj. Its existing
-- rows are migrated into the generic tables. The old tables stay for
-- backwards compatibility until the frontend is fully cut over.
--
-- Architecture:
--   tracker_definitions  — org creates one per tracking program
--   tracker_fields       — the input fields for each tracker
--   tracker_entries      — a member's submission for one day
--   tracker_field_values — the actual values per field per entry
--   tracker_scoring_rules— how the org calculates a score from values
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TRACKER DEFINITIONS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tracker_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT DEFAULT 'BookOpen',
  color           TEXT DEFAULT '#f97316',

  -- Cadence: 'daily' | 'weekly' | 'monthly' | 'on_demand'
  cadence         TEXT NOT NULL DEFAULT 'daily',

  -- Who can submit: 'self' (each member submits own) | 'admin' (only managers)
  submission_mode TEXT NOT NULL DEFAULT 'self',

  -- Score 0-100 is computed if any scoring rules exist
  has_scoring     BOOLEAN NOT NULL DEFAULT TRUE,
  score_label     TEXT DEFAULT 'Score',

  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tracker_definitions
  DROP CONSTRAINT IF EXISTS tracker_definitions_cadence_check;
ALTER TABLE public.tracker_definitions
  ADD CONSTRAINT tracker_definitions_cadence_check
  CHECK (cadence IN ('daily', 'weekly', 'monthly', 'on_demand'));

ALTER TABLE public.tracker_definitions
  DROP CONSTRAINT IF EXISTS tracker_definitions_submission_mode_check;
ALTER TABLE public.tracker_definitions
  ADD CONSTRAINT tracker_definitions_submission_mode_check
  CHECK (submission_mode IN ('self', 'admin'));

CREATE INDEX IF NOT EXISTS idx_tracker_defs_org
  ON public.tracker_definitions (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. TRACKER FIELDS
-- ---------------------------------------------------------------------
-- Each field is one piece of data collected per entry. Type drives
-- the form widget and the scoring engine.

CREATE TABLE IF NOT EXISTS public.tracker_fields (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id       UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,          -- machine key used in scoring rules
  label            TEXT NOT NULL,
  field_type       TEXT NOT NULL DEFAULT 'number',
  unit             TEXT,                   -- 'rounds', 'minutes', 'hours', etc.
  help_text        TEXT,
  placeholder      TEXT,
  default_value    TEXT,
  is_required      BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order       INTEGER NOT NULL DEFAULT 0,

  -- Validation
  min_value        NUMERIC,
  max_value        NUMERIC,
  options          JSONB NOT NULL DEFAULT '[]'::jsonb, -- for select fields

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tracker_id, key)
);

ALTER TABLE public.tracker_fields
  DROP CONSTRAINT IF EXISTS tracker_fields_type_check;
ALTER TABLE public.tracker_fields
  ADD CONSTRAINT tracker_fields_type_check
  CHECK (field_type IN (
    'number', 'time', 'duration_min', 'boolean',
    'select', 'text', 'textarea'
  ));

CREATE INDEX IF NOT EXISTS idx_tracker_fields_tracker
  ON public.tracker_fields (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 3. SCORING RULES
-- ---------------------------------------------------------------------
-- Simple, declarative rules evaluated in order. Each rule contributes
-- up to `max_points` to the total. The engine sums them and normalises
-- to 100.
--
-- rule_type options:
--   'threshold' — value < threshold → points; supports tier config
--   'boolean'   — TRUE → points
--   'range'     — value in [min, max] → points (scaled linearly)
--   'penalty'   — subtract points (e.g. day rest)
--   'formula'   — arbitrary JS-safe expression (evaluated in frontend)

CREATE TABLE IF NOT EXISTS public.tracker_scoring_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id   UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  field_key    TEXT NOT NULL,
  rule_type    TEXT NOT NULL DEFAULT 'threshold',
  label        TEXT NOT NULL,
  max_points   NUMERIC(6,2) NOT NULL DEFAULT 10,

  -- Flexible config (schema depends on rule_type)
  -- threshold: { tiers: [{by: "07:00", pts: 10}, {by: "08:00", pts: 7}, ...] }
  -- range:     { min: 0, max: 45, full_score_at: 45 }
  -- boolean:   {} (true = max_points)
  -- penalty:   { per_unit: 0.5, unit: 15 }  (per 15 minutes above 0)
  -- formula:   { expr: "japa_rounds * 0.625" }
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracker_scoring_tracker
  ON public.tracker_scoring_rules (tracker_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. TRACKER ENTRIES
-- ---------------------------------------------------------------------
-- One row per (member, tracker, period). 'period_date' is the day being
-- reported for daily trackers; the week/month start for longer cadences.

CREATE TABLE IF NOT EXISTS public.tracker_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracker_id     UUID NOT NULL REFERENCES public.tracker_definitions(id) ON DELETE CASCADE,
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_date    DATE NOT NULL,

  -- Computed score (null until scoring engine runs)
  score          NUMERIC(5,2),
  score_detail   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- breakdown per rule

  notes          TEXT,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tracker_id, user_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_tracker_entries_user_date
  ON public.tracker_entries (user_id, tracker_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_tracker_entries_org_date
  ON public.tracker_entries (org_id, tracker_id, period_date DESC);

-- ---------------------------------------------------------------------
-- 5. FIELD VALUES
-- ---------------------------------------------------------------------
-- Stored separately so the schema adapts to any tracker without a migration.

CREATE TABLE IF NOT EXISTS public.tracker_field_values (
  entry_id   UUID NOT NULL REFERENCES public.tracker_entries(id) ON DELETE CASCADE,
  field_key  TEXT NOT NULL,
  value_text TEXT,        -- raw string; typed value is parsed per field_type
  PRIMARY KEY (entry_id, field_key)
);

-- ---------------------------------------------------------------------
-- 6. SEED SURABHIKUNJ SADHANA AS THE FIRST TRACKER
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_tracker_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.tracker_definitions
    (org_id, name, description, icon, color, cadence, submission_mode, has_scoring, score_label)
  VALUES
    (v_org_id, 'Sadhana', 'Daily spiritual practice report', 'BookOpen', '#f97316',
     'daily', 'self', TRUE, 'Sadhana Score')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_tracker_id;

  IF v_tracker_id IS NULL THEN
    SELECT id INTO v_tracker_id
    FROM public.tracker_definitions WHERE org_id = v_org_id AND name = 'Sadhana' LIMIT 1;
  END IF;

  -- Fields (match the legacy sadhana_reports columns)
  INSERT INTO public.tracker_fields (tracker_id, key, label, field_type, unit, sort_order)
  VALUES
    (v_tracker_id, 'wake_up_time',  'Wake-up Time',    'time',         NULL,      10),
    (v_tracker_id, 'to_bed_time',   'To Bed Time',     'time',         NULL,      20),
    (v_tracker_id, 'day_rest_min',  'Day Rest',        'duration_min', 'minutes', 30),
    (v_tracker_id, 'japa_time',     'Japa Completed',  'time',         NULL,      40),
    (v_tracker_id, 'japa_rounds',   'Japa Rounds',     'number',       'rounds',  50),
    (v_tracker_id, 'reading_min',   'Reading',         'duration_min', 'minutes', 60),
    (v_tracker_id, 'hearing_min',   'Hearing',         'duration_min', 'minutes', 70),
    (v_tracker_id, 'mangal_arti',   'Mangal Arti',     'boolean',      NULL,      80),
    (v_tracker_id, 'morning_class', 'Morning Class',   'boolean',      NULL,      90),
    (v_tracker_id, 'seva_hours',    'Seva',            'number',       'hours',   100)
  ON CONFLICT (tracker_id, key) DO NOTHING;

  -- Scoring rules (mirrors sadhana_score_config defaults)
  INSERT INTO public.tracker_scoring_rules
    (tracker_id, field_key, rule_type, label, max_points, config, sort_order)
  VALUES
    (v_tracker_id, 'japa_time', 'threshold', 'Japa Timing', 10,
     '{"tiers":[{"by":"07:00","pts":10},{"by":"08:00","pts":7},{"by":"09:00","pts":5},{"by":"23:59","pts":2}]}'::jsonb, 10),
    (v_tracker_id, 'japa_rounds', 'range', 'Japa Rounds', 10,
     '{"min":0,"max":16,"full_score_at":16}'::jsonb, 20),
    (v_tracker_id, 'wake_up_time', 'threshold', 'Wake-up', 10,
     '{"tiers":[{"by":"04:30","pts":10},{"by":"05:00","pts":7},{"by":"06:00","pts":4},{"by":"23:59","pts":0}]}'::jsonb, 30),
    (v_tracker_id, 'to_bed_time', 'threshold', 'Bed Time', 5,
     '{"tiers":[{"by":"22:00","pts":5},{"by":"23:00","pts":3},{"by":"23:59","pts":0}]}'::jsonb, 40),
    (v_tracker_id, 'day_rest_min', 'penalty', 'Day Rest Penalty', 0,
     '{"per_unit":0.5,"unit":15}'::jsonb, 50),
    (v_tracker_id, 'reading_min', 'range', 'Reading', 10,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 60),
    (v_tracker_id, 'hearing_min', 'range', 'Hearing', 10,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 70),
    (v_tracker_id, 'mangal_arti', 'boolean', 'Mangal Arti', 5, '{}'::jsonb, 80),
    (v_tracker_id, 'morning_class', 'boolean', 'Morning Class', 5, '{}'::jsonb, 90),
    (v_tracker_id, 'seva_hours', 'range', 'Seva', 10,
     '{"min":0,"max":4,"full_score_at":4}'::jsonb, 100)
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 7. MIGRATE existing sadhana_reports into tracker_entries
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_tracker_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_tracker_id
  FROM public.tracker_definitions WHERE org_id = v_org_id AND name = 'Sadhana' LIMIT 1;
  IF v_tracker_id IS NULL THEN RETURN; END IF;

  -- Entries
  INSERT INTO public.tracker_entries
    (tracker_id, org_id, user_id, period_date, score, score_detail, notes, submitted_at, updated_at)
  SELECT
    v_tracker_id,
    org_id,
    profile_id,
    report_date,
    score,
    jsonb_build_object(
      'japa',       score_japa,
      'sleep',      score_sleep,
      'reading',    score_reading,
      'hearing',    score_hearing,
      'seva',       score_seva,
      'attendance', score_attendance
    ),
    notes,
    submitted_at,
    updated_at
  FROM public.sadhana_reports
  ON CONFLICT (tracker_id, user_id, period_date) DO NOTHING;

  -- Field values
  INSERT INTO public.tracker_field_values (entry_id, field_key, value_text)
  SELECT e.id, v.field_key, v.value_text
  FROM public.tracker_entries e
  JOIN public.sadhana_reports r
    ON r.profile_id = e.user_id AND r.report_date = e.period_date AND r.org_id = e.org_id
  CROSS JOIN LATERAL (VALUES
    ('wake_up_time',  r.wake_up_time::text),
    ('to_bed_time',   r.to_bed_time::text),
    ('day_rest_min',  r.day_rest_min::text),
    ('japa_time',     r.japa_time::text),
    ('japa_rounds',   r.japa_rounds::text),
    ('reading_min',   r.reading_min::text),
    ('hearing_min',   r.hearing_min::text),
    ('mangal_arti',   r.mangal_arti::text),
    ('morning_class', r.morning_class::text),
    ('seva_hours',    r.seva_hours::text)
  ) AS v(field_key, value_text)
  WHERE e.tracker_id = v_tracker_id
    AND v.value_text IS NOT NULL
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 8. HELPERS
-- ---------------------------------------------------------------------

-- Latest N entries for a user in a tracker
CREATE OR REPLACE FUNCTION public.my_tracker_entries(
  p_tracker_id UUID,
  p_limit      INTEGER DEFAULT 90
)
RETURNS TABLE (
  id          UUID,
  period_date DATE,
  score       NUMERIC,
  score_detail JSONB,
  notes       TEXT,
  submitted_at TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT te.id, te.period_date, te.score, te.score_detail, te.notes, te.submitted_at
  FROM public.tracker_entries te
  WHERE te.tracker_id = p_tracker_id
    AND te.user_id    = auth.uid()
    AND te.org_id     = public.current_org_id()
  ORDER BY te.period_date DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.my_tracker_entries(UUID, INTEGER) TO authenticated;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.tracker_definitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_fields         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_scoring_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_entries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_field_values   ENABLE ROW LEVEL SECURITY;

-- Definitions: visible to any org member who can view trackers
DROP POLICY IF EXISTS "tracker_defs_select" ON public.tracker_definitions;
CREATE POLICY "tracker_defs_select" ON public.tracker_definitions
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own'])
  );

DROP POLICY IF EXISTS "tracker_defs_write" ON public.tracker_definitions;
CREATE POLICY "tracker_defs_write" ON public.tracker_definitions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('trackers.manage')
  );

-- Fields and scoring rules: same as definition
DROP POLICY IF EXISTS "tracker_fields_select" ON public.tracker_fields;
CREATE POLICY "tracker_fields_select" ON public.tracker_fields
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id()
              AND public.has_any_permission(ARRAY['trackers.submit','trackers.view_own']))
  );

DROP POLICY IF EXISTS "tracker_fields_write" ON public.tracker_fields;
CREATE POLICY "tracker_fields_write" ON public.tracker_fields
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "tracker_scoring_select" ON public.tracker_scoring_rules;
CREATE POLICY "tracker_scoring_select" ON public.tracker_scoring_rules
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tracker_definitions td
            WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "tracker_scoring_write" ON public.tracker_scoring_rules;
CREATE POLICY "tracker_scoring_write" ON public.tracker_scoring_rules
  FOR ALL USING (
    public.has_permission('trackers.manage')
    AND EXISTS (SELECT 1 FROM public.tracker_definitions td
                WHERE td.id = tracker_id AND td.org_id = public.current_org_id())
  );

-- Entries: own visible to self; all visible to trackers.view_all
DROP POLICY IF EXISTS "tracker_entries_select" ON public.tracker_entries;
CREATE POLICY "tracker_entries_select" ON public.tracker_entries
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.view_all'))
  );

DROP POLICY IF EXISTS "tracker_entries_insert" ON public.tracker_entries;
CREATE POLICY "tracker_entries_insert" ON public.tracker_entries
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      (user_id = auth.uid() AND public.has_permission('trackers.submit'))
      OR public.has_permission('trackers.manage')
    )
  );

DROP POLICY IF EXISTS "tracker_entries_update" ON public.tracker_entries;
CREATE POLICY "tracker_entries_update" ON public.tracker_entries
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

DROP POLICY IF EXISTS "tracker_entries_delete" ON public.tracker_entries;
CREATE POLICY "tracker_entries_delete" ON public.tracker_entries
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

-- Field values: inherit from the entry's access rules
DROP POLICY IF EXISTS "tracker_fv_select" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_select" ON public.tracker_field_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (te.user_id = auth.uid() OR public.has_permission('trackers.view_all'))
    )
  );

DROP POLICY IF EXISTS "tracker_fv_write" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_write" ON public.tracker_field_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (te.user_id = auth.uid() OR public.has_permission('trackers.manage'))
    )
  );

-- ---------------------------------------------------------------------
-- 10. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_tracker_defs_updated_at ON public.tracker_definitions;
CREATE TRIGGER trg_tracker_defs_updated_at
  BEFORE UPDATE ON public.tracker_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_tracker_entries_updated_at ON public.tracker_entries;
CREATE TRIGGER trg_tracker_entries_updated_at
  BEFORE UPDATE ON public.tracker_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
