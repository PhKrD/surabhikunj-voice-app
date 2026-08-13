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
