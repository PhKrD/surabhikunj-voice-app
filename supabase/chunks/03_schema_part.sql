-- CHUNK 3 (schema files)

-- FILE: 15_update_japa_scoring.sql
-- =====================================================================
-- 15. UPDATE JAPA SCORING TO BE TIME-BASED ONLY
-- =====================================================================
-- Changes Japa scoring from rounds-based to completion-time-based
-- Everyone gets scored based on when they complete their committed rounds
-- =====================================================================

-- Update the default config for japa_rounds to be inactive or change to time-based
UPDATE sadhana_default_configs
SET 
  rule_type = 'time_before',
  default_config = jsonb_build_object(
    'cutoffs', jsonb_build_array(
      jsonb_build_object('time', '06:00', 'points', 15),
      jsonb_build_object('time', '06:30', 'points', 13),
      jsonb_build_object('time', '07:00', 'points', 11),
      jsonb_build_object('time', '07:30', 'points', 9),
      jsonb_build_object('time', '08:00', 'points', 7),
      jsonb_build_object('time', '08:30', 'points', 5),
      jsonb_build_object('time', '09:00', 'points', 3),
      jsonb_build_object('time', '10:00', 'points', 1)
    )
  ),
  description = 'Japa completion time scoring (when all committed rounds are completed)'
WHERE parameter = 'japa_rounds';

-- Remove the separate japa_time config as we're merging it into japa_rounds
DELETE FROM sadhana_default_configs
WHERE parameter = 'japa_time';

-- Update existing scoring rules for all voices
UPDATE sadhana_scoring_rules
SET 
  rule_type = 'time_before',
  config = jsonb_build_object(
    'cutoffs', jsonb_build_array(
      jsonb_build_object('time', '06:00', 'points', 15),
      jsonb_build_object('time', '06:30', 'points', 13),
      jsonb_build_object('time', '07:00', 'points', 11),
      jsonb_build_object('time', '07:30', 'points', 9),
      jsonb_build_object('time', '08:00', 'points', 7),
      jsonb_build_object('time', '08:30', 'points', 5),
      jsonb_build_object('time', '09:00', 'points', 3),
      jsonb_build_object('time', '10:00', 'points', 1)
    )
  ),
  description = 'Japa completion time scoring (when all committed rounds are completed)',
  updated_at = NOW()
WHERE parameter = 'japa_rounds';

-- Delete the separate japa_time rules
DELETE FROM sadhana_scoring_rules
WHERE parameter = 'japa_time';

-- Add a comment explaining the change
COMMENT ON TABLE sadhana_scoring_rules IS 
'Stores configurable scoring rules for sadhana parameters. 
Japa is now scored based on completion time of committed rounds, not the number of rounds.';


-- FILE: 16_add_missing_score_columns.sql
-- =====================================================================
-- 16. ADD MISSING SCORE COLUMNS TO SADHANA_REPORTS
-- =====================================================================
-- Adds score_dr and other missing score columns that are being calculated
-- but not stored in the database
-- =====================================================================

-- Add missing score columns to sadhana_reports table
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS score_dr INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_studies INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_cleanliness INTEGER DEFAULT 0;

-- Update the comment to reflect new columns
COMMENT ON COLUMN sadhana_reports.score_dr IS 'Day rest penalty score (negative points)';
COMMENT ON COLUMN sadhana_reports.score_studies IS 'Studies duration score';
COMMENT ON COLUMN sadhana_reports.score_cleanliness IS 'Cleanliness task completion score';

-- Ensure all score columns have proper defaults
ALTER TABLE sadhana_reports
  ALTER COLUMN score_japa SET DEFAULT 0,
  ALTER COLUMN score_sleep SET DEFAULT 0,
  ALTER COLUMN score_reading SET DEFAULT 0,
  ALTER COLUMN score_hearing SET DEFAULT 0,
  ALTER COLUMN score_seva SET DEFAULT 0,
  ALTER COLUMN score_attendance SET DEFAULT 0,
  ALTER COLUMN score SET DEFAULT 0;


-- FILE: 17_member_approval.sql
-- =====================================================================
-- 17. MEMBER APPROVAL & ADMIN ROLE ASSIGNMENT
-- =====================================================================
-- New sign-ups are PENDING until an admin approves them and assigns a role.
-- Email is denormalised onto profiles so admins can find & manage members
-- by email from inside the app.
-- =====================================================================

-- 1. New columns ------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email       TEXT;

-- 2. Backfill email from auth.users -----------------------------------
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND (p.email IS DISTINCT FROM u.email);

-- 3. Keep CURRENT users working: approve everyone who already exists.
--    New sign-ups from now on start PENDING (see trigger in step 5).
--    >>> If instead you want EVERY existing devotee to be re-approved by an
--        admin, comment out this UPDATE and run:
--            UPDATE public.profiles SET is_approved = FALSE
--            WHERE role NOT IN ('admin','vmc','oc');
UPDATE public.profiles SET is_approved = TRUE WHERE is_approved = FALSE;

-- 3b. Admins / leaders are always approved
UPDATE public.profiles SET is_approved = TRUE
WHERE role IN ('admin', 'vmc', 'oc');

-- 4. Index for fast email lookups -------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (lower(email));

-- 5. Recreate signup trigger: capture email, start PENDING ------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, spiritual_name, role, email, is_approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'spiritual_name', 'New Devotee'),
    'devotee',
    NEW.email,
    FALSE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. SECURITY: users may update their own profile (settings), but must
--    NOT be able to change their own role or approval. RLS WITH CHECK
--    cannot see the OLD row, so we clamp those columns here for anyone
--    who is not an admin. Admins (admin/vmc/oc) are unaffected.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.role        := OLD.role;
    NEW.is_approved := OLD.is_approved;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_profile_columns();

-- 7. Ensure a user can ALWAYS read their own profile row (even before a
--    voice_id is assigned / while pending). Complements profiles_select.
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (id = auth.uid());


-- FILE: 18_fix_sadhana_scoring_columns.sql
-- =====================================================================
-- 18. FIX SADHANA SCORING COLUMNS
-- =====================================================================
-- The new config scoring system generates score_japa_rounds and score_japa_time
-- but the database only has score_japa. This migration adds the missing columns
-- and ensures all scoring columns exist.
-- =====================================================================

-- Add missing individual score columns that the new scoring system generates
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS score_japa_rounds NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_japa_time NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_tb NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_wu NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_ma NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_mc NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_dr NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_reading NUMERIC(5,2),  -- Ensure this exists
  ADD COLUMN IF NOT EXISTS score_hearing NUMERIC(5,2),  -- Ensure this exists
  ADD COLUMN IF NOT EXISTS score_studies NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_cleanliness NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_seva_hours NUMERIC(5,2),  -- seva_hours parameter generates this
  ADD COLUMN IF NOT EXISTS hearing_source_id UUID REFERENCES hearing_sources(id),
  ADD COLUMN IF NOT EXISTS reading_type_id UUID REFERENCES reading_types(id);

-- Add comments for clarity
COMMENT ON COLUMN sadhana_reports.score_japa_rounds IS 'Japa rounds completion score';
COMMENT ON COLUMN sadhana_reports.score_japa_time IS 'Japa time completion score';
COMMENT ON COLUMN sadhana_reports.score_tb IS 'To bed time score';
COMMENT ON COLUMN sadhana_reports.score_wu IS 'Wake up time score';
COMMENT ON COLUMN sadhana_reports.score_ma IS 'Mangal arti attendance score';
COMMENT ON COLUMN sadhana_reports.score_mc IS 'Morning class attendance score';
COMMENT ON COLUMN sadhana_reports.score_dr IS 'Day rest penalty (negative)';
COMMENT ON COLUMN sadhana_reports.score_studies IS 'Studies duration score';
COMMENT ON COLUMN sadhana_reports.score_cleanliness IS 'Cleanliness task score';
COMMENT ON COLUMN sadhana_reports.score_seva_hours IS 'Seva hours score';
COMMENT ON COLUMN sadhana_reports.hearing_source_id IS 'Selected hearing source';
COMMENT ON COLUMN sadhana_reports.reading_type_id IS 'Selected reading type';

-- Create or replace function to update weekly report when daily is saved
CREATE OR REPLACE FUNCTION update_weekly_report_on_daily_save()
RETURNS TRIGGER AS $$
DECLARE
  v_week_start DATE;
  v_day_key TEXT;
BEGIN
  -- Calculate the Monday of the week for this report
  v_week_start := date_trunc('week', NEW.report_date)::date;
  
  -- Get the day key (sun, mon, tue, etc.)
  v_day_key := CASE EXTRACT(DOW FROM NEW.report_date)
    WHEN 0 THEN 'sun'
    WHEN 1 THEN 'mon'
    WHEN 2 THEN 'tue'
    WHEN 3 THEN 'wed'
    WHEN 4 THEN 'thu'
    WHEN 5 THEN 'fri'
    WHEN 6 THEN 'sat'
  END;
  
  -- Insert or update the weekly report with this day's data
  INSERT INTO sadhana_weekly_reports (
    voice_id,
    profile_id,
    week_start,
    daily_data,
    updated_at
  )
  VALUES (
    NEW.voice_id,
    NEW.profile_id,
    v_week_start,
    jsonb_build_object(
      v_day_key, jsonb_build_object(
        'to_bed_time', NEW.to_bed_time,
        'wake_up_time', NEW.wake_up_time,
        'day_rest_min', NEW.day_rest_min,
        'japa_time', NEW.japa_time,
        'japa_rounds', NEW.japa_rounds,
        'reading_min', NEW.reading_min,
        'hearing_min', NEW.hearing_min,
        'mangal_arti', NEW.mangal_arti,
        'morning_class', NEW.morning_class,
        'studies_min', NEW.studies_min,
        'cleanliness_done', NEW.cleanliness_done
      )
    ),
    NOW()
  )
  ON CONFLICT (profile_id, week_start)
  DO UPDATE SET
    daily_data = COALESCE(sadhana_weekly_reports.daily_data, '{}'::jsonb) || 
                 jsonb_build_object(
                   v_day_key, jsonb_build_object(
                     'to_bed_time', NEW.to_bed_time,
                     'wake_up_time', NEW.wake_up_time,
                     'day_rest_min', NEW.day_rest_min,
                     'japa_time', NEW.japa_time,
                     'japa_rounds', NEW.japa_rounds,
                     'reading_min', NEW.reading_min,
                     'hearing_min', NEW.hearing_min,
                     'mangal_arti', NEW.mangal_arti,
                     'morning_class', NEW.morning_class,
                     'studies_min', NEW.studies_min,
                     'cleanliness_done', NEW.cleanliness_done
                   )
                 ),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update weekly report on daily save
DROP TRIGGER IF EXISTS trg_update_weekly_on_daily ON sadhana_reports;
CREATE TRIGGER trg_update_weekly_on_daily
  AFTER INSERT OR UPDATE ON sadhana_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_weekly_report_on_daily_save();

-- Ensure weekly reports table has all needed columns
ALTER TABLE sadhana_weekly_reports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add index for faster weekly report lookups
CREATE INDEX IF NOT EXISTS idx_sadhana_reports_profile_date 
  ON sadhana_reports(profile_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_sadhana_weekly_profile_week 
  ON sadhana_weekly_reports(profile_id, week_start DESC);


-- FILE: 19_push_notifications.sql
-- =====================================================================
-- 19. PUSH NOTIFICATIONS (Web Push + Android FCM)
-- =====================================================================
-- Adds token storage for both delivery channels and an INSERT trigger on
-- `notifications` that fires the `send-push` Edge Function via pg_net, so
-- EVERY notification (announcement, seva, cleanliness, event, weekly report
-- reminder, etc.) automatically rings the user's device with a sound.
--
-- ONE-TIME SETUP (run once, replacing the placeholders):
--   1. enable pg_net (Supabase: Database > Extensions > "pg_net")
--   2. store the function URL + service role key so the trigger can call it:
--        insert into private.app_secrets (key, value) values
--          ('edge_base_url', 'https://<project-ref>.supabase.co/functions/v1'),
--          ('service_role_key', '<your service_role key>')
--        on conflict (key) do update set value = excluded.value;
-- =====================================================================

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Private secrets store (only reachable by SECURITY DEFINER funcs / service role)
-- ---------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.app_secrets (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- Web Push subscriptions (PWA / browser — iOS 16.4+ home-screen, Android, desktop)
-- ---------------------------------------------------------------------
create table if not exists push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz default now()
);
create index if not exists idx_push_subs_profile on push_subscriptions(profile_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subs_own ON push_subscriptions;
create policy push_subs_own on push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Native FCM device tokens (Android APK / iOS native if ever built)
-- ---------------------------------------------------------------------
create table if not exists device_tokens (
  id          uuid primary key default uuid_generate_v4(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  token       text not null unique,
  platform    text not null default 'android',  -- android | ios | web
  created_at  timestamptz default now()
);
create index if not exists idx_device_tokens_profile on device_tokens(profile_id);

alter table device_tokens enable row level security;

drop policy if exists device_tokens_own ON device_tokens;
create policy device_tokens_own on device_tokens
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ---------------------------------------------------------------------
-- Trigger: on new notification, call the send-push Edge Function
-- ---------------------------------------------------------------------
create or replace function public.notify_push_on_insert()
returns trigger as $$
declare
  v_base_url text;
  v_key      text;
begin
  select value into v_base_url from private.app_secrets where key = 'edge_base_url';
  select value into v_key      from private.app_secrets where key = 'service_role_key';

  -- If not configured yet, skip silently (in-app notification still saved).
  if v_base_url is null or v_key is null then
    return new;
  end if;

  perform net.http_post(
    url     := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'profile_id',   new.profile_id,
      'title',        new.title,
      'body',         coalesce(new.body, ''),
      'type',         coalesce(new.type, 'general'),
      'reference_id', new.reference_id
    )
  );

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_push on notifications;
create trigger trg_notify_push
  after insert on notifications
  for each row execute function public.notify_push_on_insert();


-- FILE: 20_platform_core.sql
-- =====================================================================
-- 20. PLATFORM CORE — Generic Multi-Tenant Foundation
-- =====================================================================
-- Transforms the Surabhikunj-specific "voices" tenant into a generic
-- "organizations" tenant that any temple / NGO / community can use.
--
-- EXPAND phase: additive + renames only. Nothing is dropped. A backwards
-- compatible `voices` view keeps older app bundles working until cutover.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. voices -> organizations
-- ---------------------------------------------------------------------
-- Postgres carries all FKs, indexes and RLS policies through a rename,
-- so dependent tables need no changes. Functions with literal SQL text
-- DO break, and are recreated in section 6.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'voices')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'organizations')
  THEN
    ALTER TABLE public.voices RENAME TO organizations;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Platform columns on organizations
-- ---------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS slug          TEXT,
  ADD COLUMN IF NOT EXISTS legal_name    TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan          TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS locale        TEXT NOT NULL DEFAULT 'en-IN',
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS website_url   TEXT,
  ADD COLUMN IF NOT EXISTS owner_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Status is a small controlled vocabulary, not an enum (orgs may need more later)
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'trial', 'archived'));

-- Derive a URL-safe slug for any org that lacks one
UPDATE public.organizations
SET slug = regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g')
WHERE slug IS NULL;

-- Guarantee uniqueness before adding the constraint (append short id suffix on collision)
UPDATE public.organizations o
SET slug = o.slug || '-' || left(o.id::text, 6)
WHERE EXISTS (
  SELECT 1 FROM public.organizations d
  WHERE d.slug = o.slug AND d.id <> o.id AND d.created_at < o.created_at
);

ALTER TABLE public.organizations ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations (status);

-- ---------------------------------------------------------------------
-- 3. voice_id -> org_id across every tenant-scoped table
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'org_positions', 'departments', 'sadhana_reports',
    'sadhana_score_config', 'cleaning_areas', 'cleaning_logs', 'services',
    'service_allocations', 'meal_plans', 'events', 'notifications',
    'announcements', 'sadhana_config', 'weekly_sadhana_reports',
    'push_subscriptions'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'voice_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'org_id'
    )
    THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN voice_id TO org_id', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. ORGANIZATION SETTINGS — branding, terminology, feature flags
-- ---------------------------------------------------------------------
-- Kept as JSONB so an org can add keys without a schema migration. This is
-- the white-label surface: name, logo, colours, and the words the UI uses.

CREATE TABLE IF NOT EXISTS public.organization_settings (
  org_id      UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- { "primaryColor": "#f97316", "accentColor": "#ec4899", "logoUrl": "...",
  --   "faviconUrl": "...", "iconName": "Flame", "loginTagline": "..." }
  branding    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Overrides for platform nouns, e.g. { "member": "Devotee",
  --   "members": "Devotees", "organization": "VOICE", "tracker": "Sadhana" }
  terminology JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Org-wide toggles that are not modules, e.g. { "requireApproval": true }
  features    JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every existing org gets a settings row
INSERT INTO public.organization_settings (org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

-- Seed Surabhikunj's current look & language as ITS OWN settings, so the
-- platform defaults stay generic while the app looks unchanged for them.
UPDATE public.organization_settings s
SET branding = jsonb_build_object(
      'primaryColor', '#f97316',
      'accentColor',  '#ec4899',
      'iconName',     'Flame',
      'shortName',    'SurabhiKunj',
      'tagline',      'VOICE',
      'loginTagline', 'Vaishnava Organisation for Inspired & Committed Enthusiasts'
    ),
    terminology = jsonb_build_object(
      'member',       'Devotee',
      'members',      'Devotees',
      'organization', 'VOICE',
      'tracker',      'Sadhana',
      'mentor',       'Counsellor',
      'mentee',       'Counsellee'
    )
FROM public.organizations o
WHERE s.org_id = o.id
  AND o.name ILIKE '%surabhikunj%'
  AND s.branding = '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 5. Backwards-compatible `voices` view
-- ---------------------------------------------------------------------
-- Older deployed bundles still SELECT from voices. Reads keep working;
-- writes were admin-only and move to organizations.

CREATE OR REPLACE VIEW public.voices AS
  SELECT id, name, location, description, logo_url, created_at, updated_at
  FROM public.organizations;

GRANT SELECT ON public.voices TO authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. Recreate helper functions broken by the rename
-- ---------------------------------------------------------------------
-- Function bodies are stored as text, so `voice_id` references inside them
-- did NOT follow the column rename and must be redefined.

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Legacy alias — kept so existing policies/queries keep resolving.
CREATE OR REPLACE FUNCTION public.get_my_voice_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.current_org_id();
$$;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_voice_id() TO authenticated;

-- Tenant creation, generalised from create_voice_tenant.
-- Any authenticated user may found an organization; they become its owner.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_slug     TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT 'Asia/Kolkata'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_slug   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to create an organization';
  END IF;

  v_slug := COALESCE(
    NULLIF(regexp_replace(lower(trim(p_slug)), '[^a-z0-9]+', '-', 'g'), ''),
    regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g')
  );

  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || left(gen_random_uuid()::text, 6);
  END IF;

  INSERT INTO public.organizations (name, slug, location, timezone, owner_id)
  VALUES (p_name, v_slug, p_location, p_timezone, auth.uid())
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_settings (org_id) VALUES (v_org_id);

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. RLS for the new tables
-- ---------------------------------------------------------------------

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_settings_select" ON public.organization_settings;
CREATE POLICY "org_settings_select" ON public.organization_settings
  FOR SELECT USING (org_id = public.current_org_id());

-- Write access is tightened to a real permission in migration 24.
DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (id = public.current_org_id());

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON public.organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 9. Re-point indexes named after the old column (cosmetic but keeps
--    future maintenance readable)
-- ---------------------------------------------------------------------

ALTER INDEX IF EXISTS idx_profiles_voice_id        RENAME TO idx_profiles_org_id;
ALTER INDEX IF EXISTS idx_sadhana_reports_voice_date RENAME TO idx_sadhana_reports_org_date;
ALTER INDEX IF EXISTS idx_cleaning_logs_voice_date RENAME TO idx_cleaning_logs_org_date;

