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
