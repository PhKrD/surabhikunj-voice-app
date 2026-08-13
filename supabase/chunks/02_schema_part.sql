-- CHUNK 2 (schema files)

-- FILE: 08_announcements.sql
-- Announcements feature
-- Run after 01..07. Voice-scoped announcements posted by leadership and
-- readable by all members of the VOICE.

create table if not exists public.announcements (
  id          uuid primary key default uuid_generate_v4(),
  voice_id    uuid not null references public.voices(id) on delete cascade,
  title       text not null,
  body        text,
  is_pinned   boolean default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_announcements_voice_created
  on public.announcements(voice_id, is_pinned desc, created_at desc);

alter table public.announcements enable row level security;

-- SELECT: all members of the same VOICE
drop policy if exists "announcements_select" on public.announcements;
create policy "announcements_select" on public.announcements
  for select using (voice_id = get_my_voice_id());

-- INSERT: leadership roles, posting as themselves, within their VOICE
drop policy if exists "announcements_insert" on public.announcements;
create policy "announcements_insert" on public.announcements
  for insert with check (
    voice_id = get_my_voice_id()
    and created_by = auth.uid()
    and get_my_role() in ('admin', 'vmc', 'oc', 'im', 'dept_incharge', 'sadhana_incharge', 'counsellor')
  );

-- UPDATE/DELETE: the author or an admin, within their VOICE
drop policy if exists "announcements_update" on public.announcements;
create policy "announcements_update" on public.announcements
  for update
  using (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()))
  with check (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()));

drop policy if exists "announcements_delete" on public.announcements;
create policy "announcements_delete" on public.announcements
  for delete using (voice_id = get_my_voice_id() and (created_by = auth.uid() or is_admin()));

-- Keep updated_at fresh
drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function update_updated_at();


-- FILE: 10_sadhana_config.sql
-- Per-VOICE sadhana scoring configuration.
-- Adds a JSONB `config` column to sadhana_score_config holding overrides that
-- map to DEFAULT_SADHANA_CONFIG keys in src/lib/sadhanaScoring.js, and RLS so
-- members can read their VOICE config and admins can edit it.
-- Run after 01..08.

alter table public.sadhana_score_config
  add column if not exists config jsonb;

alter table public.sadhana_score_config enable row level security;

-- SELECT: any member of the same VOICE (needed by the report form preview)
drop policy if exists "sadhana_config_select" on public.sadhana_score_config;
create policy "sadhana_config_select" on public.sadhana_score_config
  for select using (voice_id = get_my_voice_id());

-- INSERT: admins, for their own VOICE
drop policy if exists "sadhana_config_insert" on public.sadhana_score_config;
create policy "sadhana_config_insert" on public.sadhana_score_config
  for insert with check (voice_id = get_my_voice_id() and is_admin());

-- UPDATE: admins, for their own VOICE
drop policy if exists "sadhana_config_update" on public.sadhana_score_config;
create policy "sadhana_config_update" on public.sadhana_score_config
  for update
  using (voice_id = get_my_voice_id() and is_admin())
  with check (voice_id = get_my_voice_id() and is_admin());


-- FILE: 11_notifications_triggers.sql
-- Notifications engine: auto-create notifications from key events.
-- Run after 01..10. Functions are SECURITY DEFINER so they can insert
-- recipient rows for all members regardless of per-user RLS.

-- New announcement -> notify every active member of the VOICE (except author)
create or replace function public.notify_voice_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (voice_id, profile_id, title, body, type, reference_id)
  select NEW.voice_id, p.id, 'Announcement: ' || NEW.title, NEW.body, 'general', NEW.id
  from public.profiles p
  where p.voice_id = NEW.voice_id
    and p.is_active = true
    and (NEW.created_by is null or p.id <> NEW.created_by);
  return NEW;
end;
$$;

drop trigger if exists trg_notify_announcement on public.announcements;
create trigger trg_notify_announcement
  after insert on public.announcements
  for each row execute function public.notify_voice_on_announcement();

-- New service allocation -> notify the assigned devotee
create or replace function public.notify_on_service_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_name text;
begin
  select name into v_service_name from public.services where id = NEW.service_id;
  insert into public.notifications (voice_id, profile_id, title, body, type, reference_id)
  values (
    NEW.voice_id,
    NEW.profile_id,
    'New service assigned',
    coalesce(v_service_name, 'Service') || ' on ' || to_char(NEW.service_date, 'DD Mon YYYY'),
    'service',
    NEW.service_id
  );
  return NEW;
end;
$$;

drop trigger if exists trg_notify_service_allocation on public.service_allocations;
create trigger trg_notify_service_allocation
  after insert on public.service_allocations
  for each row execute function public.notify_on_service_allocation();


-- FILE: 12_realtime.sql
-- Enable Supabase Realtime for live updates (notifications bell + pages).
-- Run after 01..11. Realtime still respects RLS, so users only receive
-- change events for rows they are allowed to SELECT. Safe to re-run.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end $$;


-- FILE: 13_weekly_sadhana.sql
-- =====================================================================
-- 13. WEEKLY SADHANA REPORTS + STUDIES & CLEANLINESS
-- =====================================================================
-- Adds studies_min and cleanliness_done columns to daily sadhana_reports.
-- Adds a sadhana_weekly_reports table so devotees can compile 7 days of
-- data into one report and submit it to the sadhana in-charge.
-- =====================================================================

-- Daily report additions
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS studies_min      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanliness_done BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS score_studies    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS score_cleanliness NUMERIC(5,2);

COMMENT ON COLUMN sadhana_reports.studies_min       IS 'Daily studies time in minutes';
COMMENT ON COLUMN sadhana_reports.cleanliness_done  IS 'Did devotee complete daily cleanliness task';

-- Weekly rollup / manual weekly report
CREATE TABLE IF NOT EXISTS sadhana_weekly_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL, -- Monday (ISO week start)

  -- 7-day payload. Keys: sun, mon, tue, wed, thu, fri, sat.
  -- Each day: { to_bed_time, wake_up_time, day_rest_min, japa_time,
  --            japa_rounds, reading_min, hearing_min, mangal_arti,
  --            morning_class, studies_min, cleanliness_done, notes }
  daily_data      JSONB NOT NULL DEFAULT '{}',

  -- Per-column weekly totals & max (mirrors the reference spreadsheet)
  total_tb          NUMERIC(6,2) DEFAULT 0,
  total_wu          NUMERIC(6,2) DEFAULT 0,
  total_dr          NUMERIC(6,2) DEFAULT 0,
  total_japa        NUMERIC(6,2) DEFAULT 0,
  total_reading     NUMERIC(6,2) DEFAULT 0,
  total_hearing     NUMERIC(6,2) DEFAULT 0,
  total_mc          NUMERIC(6,2) DEFAULT 0,
  total_ma          NUMERIC(6,2) DEFAULT 0,
  total_studies     NUMERIC(6,2) DEFAULT 0,
  total_cleanliness NUMERIC(6,2) DEFAULT 0,

  total_score       NUMERIC(6,2) DEFAULT 0,   -- sum of the above, out of 980
  percent           NUMERIC(5,2) DEFAULT 0,   -- total_score / 980 * 100

  notes           TEXT,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(profile_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_swr_voice_week
  ON sadhana_weekly_reports(voice_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_swr_profile_week
  ON sadhana_weekly_reports(profile_id, week_start DESC);

-- Simple RLS: same voice can read; devotee can only write their own.
ALTER TABLE sadhana_weekly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS swr_select_same_voice ON sadhana_weekly_reports;
CREATE POLICY swr_select_same_voice ON sadhana_weekly_reports
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS swr_insert_own ON sadhana_weekly_reports;
CREATE POLICY swr_insert_own ON sadhana_weekly_reports
  FOR INSERT WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS swr_update_own ON sadhana_weekly_reports;
CREATE POLICY swr_update_own ON sadhana_weekly_reports
  FOR UPDATE USING (profile_id = auth.uid());

DROP POLICY IF EXISTS swr_delete_own ON sadhana_weekly_reports;
CREATE POLICY swr_delete_own ON sadhana_weekly_reports
  FOR DELETE USING (profile_id = auth.uid());

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION touch_sadhana_weekly_reports()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_swr ON sadhana_weekly_reports;
CREATE TRIGGER trg_touch_swr
  BEFORE UPDATE ON sadhana_weekly_reports
  FOR EACH ROW EXECUTE FUNCTION touch_sadhana_weekly_reports();


-- FILE: 14_sadhana_config.sql
-- =====================================================================
-- 14. CONFIGURABLE SADHANA SCORING & SOURCES
-- =====================================================================
-- Allows admins/sadhana in-charges to configure custom scoring rules
-- for each sadhana parameter, and adds hearing/reading source tracking
-- =====================================================================

-- =====================================================================
-- HEARING AND READING SOURCES
-- =====================================================================

-- Master list of hearing sources
CREATE TABLE IF NOT EXISTS hearing_sources (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,  -- e.g., "HH RNSM", "HDG SP", "HG RSP"
  abbreviation    TEXT,           -- Short form for display
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(voice_id, name)
);

-- Master list of reading types
CREATE TABLE IF NOT EXISTS reading_types (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,  -- e.g., "Shrila Prabhupada Books", "Others"
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(voice_id, name)
);

-- Add hearing/reading source columns to daily reports
ALTER TABLE sadhana_reports
  ADD COLUMN IF NOT EXISTS hearing_source_id UUID REFERENCES hearing_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reading_type_id   UUID REFERENCES reading_types(id) ON DELETE SET NULL;

-- =====================================================================
-- CONFIGURABLE SCORING RULES
-- =====================================================================

-- Scoring rule types
DO $$ BEGIN
  CREATE TYPE scoring_rule_type AS ENUM (
    'time_before',     -- Points for completing before a certain time (WU, Japa)
    'time_after',      -- Points for going to bed after a certain time (TB)
    'duration_min',    -- Points based on duration in minutes (Reading, Hearing, Studies, DR)
    'rounds',          -- Points based on number of rounds (Japa)
    'seva_hours',      -- Points based on seva hours
    'boolean',         -- Points for yes/no (MA, MC, Cleanliness)
    'custom'           -- Custom scoring logic
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Configurable scoring rules per voice
CREATE TABLE IF NOT EXISTS sadhana_scoring_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  parameter       TEXT NOT NULL,  -- 'tb', 'wu', 'japa_time', 'japa_rounds', 'reading', 'hearing', etc.
  rule_type       scoring_rule_type NOT NULL,
  
  -- Rule configuration (JSONB for flexibility)
  -- Examples:
  -- For time_before: {"cutoffs": [{"time": "03:45", "points": 25}, {"time": "04:00", "points": 20}]}
  -- For duration_min: {"tiers": [{"min": 60, "points": 15}, {"min": 45, "points": 12}]}
  -- For rounds: {"max_rounds": 16, "points_per_round": 1.5625}
  -- For boolean: {"points_if_true": 5}
  config          JSONB NOT NULL DEFAULT '{}',
  
  -- Max points for this parameter
  max_points      NUMERIC(5,2) NOT NULL DEFAULT 10,
  
  -- Whether this rule is active
  is_active       BOOLEAN DEFAULT TRUE,
  
  -- Display order in UI
  display_order   INTEGER DEFAULT 0,
  
  -- Metadata
  description     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID REFERENCES profiles(id),
  
  UNIQUE(voice_id, parameter)
);

-- Default scoring configurations per parameter
CREATE TABLE IF NOT EXISTS sadhana_default_configs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parameter       TEXT UNIQUE NOT NULL,
  rule_type       scoring_rule_type NOT NULL,
  default_config  JSONB NOT NULL,
  max_points      NUMERIC(5,2) NOT NULL,
  description     TEXT
);

-- Insert default configurations (can be copied when creating voice-specific rules)
INSERT INTO sadhana_default_configs (parameter, rule_type, default_config, max_points, description) VALUES
  ('tb', 'time_after', 
   '{"cutoffs": [
      {"time": "21:30", "points": 25}, 
      {"time": "21:45", "points": 20},
      {"time": "22:00", "points": 15},
      {"time": "22:30", "points": 10},
      {"time": "22:45", "points": 5},
      {"time": "23:00", "points": 0}
    ], "penalty_after": -5}', 
   25, 'To Bed Time scoring'),
   
  ('wu', 'time_before',
   '{"cutoffs": [
      {"time": "03:45", "points": 25},
      {"time": "04:00", "points": 20},
      {"time": "04:15", "points": 15},
      {"time": "04:30", "points": 10},
      {"time": "04:45", "points": 5},
      {"time": "05:00", "points": 0}
    ], "penalty_after": -5}',
   25, 'Wake Up Time scoring'),
   
  ('japa_rounds', 'rounds',
   '{"tiers": [
      {"rounds": 16, "points": 15},
      {"rounds": 12, "points": 11},
      {"rounds": 8, "points": 7},
      {"rounds": 4, "points": 4}
    ]}',
   15, 'Japa rounds scoring'),
   
  ('japa_time', 'time_before',
   '{"cutoffs": [
      {"time": "07:00", "points": 10},
      {"time": "08:00", "points": 7},
      {"time": "09:00", "points": 5},
      {"time": "10:00", "points": 3}
    ]}',
   10, 'Japa completion time scoring'),
   
  ('reading', 'duration_min',
   '{"tiers": [
      {"minutes": 70, "points": 15},
      {"minutes": 60, "points": 13},
      {"minutes": 45, "points": 10},
      {"minutes": 30, "points": 7},
      {"minutes": 15, "points": 4}
    ]}',
   15, 'Reading duration scoring'),
   
  ('hearing', 'duration_min',
   '{"tiers": [
      {"minutes": 60, "points": 15},
      {"minutes": 45, "points": 12},
      {"minutes": 30, "points": 9},
      {"minutes": 15, "points": 5}
    ]}',
   15, 'Hearing duration scoring'),
   
  ('studies', 'duration_min',
   '{"tiers": [
      {"minutes": 90, "points": 10},
      {"minutes": 60, "points": 8},
      {"minutes": 45, "points": 6},
      {"minutes": 30, "points": 4},
      {"minutes": 15, "points": 2}
    ]}',
   10, 'Studies duration scoring'),
   
  ('seva_hours', 'seva_hours',
   '{"tiers": [
      {"hours": 4, "points": 10},
      {"hours": 3, "points": 8},
      {"hours": 2, "points": 6},
      {"hours": 1, "points": 3}
    ]}',
   10, 'Seva hours scoring'),
   
  ('ma', 'boolean', '{"points_if_true": 5}', 5, 'Mangal Arti attendance'),
  ('mc', 'boolean', '{"points_if_true": 5}', 5, 'Morning Class attendance'),
  ('cleanliness', 'boolean', '{"points_if_true": 5}', 5, 'Cleanliness task completed'),
  
  ('dr', 'duration_min',
   '{"penalty_tiers": [
      {"minutes": 90, "points": -5},
      {"minutes": 60, "points": -3},
      {"minutes": 45, "points": -2},
      {"minutes": 30, "points": -1},
      {"minutes": 0, "points": 0}
    ]}',
   0, 'Day Rest penalty')
ON CONFLICT (parameter) DO NOTHING;

-- RLS for the default-configs reference table (read-only for all auth'd users)
ALTER TABLE sadhana_default_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS default_configs_select ON sadhana_default_configs;
CREATE POLICY default_configs_select ON sadhana_default_configs
  FOR SELECT USING (auth.role() = 'authenticated');

-- =====================================================================
-- DEFAULT DATA FOR HEARING SOURCES AND READING TYPES
-- =====================================================================

-- Function to initialize default sources for a voice
CREATE OR REPLACE FUNCTION initialize_sadhana_sources(p_voice_id UUID)
RETURNS void AS $$
BEGIN
  -- Insert default hearing sources
  INSERT INTO hearing_sources (voice_id, name, abbreviation, display_order) VALUES
    (p_voice_id, 'HH Radhanath Swami Maharaj', 'HH RNSM', 1),
    (p_voice_id, 'HDG Srila Prabhupada', 'HDG SP', 2),
    (p_voice_id, 'HG Radha Shyamsundar Prabhu', 'HG RSP', 3),
    (p_voice_id, 'HH Gopal Krishna Goswami Maharaj', 'HH GKGM', 4),
    (p_voice_id, 'HH Bhakti Charu Swami Maharaj', 'HH BCSM', 5),
    (p_voice_id, 'Other Senior Devotees', 'Others', 6)
  ON CONFLICT (voice_id, name) DO NOTHING;
  
  -- Insert default reading types
  INSERT INTO reading_types (voice_id, name, display_order) VALUES
    (p_voice_id, 'Srila Prabhupada Books', 1),
    (p_voice_id, 'Bhagavad Gita', 2),
    (p_voice_id, 'Srimad Bhagavatam', 3),
    (p_voice_id, 'Caitanya Caritamrita', 4),
    (p_voice_id, 'Nectar of Devotion', 5),
    (p_voice_id, 'Nectar of Instruction', 6),
    (p_voice_id, 'Other Vaishnava Literature', 7),
    (p_voice_id, 'Study Materials', 8)
  ON CONFLICT (voice_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Function to initialize default scoring rules for a voice
CREATE OR REPLACE FUNCTION initialize_sadhana_scoring_rules(p_voice_id UUID, p_created_by UUID)
RETURNS void AS $$
BEGIN
  -- Copy from default configs
  INSERT INTO sadhana_scoring_rules (
    voice_id, parameter, rule_type, config, max_points, description, created_by
  )
  SELECT 
    p_voice_id, parameter, rule_type, default_config, max_points, description, p_created_by
  FROM sadhana_default_configs
  ON CONFLICT (voice_id, parameter) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

-- Hearing sources RLS
ALTER TABLE hearing_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hearing_sources_select ON hearing_sources;
CREATE POLICY hearing_sources_select ON hearing_sources
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS hearing_sources_modify ON hearing_sources;
CREATE POLICY hearing_sources_modify ON hearing_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = hearing_sources.voice_id
      AND role IN ('admin', 'vmc', 'oc', 'sadhana_incharge')
    )
  );

-- Reading types RLS
ALTER TABLE reading_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reading_types_select ON reading_types;
CREATE POLICY reading_types_select ON reading_types
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS reading_types_modify ON reading_types;
CREATE POLICY reading_types_modify ON reading_types
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = reading_types.voice_id
      AND role IN ('admin', 'vmc', 'oc', 'sadhana_incharge')
    )
  );

-- Scoring rules RLS
ALTER TABLE sadhana_scoring_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scoring_rules_select ON sadhana_scoring_rules;
CREATE POLICY scoring_rules_select ON sadhana_scoring_rules
  FOR SELECT USING (
    voice_id IN (SELECT voice_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS scoring_rules_modify ON sadhana_scoring_rules;
CREATE POLICY scoring_rules_modify ON sadhana_scoring_rules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND voice_id = sadhana_scoring_rules.voice_id
      AND role IN ('admin', 'vmc', 'oc', 'sadhana_incharge')
    )
  );

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_sadhana_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hearing_sources_timestamp ON hearing_sources;
CREATE TRIGGER hearing_sources_timestamp
  BEFORE UPDATE ON hearing_sources
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

DROP TRIGGER IF EXISTS reading_types_timestamp ON reading_types;
CREATE TRIGGER reading_types_timestamp
  BEFORE UPDATE ON reading_types
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

DROP TRIGGER IF EXISTS scoring_rules_timestamp ON sadhana_scoring_rules;
CREATE TRIGGER scoring_rules_timestamp
  BEFORE UPDATE ON sadhana_scoring_rules
  FOR EACH ROW EXECUTE FUNCTION update_sadhana_config_timestamp();

-- =====================================================================
-- INITIALIZE FOR EXISTING VOICES
-- =====================================================================

-- Initialize sources and rules for all existing voices
DO $$
DECLARE
  v RECORD;
  admin_id UUID;
BEGIN
  FOR v IN SELECT id FROM voices LOOP
    -- Get the first admin for this voice
    SELECT id INTO admin_id FROM profiles 
    WHERE voice_id = v.id AND role = 'admin' 
    LIMIT 1;
    
    -- Initialize sources
    PERFORM initialize_sadhana_sources(v.id);
    
    -- Initialize scoring rules if admin exists
    IF admin_id IS NOT NULL THEN
      PERFORM initialize_sadhana_scoring_rules(v.id, admin_id);
    END IF;
  END LOOP;
END $$;

