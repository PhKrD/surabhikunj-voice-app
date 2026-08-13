-- CHUNK 10 (seed data, optional)

-- SEED FILE: 03_seed_demo.sql
-- Demo seed for local/dev usage
-- Run after: 01_schema.sql, 02_bootstrap.sql

-- Departments
insert into public.departments (voice_id, name, description, icon, color)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Kitchen', 'Daily prasadam planning and execution', 'UtensilsCrossed', '#f97316'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Sadhana', 'Sadhana standards and reporting support', 'BookOpen', '#d946ef'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Cleanliness', 'Community cleanliness and area maintenance', 'Sparkles', '#16a34a')
on conflict do nothing;

-- Services
insert into public.services (voice_id, name, description, default_time, duration_min, instructions)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Temple Hall Cleaning', 'Daily temple hall cleaning service', '06:30:00', 45, 'Bring broom and cloth. Complete before class.'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Breakfast Assistance', 'Cutting and serving support', '08:00:00', 60, 'Report in clean dress and head cover.'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Evening Aarti Setup', 'Prepare lamps and bhoga table', '18:00:00', 40, 'Coordinate with pujari team.')
on conflict do nothing;

-- Cleaning areas
insert into public.cleaning_areas (voice_id, name, description, floor)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Temple Hall', 'Main kirtan and class area', 'Ground Floor'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Staircase A', 'Main staircase near entrance', 'All Floors'),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Kitchen Wash Zone', 'Utensil wash and sink area', 'Ground Floor')
on conflict do nothing;

-- Events
insert into public.events (voice_id, title, description, event_type, start_datetime, end_datetime, venue, is_mandatory, notify_all)
values
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Sunday Feast Preparation Meeting',
    'Planning and service delegation for upcoming Sunday feast.',
    'meeting',
    now() + interval '2 day',
    now() + interval '2 day 1 hour',
    'Community Hall',
    false,
    true
  ),
  (
    'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    'Ekadashi Kirtan Evening',
    'Extended kirtan and shared reflections.',
    'festival',
    now() + interval '5 day',
    now() + interval '5 day 2 hour',
    'Temple Hall',
    true,
    true
  )
on conflict do nothing;

-- Today's prasadam menu (lights up the dashboard "Today's Prasadam" card)
insert into public.meal_plans (voice_id, plan_date, meal_type, menu_items, notes, is_special)
values
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', current_date, 'breakfast', array['Upma', 'Seasonal Fruit', 'Milk'], null, false),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', current_date, 'lunch', array['Rice', 'Dal', 'Sabji', 'Salad', 'Sweet'], 'Full prasadam', false),
  ('a1b2c3d4-e5f6-7890-abcd-ef1234567890', current_date, 'dinner', array['Khichdi', 'Roti', 'Subji'], null, false)
on conflict (voice_id, plan_date, meal_type) do nothing;

-- An event happening today (shows in "Upcoming Events")
insert into public.events (voice_id, title, description, event_type, start_datetime, end_datetime, venue, is_mandatory, notify_all)
select
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Evening Bhagavatam Class',
  'Daily Srimad-Bhagavatam class and kirtan.',
  'program',
  date_trunc('day', now()) + interval '19 hour',
  date_trunc('day', now()) + interval '20 hour',
  'Temple Hall',
  false,
  true
where not exists (
  select 1 from public.events
  where voice_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' and title = 'Evening Bhagavatam Class'
);

-- Announcements (created_by left null for seed; client inserts are RLS-restricted to leadership)
insert into public.announcements (voice_id, title, body, is_pinned)
select 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', v.title, v.body, v.pinned
from (values
  ('Mangala Arati timing update', 'Mangala arati begins at 4:45 AM starting this week. Please plan your sadhana accordingly.', true),
  ('Sunday Feast seva sign-up', 'Sign-up for Sunday Feast seva is now open. Please speak to your department incharge.', false)
) as v(title, body, pinned)
where not exists (
  select 1 from public.announcements a
  where a.voice_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' and a.title = v.title
);


-- SEED FILE: 09_seed_demo_personal.sql
-- Optional demo data: personal daily-loop content for EXISTING residents.
-- Prerequisites: run 01, 02, 04, 05, 07, 08 and 03_seed_demo.sql first, and have
-- one or more residents signed up (profiles must already exist). Safe to re-run.
--
-- For every profile in the default VOICE this creates:
--   * today's service allocation (first seeded service)
--   * a cleaning assignment + today's "done" log (first seeded area)
--   * the last 7 days of sadhana reports (varied scores for a nice trend/streak)

do $$
declare
  v_voice   uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_service uuid;
  v_area    uuid;
  r         record;
  d         int;
begin
  select id into v_service from public.services
    where voice_id = v_voice order by created_at limit 1;
  select id into v_area from public.cleaning_areas
    where voice_id = v_voice order by created_at limit 1;

  for r in select id from public.profiles where voice_id = v_voice loop
    -- Today's service allocation (no unique constraint -> guard with NOT EXISTS)
    if v_service is not null and not exists (
      select 1 from public.service_allocations
      where profile_id = r.id and service_id = v_service and service_date = current_date
    ) then
      insert into public.service_allocations
        (voice_id, service_id, profile_id, service_date, service_time, status)
      values (v_voice, v_service, r.id, current_date, '06:30:00', 'pending');
    end if;

    -- Cleaning assignment + today's log
    if v_area is not null then
      insert into public.cleaning_assignments (area_id, profile_id, assigned_from)
      values (v_area, r.id, current_date)
      on conflict (area_id, profile_id) do nothing;

      insert into public.cleaning_logs (voice_id, area_id, profile_id, log_date, status)
      values (v_voice, v_area, r.id, current_date, 'done')
      on conflict (area_id, profile_id, log_date) do nothing;
    end if;

    -- Last 7 days of sadhana reports
    for d in 0..6 loop
      insert into public.sadhana_reports (
        voice_id, profile_id, report_date,
        to_bed_time, wake_up_time, day_rest_min, japa_time, japa_rounds,
        reading_min, hearing_min, mangal_arti, morning_class, seva_hours,
        score, score_japa, score_sleep, score_reading, score_hearing, score_seva, score_attendance
      )
      values (
        v_voice, r.id, current_date - d,
        '22:00:00', '04:45:00', 0, '07:30:00', 16,
        45, 30, true, true, 2.0,
        70 + ((d * 7) % 25), 22 + (d % 6), 18, 10 + (d % 5), 9, 6, 10
      )
      on conflict (profile_id, report_date) do nothing;
    end loop;
  end loop;
end $$;


-- SEED FILE: 37_seed_sadhana_tracker.sql
-- =====================================================================
-- 37. SEED SADHANA TRACKER FOR EVERY ORGANIZATION
-- =====================================================================
-- Migration 25 introduced the generic tracker engine but only seeded the
-- 'Sadhana' tracker for the single org whose name ILIKE '%surabhikunj%'.
-- Every organization created since then starts with zero tracker
-- definitions, so the Trackers/Sadhana screen renders an empty, unusable
-- shell for them.
--
-- This migration:
--   1. Extracts the Sadhana seed into a reusable, idempotent function
--      public.seed_sadhana_tracker(p_org_id).
--   2. Backfills it for every existing organization.
--   3. Enables the 'trackers' module for every org so it shows up in
--      navigation (without touching any custom label_override).
--   4. Adds the seed call to public.create_organization() so future orgs
--      get Sadhana automatically.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. REUSABLE SEED FUNCTION
-- ---------------------------------------------------------------------
-- Reuses an existing 'Sadhana' tracker for the org if one is already
-- there, so re-running never creates a duplicate definition. Fields are
-- guarded by the UNIQUE (tracker_id, key) constraint; scoring rules have
-- no natural key, so they are guarded by a NOT EXISTS check on
-- (tracker_id, field_key, label).

CREATE OR REPLACE FUNCTION public.seed_sadhana_tracker(p_org_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tracker_id UUID;
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
  SELECT r.tracker_id, r.field_key, r.rule_type, r.label, r.max_points, r.config, r.sort_order
  FROM (VALUES
    (v_tracker_id::uuid, 'japa_time', 'threshold', 'Japa Timing', 10::numeric,
     '{"tiers":[{"by":"07:00","pts":10},{"by":"08:00","pts":7},{"by":"09:00","pts":5},{"by":"23:59","pts":2}]}'::jsonb, 10),
    (v_tracker_id, 'japa_rounds', 'range', 'Japa Rounds', 10::numeric,
     '{"min":0,"max":16,"full_score_at":16}'::jsonb, 20),
    (v_tracker_id, 'wake_up_time', 'threshold', 'Wake-up', 10::numeric,
     '{"tiers":[{"by":"04:30","pts":10},{"by":"05:00","pts":7},{"by":"06:00","pts":4},{"by":"23:59","pts":0}]}'::jsonb, 30),
    (v_tracker_id, 'to_bed_time', 'threshold', 'Bed Time', 5::numeric,
     '{"tiers":[{"by":"22:00","pts":5},{"by":"23:00","pts":3},{"by":"23:59","pts":0}]}'::jsonb, 40),
    (v_tracker_id, 'day_rest_min', 'penalty', 'Day Rest Penalty', 0::numeric,
     '{"per_unit":0.5,"unit":15}'::jsonb, 50),
    (v_tracker_id, 'reading_min', 'range', 'Reading', 10::numeric,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 60),
    (v_tracker_id, 'hearing_min', 'range', 'Hearing', 10::numeric,
     '{"min":0,"max":45,"full_score_at":45}'::jsonb, 70),
    (v_tracker_id, 'mangal_arti', 'boolean', 'Mangal Arti', 5::numeric, '{}'::jsonb, 80),
    (v_tracker_id, 'morning_class', 'boolean', 'Morning Class', 5::numeric, '{}'::jsonb, 90),
    (v_tracker_id, 'seva_hours', 'range', 'Seva', 10::numeric,
     '{"min":0,"max":4,"full_score_at":4}'::jsonb, 100)
  ) AS r(tracker_id, field_key, rule_type, label, max_points, config, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tracker_scoring_rules sr
    WHERE sr.tracker_id = r.tracker_id
      AND sr.field_key  = r.field_key
      AND sr.label      = r.label
  );

  RETURN v_tracker_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.seed_sadhana_tracker(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. BACKFILL EVERY EXISTING ORGANIZATION
-- ---------------------------------------------------------------------

DO $do$
DECLARE o RECORD;
BEGIN
  FOR o IN
    SELECT org.id
    FROM public.organizations org
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tracker_definitions td
      WHERE td.org_id = org.id AND td.name = 'Sadhana'
    )
  LOOP
    PERFORM public.seed_sadhana_tracker(o.id);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- 3. MAKE SURE THE 'trackers' MODULE IS ON FOR EVERY ORG
-- ---------------------------------------------------------------------
-- Same shape as seed_default_modules in migration 23. Existing
-- label_override / icon_override values are left untouched.

INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key = 'trackers'
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled    = TRUE,
    updated_at = NOW()
WHERE module_key = 'trackers'
  AND enabled IS DISTINCT FROM TRUE;

-- ---------------------------------------------------------------------
-- 4. SEED SADHANA FOR FUTURE ORGANIZATIONS
-- ---------------------------------------------------------------------
-- Identical to migration 30's definition, plus one PERFORM after the
-- existing seed calls.

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_locale   TEXT DEFAULT 'en-IN'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $fn$
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
  PERFORM public.seed_sadhana_tracker(v_org_id);

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
$fn$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

