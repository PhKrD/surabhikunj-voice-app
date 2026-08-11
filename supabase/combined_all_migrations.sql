-- ============================================================
-- VOICE + Parental Control — Full Schema (migrations 01-54)
-- Generated Tue Aug 11 17:34:41 IST 2026
-- ============================================================


-- FILE: 01_schema.sql

-- ============================================================
-- SurabhiKunj VOICE — Complete Multi-Tenant Database Schema
-- Supabase / PostgreSQL
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 0. ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM (
  'devotee',
  'counsellor',
  'sadhana_incharge',
  'dept_incharge',
  'im',
  'kitchen_team',
  'vmc',
  'oc',
  'admin'
);

CREATE TYPE meal_type AS ENUM ('breakfast', 'lunch', 'dinner', 'prasad_special');

CREATE TYPE service_status AS ENUM ('pending', 'done', 'missed', 'excused');

CREATE TYPE cleaning_status AS ENUM ('done', 'not_done', 'partial');

CREATE TYPE event_type AS ENUM ('program', 'festival', 'service', 'meeting', 'other');

CREATE TYPE hierarchy_level AS ENUM ('vmc', 'oc', 'hod', 'dept_leader', 'counsellor', 'devotee');

-- ============================================================
-- 1. VOICES (Tenants)
-- ============================================================

CREATE TABLE voices (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,                        -- e.g. "SurabhiKunj VOICE Pune"
  location    TEXT,
  description TEXT,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 2. PROFILES (extends Supabase auth.users)
-- ============================================================

CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  voice_id        UUID REFERENCES voices(id) ON DELETE SET NULL,
  spiritual_name  TEXT NOT NULL,
  legal_name      TEXT,
  role            user_role DEFAULT 'devotee',
  phone           TEXT,
  avatar_url      TEXT,
  initiated       BOOLEAN DEFAULT FALSE,
  joined_date     DATE,
  room_number     TEXT,
  counsellor_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- who is my counsellor
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. ORGANIZATIONAL HIERARCHY
-- ============================================================

CREATE TABLE org_positions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id    UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,             -- e.g. "VMC", "President", "Treasurer"
  level       hierarchy_level NOT NULL,
  profile_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  description TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. DEPARTMENTS
-- ============================================================

CREATE TABLE departments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- Kitchen, Sankirtan, Cleanliness, etc.
  description     TEXT,
  incharge_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sub_incharge_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  icon            TEXT,                   -- lucide icon name
  color           TEXT,                   -- hex color for UI
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE department_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(department_id, profile_id)
);

-- ============================================================
-- 5. SADHANA REPORTS
-- ============================================================

CREATE TABLE sadhana_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  report_date     DATE NOT NULL,

  -- Fields matching WhatsApp format
  to_bed_time     TIME,                   -- TB
  wake_up_time    TIME,                   -- WU
  day_rest_min    INTEGER DEFAULT 0,      -- DR in minutes
  japa_time       TIME,                   -- JP completion time
  japa_rounds     INTEGER DEFAULT 0,      -- JP rounds
  reading_min     INTEGER DEFAULT 0,      -- RD in minutes
  hearing_min     INTEGER DEFAULT 0,      -- HR in minutes
  mangal_arti     BOOLEAN DEFAULT FALSE,  -- MA
  morning_class   BOOLEAN DEFAULT FALSE,  -- MC
  seva_hours      NUMERIC(4,2) DEFAULT 0, -- Seva in hours

  -- Auto-calculated score (0-100)
  score           NUMERIC(5,2),

  -- Breakdown scores
  score_japa      NUMERIC(5,2),
  score_sleep     NUMERIC(5,2),
  score_reading   NUMERIC(5,2),
  score_hearing   NUMERIC(5,2),
  score_seva      NUMERIC(5,2),
  score_attendance NUMERIC(5,2),

  notes           TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(profile_id, report_date)
);

-- ============================================================
-- 6. SADHANA SCORING CONFIG (per voice, customizable)
-- ============================================================

CREATE TABLE sadhana_score_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id              UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE UNIQUE,

  -- Japa scoring thresholds (time by which japa should be done)
  japa_excellent_by     TIME DEFAULT '07:00:00',   -- 10 pts if done before
  japa_good_by          TIME DEFAULT '08:00:00',   -- 7 pts
  japa_ok_by            TIME DEFAULT '09:00:00',   -- 5 pts
  japa_max_rounds       INTEGER DEFAULT 16,

  -- Sleep scoring
  wakeup_ideal          TIME DEFAULT '04:30:00',
  wakeup_good           TIME DEFAULT '05:00:00',
  tobed_ideal           TIME DEFAULT '22:00:00',
  tobed_late            TIME DEFAULT '23:00:00',

  -- Reading/Hearing (minutes for full score)
  reading_full_score_min  INTEGER DEFAULT 45,
  hearing_full_score_min  INTEGER DEFAULT 45,

  -- Seva (hours for full score)
  seva_full_score_hrs   NUMERIC(3,1) DEFAULT 4.0,

  -- Day rest penalty (per 15 min above 0)
  day_rest_penalty_per_15min NUMERIC(3,2) DEFAULT 0.5,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. CLEANLINESS AREAS & ASSIGNMENTS
-- ============================================================

CREATE TABLE cleaning_areas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id    UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,             -- e.g. "Temple Hall", "Corridor 1", "Kitchen"
  description TEXT,
  floor       TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cleaning_assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  area_id     UUID NOT NULL REFERENCES cleaning_areas(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_from DATE DEFAULT CURRENT_DATE,
  assigned_to   DATE,                    -- NULL = indefinite
  UNIQUE(area_id, profile_id)
);

CREATE TABLE cleaning_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id    UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  area_id     UUID NOT NULL REFERENCES cleaning_areas(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  status      cleaning_status NOT NULL DEFAULT 'not_done',
  notes       TEXT,
  marked_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(area_id, profile_id, log_date)
);

-- ============================================================
-- 8. IM SERVICES (Internal Manager)
-- ============================================================

CREATE TABLE services (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,          -- e.g. "Temple Deity Service"
  description     TEXT,
  department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
  default_time    TIME,
  duration_min    INTEGER,
  instructions    TEXT,
  is_recurring    BOOLEAN DEFAULT FALSE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_allocations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_date    DATE NOT NULL,
  service_time    TIME,
  status          service_status DEFAULT 'pending',
  notes           TEXT,
  reminder_sent   BOOLEAN DEFAULT FALSE,
  allocated_by    UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE service_preferences (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  week_start    DATE NOT NULL,           -- Monday of the week
  preference    INTEGER DEFAULT 1,       -- 1=preferred, 0=ok, -1=avoid
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, service_id, week_start)
);

-- ============================================================
-- 9. KITCHEN / MEAL PLAN
-- ============================================================

CREATE TABLE meal_plans (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id      UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  plan_date     DATE NOT NULL,
  meal_type     meal_type NOT NULL,
  menu_items    TEXT[],                  -- array of dish names
  notes         TEXT,                   -- e.g. "Ekadashi fasting menu"
  is_special    BOOLEAN DEFAULT FALSE,
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voice_id, plan_date, meal_type)
);

-- ============================================================
-- 10. EVENTS & FESTIVALS
-- ============================================================

CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id        UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  event_type      event_type DEFAULT 'program',
  start_datetime  TIMESTAMPTZ NOT NULL,
  end_datetime    TIMESTAMPTZ,
  venue           TEXT,
  is_mandatory    BOOLEAN DEFAULT FALSE,
  notify_all      BOOLEAN DEFAULT TRUE,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_rsvp (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attending   BOOLEAN,
  responded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, profile_id)
);

-- ============================================================
-- 11. NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  voice_id    UUID NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,  -- recipient
  title       TEXT NOT NULL,
  body        TEXT,
  type        TEXT DEFAULT 'general',    -- sadhana, service, cleaning, event, system
  reference_id UUID,                    -- optional link to related record
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 12. INDEXES FOR PERFORMANCE
-- ============================================================

CREATE INDEX idx_profiles_voice_id ON profiles(voice_id);
CREATE INDEX idx_profiles_counsellor_id ON profiles(counsellor_id);
CREATE INDEX idx_sadhana_reports_profile_date ON sadhana_reports(profile_id, report_date DESC);
CREATE INDEX idx_sadhana_reports_voice_date ON sadhana_reports(voice_id, report_date DESC);
CREATE INDEX idx_cleaning_logs_area_date ON cleaning_logs(area_id, log_date DESC);
CREATE INDEX idx_cleaning_logs_voice_date ON cleaning_logs(voice_id, log_date DESC);
CREATE INDEX idx_service_allocations_date ON service_allocations(service_date, voice_id);
CREATE INDEX idx_service_allocations_profile ON service_allocations(profile_id, service_date DESC);
CREATE INDEX idx_meal_plans_date ON meal_plans(voice_id, plan_date);
CREATE INDEX idx_events_start ON events(voice_id, start_datetime);
CREATE INDEX idx_notifications_profile ON notifications(profile_id, is_read, created_at DESC);

-- ============================================================
-- 13. ROW LEVEL SECURITY (Multi-Tenant Isolation)
-- ============================================================

ALTER TABLE voices ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sadhana_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sadhana_score_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_rsvp ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's voice_id
CREATE OR REPLACE FUNCTION get_my_voice_id()
RETURNS UUID AS $$
  SELECT voice_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: is current user admin/vmc/oc?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT role IN ('admin', 'vmc', 'oc') FROM profiles WHERE id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Profiles: users see own voice's profiles; admins see all in voice
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "profiles_insert_self" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_self" ON profiles
  FOR UPDATE USING (id = auth.uid() OR is_admin());

-- Sadhana reports: own reports visible to self + counsellor + sadhana_incharge + admin
CREATE POLICY "sadhana_select" ON sadhana_reports
  FOR SELECT USING (
    voice_id = get_my_voice_id() AND (
      profile_id = auth.uid()
      OR get_my_role() IN ('counsellor', 'sadhana_incharge', 'admin', 'vmc', 'oc')
    )
  );

CREATE POLICY "sadhana_insert_own" ON sadhana_reports
  FOR INSERT WITH CHECK (profile_id = auth.uid() AND voice_id = get_my_voice_id());

CREATE POLICY "sadhana_update_own" ON sadhana_reports
  FOR UPDATE USING (profile_id = auth.uid() AND voice_id = get_my_voice_id());

-- Voice-scoped generic policy helper (for departments, services, events, etc.)
-- Each table will get: "same voice = can read; admin/incharge = can write"
CREATE POLICY "departments_select" ON departments
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "departments_write" ON departments
  FOR ALL USING (voice_id = get_my_voice_id() AND is_admin());

CREATE POLICY "cleaning_areas_select" ON cleaning_areas
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "cleaning_areas_write" ON cleaning_areas
  FOR ALL USING (voice_id = get_my_voice_id() AND is_admin());

CREATE POLICY "cleaning_logs_select" ON cleaning_logs
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "cleaning_logs_insert" ON cleaning_logs
  FOR INSERT WITH CHECK (
    voice_id = get_my_voice_id() AND
    (profile_id = auth.uid() OR is_admin())
  );

CREATE POLICY "services_select" ON services
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "service_allocations_select" ON service_allocations
  FOR SELECT USING (
    voice_id = get_my_voice_id() AND
    (profile_id = auth.uid() OR get_my_role() IN ('im', 'admin', 'vmc', 'oc'))
  );

CREATE POLICY "meal_plans_select" ON meal_plans
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "meal_plans_write" ON meal_plans
  FOR ALL USING (
    voice_id = get_my_voice_id() AND
    get_my_role() IN ('kitchen_team', 'admin', 'vmc', 'oc')
  );

CREATE POLICY "events_select" ON events
  FOR SELECT USING (voice_id = get_my_voice_id());

CREATE POLICY "events_write" ON events
  FOR ALL USING (voice_id = get_my_voice_id() AND is_admin());

CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (profile_id = auth.uid() AND voice_id = get_my_voice_id());

CREATE POLICY "org_positions_select" ON org_positions
  FOR SELECT USING (voice_id = get_my_voice_id());

-- ============================================================
-- 14. AUTO-UPDATE TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sadhana_updated_at BEFORE UPDATE ON sadhana_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_services_updated_at BEFORE UPDATE ON service_allocations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_meal_plans_updated_at BEFORE UPDATE ON meal_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 15. PROFILE AUTO-CREATE ON AUTH SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, spiritual_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'spiritual_name', 'New Devotee'),
    'devotee'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 16. SEED: Default VOICE
-- ============================================================

INSERT INTO voices (id, name, location, description)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'SurabhiKunj VOICE',
  'Pune, Maharashtra',
  'SurabhiKunj Vaishnava Organisation for Inspired & Committed Enthusiasts'
);

-- Default sadhana score config for SurabhiKunj
INSERT INTO sadhana_score_config (voice_id)
VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890');

-- ============================================================
-- END OF SCHEMA
-- ============================================================


-- FILE: 02_bootstrap.sql

-- SurabhiKunj VOICE bootstrap helpers
-- Run this after 01_schema.sql

create or replace function public.bootstrap_current_user_to_default_voice()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_default_voice uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
begin
  update public.profiles
  set
    voice_id = coalesce(voice_id, v_default_voice),
    role = coalesce(role, 'devotee'::user_role),
    updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.bootstrap_current_user_to_default_voice() to authenticated;

-- Optional helper for creating a new tenant VOICE
create or replace function public.create_voice_tenant(
  p_name text,
  p_location text default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voice_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin/vmc/oc can create tenant voices';
  end if;

  insert into public.voices (name, location, description)
  values (p_name, p_location, p_description)
  returning id into v_voice_id;

  return v_voice_id;
end;
$$;

grant execute on function public.create_voice_tenant(text, text, text) to authenticated;


-- FILE: 04_events_soft_delete.sql

-- Add soft-delete support for events on existing databases
alter table public.events
add column if not exists is_active boolean not null default true;

create index if not exists idx_events_voice_active_start
  on public.events (voice_id, is_active, start_datetime desc);


-- FILE: 05_app_policies.sql

-- Missing/extended RLS policies for app features
-- Run after 01..04

-- ============================================================
-- SERVICES WRITE (needed by ServicesPage create/edit/archive)
-- ============================================================

drop policy if exists "services_write" on public.services;
create policy "services_write" on public.services
  for all
  using (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  )
  with check (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  );

-- ============================================================
-- SERVICE ALLOCATIONS WRITE (IM/admin can assign/update)
-- ============================================================

drop policy if exists "service_allocations_write" on public.service_allocations;
create policy "service_allocations_write" on public.service_allocations
  for all
  using (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  )
  with check (
    voice_id = get_my_voice_id()
    and get_my_role() in ('im', 'admin', 'vmc', 'oc')
  );

-- ============================================================
-- SERVICE PREFERENCES SELECT/WRITE
-- Devotees set their own preferences; IM/admin can read for scheduler
-- ============================================================

drop policy if exists "service_preferences_select" on public.service_preferences;
create policy "service_preferences_select" on public.service_preferences
  for select
  using (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  );

drop policy if exists "service_preferences_write" on public.service_preferences;
create policy "service_preferences_write" on public.service_preferences
  for all
  using (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  )
  with check (
    exists (
      select 1
      from public.services s
      where s.id = service_preferences.service_id
        and s.voice_id = get_my_voice_id()
    )
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc')
    )
  );

-- ============================================================
-- CLEANING ASSIGNMENTS SELECT/WRITE
-- Needed for admin area assignment workflow in CleanlinessPage
-- ============================================================

drop policy if exists "cleaning_assignments_select" on public.cleaning_assignments;
create policy "cleaning_assignments_select" on public.cleaning_assignments
  for select
  using (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
  );

drop policy if exists "cleaning_assignments_write" on public.cleaning_assignments;
create policy "cleaning_assignments_write" on public.cleaning_assignments
  for all
  using (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
    and is_admin()
  )
  with check (
    exists (
      select 1
      from public.cleaning_areas a
      where a.id = cleaning_assignments.area_id
        and a.voice_id = get_my_voice_id()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = cleaning_assignments.profile_id
        and p.voice_id = get_my_voice_id()
    )
    and is_admin()
  );

-- ============================================================
-- PROFILES UPDATE HARDENING
-- Replace broad update policy with voice-scoped checks
-- ============================================================

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update
  using (
    voice_id = get_my_voice_id()
    and (
      id = auth.uid()
      or is_admin()
    )
  )
  with check (
    voice_id = get_my_voice_id()
    and (
      id = auth.uid()
      or is_admin()
    )
  );

-- ============================================================
-- NOTIFICATIONS INSERT/UPDATE
-- Required for in-app notification creation from client
-- ============================================================

drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert
  with check (
    voice_id = get_my_voice_id()
    and (
      profile_id = auth.uid()
      or get_my_role() in ('im', 'admin', 'vmc', 'oc', 'dept_incharge', 'sadhana_incharge', 'counsellor')
    )
  );

drop policy if exists "notifications_update_self" on public.notifications;
create policy "notifications_update_self" on public.notifications
  for update
  using (voice_id = get_my_voice_id() and profile_id = auth.uid())
  with check (voice_id = get_my_voice_id() and profile_id = auth.uid());

-- ============================================================
-- EVENTS WRITE RECREATE (explicit WITH CHECK)
-- ============================================================

drop policy if exists "events_write" on public.events;
create policy "events_write" on public.events
  for all
  using (voice_id = get_my_voice_id() and is_admin())
  with check (voice_id = get_my_voice_id() and is_admin());


-- FILE: 06_make_first_admin.sql

-- Bootstrap first admin user for a VOICE
-- Run manually in Supabase SQL editor after user has signed up

-- 1) Replace with admin user's email
-- 2) Run this query block

-- Example:
do $$
 declare
   v_email text := 'palanharkrsnadas@gmail.com';
 begin
   update public.profiles p
   set
     role = 'admin'::user_role,
     voice_id = coalesce(p.voice_id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid),
     updated_at = now()
   from auth.users u
   where p.id = u.id
     and lower(u.email) = lower(v_email);
 end $$;

-- Optional: list users and roles for verification
-- select u.email, p.spiritual_name, p.role, p.voice_id
-- from auth.users u
-- join public.profiles p on p.id = u.id
-- order by u.created_at desc;


-- FILE: 07_department_members_policies.sql

-- Department members RLS policies
-- Run after 01..06. Enables reading department membership (for the Residents
-- directory department filter/chips) and admin-managed membership writes.
-- Voice isolation is enforced via the parent department's voice_id.

-- SELECT: any member of the same VOICE can read department membership
drop policy if exists "department_members_select" on public.department_members;
create policy "department_members_select" on public.department_members
  for select
  using (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
  );

-- WRITE: admins (admin/vmc/oc) can manage membership within their VOICE,
-- and only for profiles that belong to the same VOICE.
drop policy if exists "department_members_write" on public.department_members;
create policy "department_members_write" on public.department_members
  for all
  using (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
    and is_admin()
  )
  with check (
    exists (
      select 1
      from public.departments d
      where d.id = department_members.department_id
        and d.voice_id = get_my_voice_id()
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = department_members.profile_id
        and p.voice_id = get_my_voice_id()
    )
    and is_admin()
  );


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


-- FILE: 21_memberships.sql

-- =====================================================================
-- 21. MEMBERSHIPS — Users belong to MANY organizations
-- =====================================================================
-- Splits the overloaded `profiles` table into two concepts:
--
--   profiles     = global identity  (one row per human, org-agnostic)
--   memberships  = identity IN an org (one row per human per org)
--
-- Org-specific data (display name, approval state, custom fields like
-- "initiated" or "room number") moves onto the membership, so the same
-- person can be "Palanhar Krsna Das" in one org and "P. Taur" in another.
--
-- EXPAND phase: profiles keeps its old columns; they are dropped in the
-- contract migration once the frontend reads from memberships.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Global identity columns on profiles
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill the org-neutral name from the Surabhikunj-specific column
UPDATE public.profiles
SET display_name = COALESCE(NULLIF(trim(spiritual_name), ''), 'Member')
WHERE display_name IS NULL;

ALTER TABLE public.profiles ALTER COLUMN display_name SET NOT NULL;

-- spiritual_name must stop being mandatory — it is now an org custom field
ALTER TABLE public.profiles ALTER COLUMN spiritual_name DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 2. MEMBERSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,

  -- Name shown inside THIS org (may differ per org)
  display_name TEXT,

  status       TEXT NOT NULL DEFAULT 'pending',

  -- Values for this org's custom member fields (see member_field_definitions)
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,

  invited_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, user_id)
);

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'left'));

CREATE INDEX IF NOT EXISTS idx_memberships_org    ON public.memberships (org_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_attrs  ON public.memberships USING GIN (attributes);

-- ---------------------------------------------------------------------
-- 3. CUSTOM MEMBER FIELDS — orgs define their own member profile schema
-- ---------------------------------------------------------------------
-- Replaces hardcoded columns like `initiated`, `room_number`, `legal_name`.
-- An NGO can instead define "employee_id" or "blood_group" with no migration.

CREATE TABLE IF NOT EXISTS public.member_field_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text',
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- for select/multiselect
  help_text   TEXT,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,      -- visible only to admins
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, key)
);

ALTER TABLE public.member_field_definitions
  DROP CONSTRAINT IF EXISTS member_field_definitions_type_check;
ALTER TABLE public.member_field_definitions
  ADD CONSTRAINT member_field_definitions_type_check
  CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'boolean',
                        'select', 'multiselect', 'email', 'phone', 'url'));

-- ---------------------------------------------------------------------
-- 4. BACKFILL — every existing profile becomes a membership
-- ---------------------------------------------------------------------

INSERT INTO public.memberships (org_id, user_id, display_name, status, attributes, joined_at)
SELECT
  p.org_id,
  p.id,
  COALESCE(NULLIF(trim(p.spiritual_name), ''), p.display_name),
  CASE WHEN p.is_approved THEN 'active' ELSE 'pending' END,
  -- Preserve the temple-specific fields as org custom attributes
  jsonb_strip_nulls(jsonb_build_object(
    'spiritual_name', p.spiritual_name,
    'legal_name',     p.legal_name,
    'initiated',      p.initiated,
    'room_number',    p.room_number,
    'joined_date',    p.joined_date
  )),
  COALESCE(p.joined_date::timestamptz, p.created_at)
FROM public.profiles p
WHERE p.org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Register those attributes as real, editable field definitions for any org
-- that actually has data in them, so they render in the member form.
INSERT INTO public.member_field_definitions (org_id, key, label, field_type, sort_order)
SELECT DISTINCT o.id, d.key, d.label, d.field_type, d.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('spiritual_name', 'Spiritual Name', 'text',    10),
  ('legal_name',     'Legal Name',     'text',    20),
  ('initiated',      'Initiated',      'boolean', 30),
  ('room_number',    'Room Number',    'text',    40),
  ('joined_date',    'Joined Date',    'date',    50)
) AS d(key, label, field_type, sort_order)
WHERE EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.org_id = o.id AND m.attributes ? d.key
)
ON CONFLICT (org_id, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. HELPERS
-- ---------------------------------------------------------------------

-- The caller's membership in their currently active org.
CREATE OR REPLACE FUNCTION public.current_membership_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT m.id
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
    AND m.org_id  = public.current_org_id()
  LIMIT 1;
$$;

-- Is the caller an active member of the given org?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_membership_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID)     TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Keep memberships in sync while `profiles` is still the write path
-- ---------------------------------------------------------------------
-- During the expand phase the app still writes profiles.org_id /
-- is_approved. Mirror those onto memberships so both stay consistent.

CREATE OR REPLACE FUNCTION public.sync_membership_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.memberships (org_id, user_id, display_name, status, joined_at)
  VALUES (
    NEW.org_id,
    NEW.id,
    COALESCE(NULLIF(trim(NEW.spiritual_name), ''), NEW.display_name),
    CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
    NOW()
  )
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET status     = CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
        updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_membership ON public.profiles;
CREATE TRIGGER trg_sync_membership
  AFTER INSERT OR UPDATE OF org_id, is_approved ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_from_profile();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.memberships              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_field_definitions ENABLE ROW LEVEL SECURITY;

-- See fellow members of orgs you belong to; always see your own rows.
DROP POLICY IF EXISTS "memberships_select" ON public.memberships;
CREATE POLICY "memberships_select" ON public.memberships
  FOR SELECT USING (
    user_id = auth.uid() OR org_id = public.current_org_id()
  );

-- A user may create their own PENDING membership (self sign-up / join).
DROP POLICY IF EXISTS "memberships_insert_self" ON public.memberships;
CREATE POLICY "memberships_insert_self" ON public.memberships
  FOR INSERT WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Tightened to the members.manage permission in migration 24.
DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;
CREATE POLICY "memberships_admin_write" ON public.memberships
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS "member_fields_select" ON public.member_field_definitions;
CREATE POLICY "member_fields_select" ON public.member_field_definitions
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_memberships_updated_at ON public.memberships;
CREATE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 22_rbac.sql

-- =====================================================================
-- 22. RBAC — Unlimited custom roles with granular permissions
-- =====================================================================
-- Replaces the fixed `user_role` ENUM (devotee/counsellor/vmc/oc/...) with
-- data an organization owns and edits:
--
--   permissions       global catalog of capabilities  ('events.create')
--   roles             org-defined roles               ('Kitchen Head')
--   role_permissions  which capabilities a role grants
--   membership_roles  which roles a member holds      (many-to-many)
--
-- A member's effective permissions = union of all their roles' permissions.
-- The '*' permission is a wildcard meaning "everything" (org owner).
--
-- The ENUM column is left in place during EXPAND and dropped in contract.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. PERMISSION CATALOG (global — defines what the platform can do)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permissions (
  key         TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.permissions (key, module, label, description, sort_order) VALUES
  -- Organization
  ('*',                    'core',          'Full Access',            'Every permission, present and future', 0),
  ('org.settings.manage',  'core',          'Manage Settings',        'Edit org name, branding, terminology', 10),
  ('org.modules.manage',   'core',          'Manage Modules',         'Enable or disable features',           11),
  ('org.billing.manage',   'core',          'Manage Billing',         'Change plan and payment details',      12),
  ('org.audit.view',       'core',          'View Audit Log',         'See who changed what',                 13),

  -- Members
  ('members.view',         'members',       'View Members',           'See the member directory',             20),
  ('members.invite',       'members',       'Invite Members',         'Send invitations to join',             21),
  ('members.approve',      'members',       'Approve Members',        'Approve or reject join requests',      22),
  ('members.manage',       'members',       'Manage Members',         'Edit member details and attributes',   23),
  ('members.remove',       'members',       'Remove Members',         'Suspend or remove members',            24),

  -- Roles
  ('roles.view',           'roles',         'View Roles',             'See roles and their permissions',      30),
  ('roles.manage',         'roles',         'Manage Roles',           'Create, edit and delete roles',        31),
  ('roles.assign',         'roles',         'Assign Roles',           'Grant or revoke roles for members',    32),

  -- Departments / teams
  ('departments.view',     'departments',   'View Departments',       'See departments and their members',    40),
  ('departments.manage',   'departments',   'Manage Departments',     'Create, rename and delete departments',41),
  ('departments.assign',   'departments',   'Assign to Departments',  'Add or remove department members',     42),

  -- Hierarchy
  ('hierarchy.view',       'hierarchy',     'View Org Structure',     'See the organization chart',           50),
  ('hierarchy.manage',     'hierarchy',     'Manage Org Structure',   'Define positions and reporting lines', 51),

  -- Events
  ('events.view',          'events',        'View Events',            'See the events calendar',              60),
  ('events.create',        'events',        'Create Events',          'Add new events',                       61),
  ('events.manage',        'events',        'Manage Events',          'Edit or delete any event',             62),
  ('events.attendance',    'events',        'Manage Attendance',      'Record and edit attendance',           63),

  -- Trackers (generalises Sadhana)
  ('trackers.submit',      'trackers',      'Submit Entries',         'Submit your own tracker entries',      70),
  ('trackers.view_own',    'trackers',      'View Own Entries',       'See your own history and scores',      71),
  ('trackers.view_all',    'trackers',      'View All Entries',       'See every member''s entries',          72),
  ('trackers.manage',      'trackers',      'Manage Trackers',        'Define trackers, fields and scoring',  73),

  -- Tasks (generalises Cleanliness + Services)
  ('tasks.view_own',       'tasks',         'View Own Tasks',         'See tasks assigned to you',            80),
  ('tasks.view_all',       'tasks',         'View All Tasks',         'See every assignment',                 81),
  ('tasks.assign',         'tasks',         'Assign Tasks',           'Allocate tasks to members',            82),
  ('tasks.manage',         'tasks',         'Manage Tasks',           'Define task types and schedules',      83),
  ('tasks.verify',         'tasks',         'Verify Completion',      'Confirm or reject completed tasks',    84),

  -- Resources (generalises Kitchen / meal plans)
  ('resources.view',       'resources',     'View Plans',             'See resource and meal plans',          90),
  ('resources.manage',     'resources',     'Manage Plans',           'Create and edit plans',                91),

  -- Mentorship (generalises Counsellor)
  ('mentorship.view_own',  'mentorship',    'View Own Mentees',       'See members assigned to you',          100),
  ('mentorship.view_all',  'mentorship',    'View All Relationships', 'See every mentor-mentee link',         101),
  ('mentorship.manage',    'mentorship',    'Manage Relationships',   'Assign mentors to members',            102),

  -- Announcements & notifications
  ('announcements.view',   'announcements', 'View Announcements',     'Read announcements',                   110),
  ('announcements.manage', 'announcements', 'Manage Announcements',   'Post, edit and delete announcements',  111),
  ('notifications.send',   'announcements', 'Send Notifications',     'Push notifications to members',        112),

  -- Reporting
  ('reports.view',         'reports',       'View Reports',           'Access dashboards and analytics',      120),
  ('reports.export',       'reports',       'Export Reports',         'Download data as CSV or PDF',          121)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label  = EXCLUDED.label,
      description = EXCLUDED.description,
      sort_order  = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. ROLES (owned by each organization)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT,

  -- Protected roles cannot be deleted (every org needs an owner + a default)
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Auto-assigned to new members when they join
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Higher wins when resolving display/precedence
  priority    INTEGER NOT NULL DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, key)
);

CREATE INDEX IF NOT EXISTS idx_roles_org ON public.roles (org_id);

-- Exactly one default role per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_one_default
  ON public.roles (org_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id        UUID NOT NULL REFERENCES public.roles(id)       ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS public.membership_roles (
  membership_id UUID NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  role_id       UUID NOT NULL REFERENCES public.roles(id)       ON DELETE CASCADE,
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (membership_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_roles_role ON public.membership_roles (role_id);

-- ---------------------------------------------------------------------
-- 3. DEFAULT ROLE TEMPLATES for every organization
-- ---------------------------------------------------------------------
-- Starting point only. Orgs rename, delete and extend these freely.

CREATE OR REPLACE FUNCTION public.seed_default_roles(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role_id UUID;
  r         RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('owner',   'Owner',   'Full control of the organization', TRUE,  FALSE, 100, '#dc2626'),
      ('admin',   'Admin',   'Manages members, settings and content', TRUE,  FALSE, 80,  '#ea580c'),
      ('manager', 'Manager', 'Runs day-to-day operations',       FALSE, FALSE, 60,  '#2563eb'),
      ('member',  'Member',  'Standard access',                  TRUE,  TRUE,  10,  '#64748b')
    ) AS t(key, name, description, is_system, is_default, priority, color)
  LOOP
    INSERT INTO public.roles (org_id, key, name, description, is_system, is_default, priority, color)
    VALUES (p_org_id, r.key, r.name, r.description, r.is_system, r.is_default, r.priority, r.color)
    ON CONFLICT (org_id, key) DO NOTHING;
  END LOOP;

  -- Owner: wildcard
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'owner';
  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_role_id, '*')
  ON CONFLICT DO NOTHING;

  -- Admin: everything except billing and the wildcard itself
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'admin';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions
  WHERE key NOT IN ('*', 'org.billing.manage')
  ON CONFLICT DO NOTHING;

  -- Manager: operational, not structural
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'manager';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions WHERE key IN (
    'members.view', 'departments.view', 'departments.assign', 'hierarchy.view',
    'events.view', 'events.create', 'events.attendance',
    'trackers.submit', 'trackers.view_own', 'trackers.view_all',
    'tasks.view_own', 'tasks.view_all', 'tasks.assign', 'tasks.verify',
    'resources.view', 'resources.manage',
    'announcements.view', 'announcements.manage', 'notifications.send',
    'reports.view'
  )
  ON CONFLICT DO NOTHING;

  -- Member: participate, see own data
  SELECT id INTO v_role_id FROM public.roles WHERE org_id = p_org_id AND key = 'member';
  INSERT INTO public.role_permissions (role_id, permission_key)
  SELECT v_role_id, key FROM public.permissions WHERE key IN (
    'members.view', 'departments.view', 'hierarchy.view',
    'events.view', 'trackers.submit', 'trackers.view_own',
    'tasks.view_own', 'resources.view', 'announcements.view'
  )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Apply to every existing organization
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_roles(o.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. MIGRATE the old ENUM roles into real, editable role rows
-- ---------------------------------------------------------------------
-- Each legacy role becomes a genuine role the org can now rename or delete.

DO $$
DECLARE
  o         RECORD;
  r         RECORD;
  v_role_id UUID;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    FOR r IN
      SELECT * FROM (VALUES
        ('counsellor',       'Counsellor',       'Guides and reviews assigned members', 40, '#0891b2'),
        ('sadhana_incharge', 'Sadhana Incharge', 'Oversees practice tracking',          50, '#db2777'),
        ('dept_incharge',    'Dept. Incharge',   'Leads a department',                  45, '#f97316'),
        ('im',               'IM',               'Coordinates service allocation',      45, '#06b6d4'),
        ('kitchen_team',     'Kitchen Team',     'Plans and prepares meals',            30, '#f59e0b'),
        ('vmc',              'VMC',              'Senior management committee',         85, '#16a34a'),
        ('oc',               'OC',               'Operations committee',                85, '#4f46e5')
      ) AS t(key, name, description, priority, color)
    LOOP
      INSERT INTO public.roles (org_id, key, name, description, priority, color, is_system)
      VALUES (o.id, r.key, r.name, r.description, r.priority, r.color, FALSE)
      ON CONFLICT (org_id, key) DO NOTHING;
    END LOOP;

    -- Grant each legacy role a sensible permission set
    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'counsellor';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'mentorship.view_own', 'trackers.view_all', 'trackers.view_own',
      'trackers.submit', 'events.view', 'announcements.view', 'reports.view',
      'departments.view', 'hierarchy.view', 'tasks.view_own', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'sadhana_incharge';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'trackers.view_all', 'trackers.view_own', 'trackers.submit',
      'trackers.manage', 'mentorship.view_all', 'reports.view', 'reports.export',
      'events.view', 'announcements.view', 'departments.view', 'hierarchy.view',
      'tasks.view_own', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'dept_incharge';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'departments.view', 'departments.assign', 'hierarchy.view',
      'events.view', 'events.create', 'tasks.view_all', 'tasks.assign', 'tasks.verify',
      'trackers.submit', 'trackers.view_own', 'announcements.view', 'reports.view',
      'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'im';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'tasks.view_all', 'tasks.assign', 'tasks.manage', 'tasks.verify',
      'departments.view', 'hierarchy.view', 'events.view', 'trackers.submit',
      'trackers.view_own', 'announcements.view', 'reports.view', 'resources.view'
    ) ON CONFLICT DO NOTHING;

    SELECT id INTO v_role_id FROM public.roles WHERE org_id = o.id AND key = 'kitchen_team';
    INSERT INTO public.role_permissions (role_id, permission_key)
    SELECT v_role_id, key FROM public.permissions WHERE key IN (
      'members.view', 'resources.view', 'resources.manage', 'departments.view',
      'hierarchy.view', 'events.view', 'trackers.submit', 'trackers.view_own',
      'tasks.view_own', 'announcements.view'
    ) ON CONFLICT DO NOTHING;

    -- VMC and OC were treated as admins by the old is_admin()
    FOR r IN SELECT id FROM public.roles WHERE org_id = o.id AND key IN ('vmc', 'oc') LOOP
      INSERT INTO public.role_permissions (role_id, permission_key)
      SELECT r.id, key FROM public.permissions WHERE key NOT IN ('*', 'org.billing.manage')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. ASSIGN roles to existing members based on their old ENUM value
-- ---------------------------------------------------------------------

INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM public.memberships m
JOIN public.profiles p ON p.id = m.user_id AND p.org_id = m.org_id
JOIN public.roles    r ON r.org_id = m.org_id
                      AND r.key = CASE p.role::text
                                    WHEN 'admin'   THEN 'owner'
                                    WHEN 'devotee' THEN 'member'
                                    ELSE p.role::text
                                  END
ON CONFLICT DO NOTHING;

-- Safety net: anyone with no role at all gets the org default
INSERT INTO public.membership_roles (membership_id, role_id)
SELECT m.id, r.id
FROM public.memberships m
JOIN public.roles r ON r.org_id = m.org_id AND r.is_default
WHERE NOT EXISTS (
  SELECT 1 FROM public.membership_roles mr WHERE mr.membership_id = m.id
)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. PERMISSION RESOLUTION
-- ---------------------------------------------------------------------
-- my_permissions() does the join once; has_permission() is a cheap array
-- lookup. Both are STABLE so Postgres reuses the result within a statement,
-- which matters because RLS calls them per row.

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TEXT[]
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT rp.permission_key), ARRAY[]::TEXT[])
  FROM public.memberships m
  JOIN public.membership_roles mr ON mr.membership_id = m.id
  JOIN public.role_permissions rp ON rp.role_id = mr.role_id
  WHERE m.user_id = auth.uid()
    AND m.org_id  = public.current_org_id()
    AND m.status  = 'active';
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.my_permissions()) AS perm
    WHERE perm = p_key OR perm = '*'
  );
$$;

-- Any of the given permissions
CREATE OR REPLACE FUNCTION public.has_any_permission(p_keys TEXT[])
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(public.my_permissions()) AS perm
    WHERE perm = ANY(p_keys) OR perm = '*'
  );
$$;

GRANT EXECUTE ON FUNCTION public.my_permissions()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_permission(TEXT[])  TO authenticated;

-- Redefine the legacy is_admin() on top of permissions so every existing
-- policy keeps working while migration 24 swaps them over one by one.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.has_any_permission(ARRAY['org.settings.manage', 'members.manage']);
$$;

-- ---------------------------------------------------------------------
-- 7. New members automatically receive the org's default role
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id
  FROM public.roles WHERE org_id = NEW.org_id AND is_default
  LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_default_role ON public.memberships;
CREATE TRIGGER trg_assign_default_role
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

-- A newly created org gets its role set immediately
CREATE OR REPLACE FUNCTION public.seed_roles_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_roles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_roles_for_new_org ON public.organizations;
CREATE TRIGGER trg_seed_roles_for_new_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_roles_for_new_org();

-- ---------------------------------------------------------------------
-- 8. GUARDS — protect the org from locking itself out
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_system THEN
    RAISE EXCEPTION 'Role "%" is a system role and cannot be deleted. Rename it instead.', OLD.name;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.is_system AND NEW.is_system = FALSE THEN
    RAISE EXCEPTION 'Cannot remove system protection from role "%"', OLD.name;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_roles ON public.roles;
CREATE TRIGGER trg_protect_system_roles
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();

-- An org must always retain at least one member holding '*'
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       UUID;
  v_owner_count  INTEGER;
BEGIN
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m WHERE m.id = OLD.membership_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = OLD.role_id AND rp.permission_key = '*'
  ) THEN
    RETURN OLD;
  END IF;

  SELECT COUNT(DISTINCT mr.membership_id) INTO v_owner_count
  FROM public.membership_roles mr
  JOIN public.memberships m      ON m.id = mr.membership_id
  JOIN public.role_permissions rp ON rp.role_id = mr.role_id
  WHERE m.org_id = v_org_id AND rp.permission_key = '*';

  IF v_owner_count <= 1 THEN
    RAISE EXCEPTION 'Cannot remove the last owner of the organization';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_owner_removal ON public.membership_roles;
CREATE TRIGGER trg_prevent_last_owner_removal
  BEFORE DELETE ON public.membership_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_owner_removal();

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;

-- The catalog is public reference data
DROP POLICY IF EXISTS "permissions_select" ON public.permissions;
CREATE POLICY "permissions_select" ON public.permissions
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "roles_select" ON public.roles;
CREATE POLICY "roles_select" ON public.roles
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "roles_write" ON public.roles;
CREATE POLICY "roles_write" ON public.roles
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('roles.manage'));

DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.roles r
            WHERE r.id = role_id AND r.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "role_permissions_write" ON public.role_permissions;
CREATE POLICY "role_permissions_write" ON public.role_permissions
  FOR ALL USING (
    public.has_permission('roles.manage')
    AND EXISTS (SELECT 1 FROM public.roles r
                WHERE r.id = role_id AND r.org_id = public.current_org_id())
  );

DROP POLICY IF EXISTS "membership_roles_select" ON public.membership_roles;
CREATE POLICY "membership_roles_select" ON public.membership_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.memberships m
            WHERE m.id = membership_id
              AND (m.user_id = auth.uid() OR m.org_id = public.current_org_id()))
  );

DROP POLICY IF EXISTS "membership_roles_write" ON public.membership_roles;
CREATE POLICY "membership_roles_write" ON public.membership_roles
  FOR ALL USING (
    public.has_permission('roles.assign')
    AND EXISTS (SELECT 1 FROM public.memberships m
                WHERE m.id = membership_id AND m.org_id = public.current_org_id())
  );

-- ---------------------------------------------------------------------
-- 10. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_roles_updated_at ON public.roles;
CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 23_modules.sql

-- =====================================================================
-- 23. MODULE REGISTRY — Org-controlled features & navigation
-- =====================================================================
-- The sidebar is currently a hardcoded array, so every org sees Sadhana,
-- Kitchen and Cleanliness whether or not they use them.
--
--   modules              global catalog of installable features
--   organization_modules which are on for an org, in what order, named what
--
-- An org enables only what it needs, renames labels to its own vocabulary,
-- reorders navigation, and stores per-module config as JSONB. Adding a new
-- module later is one INSERT into the catalog — no core changes.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULE CATALOG (global)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.modules (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  icon                TEXT,      -- lucide icon name
  route               TEXT,      -- frontend path
  category            TEXT NOT NULL DEFAULT 'general',

  -- Permission a member needs before the nav item is shown to them
  required_permission TEXT REFERENCES public.permissions(key) ON DELETE SET NULL,

  -- Core modules cannot be disabled (an org always needs members + settings)
  is_core             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Enabled automatically for brand-new organizations
  default_enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  -- JSON Schema describing this module's config surface (for admin UI)
  config_schema       JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('dashboard',     'Dashboard',     'Overview and key metrics',                  'LayoutDashboard', '/',              'core',        NULL,                  TRUE,  TRUE,  0),
  ('members',       'Members',       'Member directory and profiles',             'Users',           '/members',       'core',        'members.view',        TRUE,  TRUE,  10),
  ('departments',   'Departments',   'Teams, departments and their members',      'Building2',       '/departments',   'structure',   'departments.view',    FALSE, TRUE,  20),
  ('hierarchy',     'Org Structure', 'Organization chart and reporting lines',    'GitBranch',       '/hierarchy',     'structure',   'hierarchy.view',      FALSE, TRUE,  30),
  ('events',        'Events',        'Calendar, programs and attendance',         'CalendarDays',    '/events',        'operations',  'events.view',         FALSE, TRUE,  40),
  ('trackers',      'Trackers',      'Recurring self-reported metrics & scoring', 'BookOpen',        '/trackers',      'operations',  'trackers.view_own',   FALSE, FALSE, 50),
  ('tasks',         'Tasks',         'Recurring assignments and duty rosters',    'ListChecks',      '/tasks',         'operations',  'tasks.view_own',      FALSE, FALSE, 60),
  ('resources',     'Resource Plans','Meal, inventory and resource planning',     'UtensilsCrossed', '/resources',     'operations',  'resources.view',      FALSE, FALSE, 70),
  ('mentorship',    'Mentorship',    'Mentor and mentee relationships',           'Users',           '/mentorship',    'people',      'mentorship.view_own', FALSE, FALSE, 80),
  ('announcements', 'Announcements', 'Org-wide posts and notices',                'Megaphone',       '/announcements', 'comms',       'announcements.view',  FALSE, TRUE,  90),
  ('notifications', 'Notifications', 'Personal notification inbox',               'Bell',            '/notifications', 'comms',       NULL,                  TRUE,  TRUE,  100),
  ('reports',       'Reports',       'Analytics, dashboards and exports',         'BarChart3',       '/reports',       'insights',    'reports.view',        FALSE, FALSE, 110),
  ('settings',      'Settings',      'Organization and personal settings',        'Settings',        '/settings',      'core',        NULL,                  TRUE,  TRUE,  120)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      is_core             = EXCLUDED.is_core,
      sort_order          = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. PER-ORGANIZATION MODULE STATE
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_modules (
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL REFERENCES public.modules(key)      ON DELETE CASCADE,

  enabled        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Org's own wording, e.g. trackers -> "Sadhana", members -> "Devotees"
  label_override TEXT,
  icon_override  TEXT,

  sort_order     INTEGER NOT NULL DEFAULT 0,

  -- Module-specific configuration
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (org_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_enabled
  ON public.organization_modules (org_id, enabled, sort_order);

-- ---------------------------------------------------------------------
-- 3. SEEDING
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_default_modules(p_org_id UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
  SELECT p_org_id, key, (default_enabled OR is_core), sort_order
  FROM public.modules
  ON CONFLICT (org_id, module_key) DO NOTHING;
$$;

-- Every existing org gets the full catalog at platform defaults
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_modules(o.id);
  END LOOP;
END $$;

-- New orgs are seeded automatically
CREATE OR REPLACE FUNCTION public.seed_modules_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_modules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_modules_for_new_org ON public.organizations;
CREATE TRIGGER trg_seed_modules_for_new_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_modules_for_new_org();

-- ---------------------------------------------------------------------
-- 4. SURABHIKUNJ: turn on the modules they actually use, in their words
-- ---------------------------------------------------------------------
-- Their existing feature set is expressed as configuration rather than as
-- platform defaults, which is exactly the point of this migration.

DO $$
DECLARE v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Sadhana',    icon_override = 'BookOpen'        WHERE org_id = v_org_id AND module_key = 'trackers';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Services',   icon_override = 'ListChecks'      WHERE org_id = v_org_id AND module_key = 'tasks';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Kitchen',    icon_override = 'UtensilsCrossed' WHERE org_id = v_org_id AND module_key = 'resources';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Counsellor', icon_override = 'Users'           WHERE org_id = v_org_id AND module_key = 'mentorship';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Residents'                                     WHERE org_id = v_org_id AND module_key = 'members';
  UPDATE public.organization_modules SET enabled = TRUE                                                                   WHERE org_id = v_org_id AND module_key = 'reports';
END $$;

-- ---------------------------------------------------------------------
-- 5. NAVIGATION RESOLVER
-- ---------------------------------------------------------------------
-- One call returns the caller's sidebar: enabled modules they have
-- permission to see, already labelled and ordered. Replaces the hardcoded
-- navItems array in Sidebar.jsx.

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
    COALESCE(om.label_override, m.name)  AS label,
    COALESCE(om.icon_override,  m.icon)  AS icon,
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

-- Is a module switched on for the caller's org? Used to guard routes and
-- to short-circuit queries against disabled features.
CREATE OR REPLACE FUNCTION public.module_enabled(p_module_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.organization_modules
     WHERE org_id = public.current_org_id() AND module_key = p_module_key),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.module_enabled(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. GUARD — core modules stay enabled
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_core_modules()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enabled = FALSE
     AND EXISTS (SELECT 1 FROM public.modules WHERE key = NEW.module_key AND is_core)
  THEN
    RAISE EXCEPTION 'Module "%" is core and cannot be disabled', NEW.module_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_core_modules ON public.organization_modules;
CREATE TRIGGER trg_protect_core_modules
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.protect_core_modules();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "modules_select" ON public.modules;
CREATE POLICY "modules_select" ON public.modules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "org_modules_select" ON public.organization_modules;
CREATE POLICY "org_modules_select" ON public.organization_modules
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "org_modules_write" ON public.organization_modules;
CREATE POLICY "org_modules_write" ON public.organization_modules
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.modules.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_org_modules_updated_at ON public.organization_modules;
CREATE TRIGGER trg_org_modules_updated_at
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 24_rls_rewrite.sql

-- =====================================================================
-- 24. RLS REWRITE — Policies driven by permissions, not role names
-- =====================================================================
-- Every policy written in 01_schema.sql / 05_app_policies.sql tests role
-- names directly, e.g.  get_my_role() IN ('counsellor','admin','vmc','oc').
-- That makes custom roles meaningless at the security layer: an org could
-- create a "Kitchen Head" role but the database would never honour it.
--
-- This migration re-expresses every policy in terms of has_permission(),
-- so a permission granted to ANY role — including one the org invented
-- five minutes ago — is enforced correctly.
--
-- Also introduces active-org switching, needed now that a user can belong
-- to more than one organization.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ACTIVE ORGANIZATION
-- ---------------------------------------------------------------------
-- With multi-org membership, "which org am I looking at right now?" must
-- be explicit. Resolution order:
--   1. profiles.active_org_id, if the user is still an active member there
--   2. their legacy profiles.org_id
--   3. their single active membership, if they only have one

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.profiles SET active_org_id = org_id
WHERE active_org_id IS NULL AND org_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.active_org_id
     FROM public.profiles p
     WHERE p.id = auth.uid()
       AND EXISTS (
         SELECT 1 FROM public.memberships m
         WHERE m.user_id = p.id AND m.org_id = p.active_org_id
           AND m.status = 'active'
       )),
    (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()),
    (SELECT m.org_id FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.status = 'active'
     ORDER BY m.joined_at NULLS LAST LIMIT 1)
  );
$$;

-- Switch the caller into another organization they belong to.
CREATE OR REPLACE FUNCTION public.switch_organization(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not an active member of that organization';
  END IF;

  UPDATE public.profiles
  SET active_org_id = p_org_id, updated_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.switch_organization(UUID) TO authenticated;

-- Organizations the caller can switch into (for an org picker UI).
CREATE OR REPLACE FUNCTION public.my_organizations()
RETURNS TABLE (
  org_id    UUID,
  name      TEXT,
  slug      TEXT,
  logo_url  TEXT,
  status    TEXT,
  is_active BOOLEAN
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, o.slug, o.logo_url, m.status,
         (o.id = public.current_org_id()) AS is_active
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY o.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_organizations() TO authenticated;

-- Organizations policy must allow seeing every org you belong to,
-- not only the active one (otherwise the switcher can't render).
DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.memberships m
            WHERE m.org_id = organizations.id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "organizations_update" ON public.organizations;
CREATE POLICY "organizations_update" ON public.organizations
  FOR UPDATE USING (
    id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 2. PROFILES  (global identity)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_select"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

-- Own row always; plus anyone who shares an organization with you.
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.memberships me
      JOIN public.memberships them ON them.org_id = me.org_id
      WHERE me.user_id = auth.uid() AND them.user_id = profiles.id
    )
  );

CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.has_permission('members.manage'));

-- ---------------------------------------------------------------------
-- 3. MEMBERSHIPS  (tightened from the placeholder in migration 21)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;

DROP POLICY IF EXISTS "memberships_update" ON public.memberships;
CREATE POLICY "memberships_update" ON public.memberships
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['members.manage', 'members.approve'])
  );

DROP POLICY IF EXISTS "memberships_insert_admin" ON public.memberships;
CREATE POLICY "memberships_insert_admin" ON public.memberships
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id() AND public.has_permission('members.invite')
  );

DROP POLICY IF EXISTS "memberships_delete" ON public.memberships;
CREATE POLICY "memberships_delete" ON public.memberships
  FOR DELETE USING (
    org_id = public.current_org_id() AND public.has_permission('members.remove')
  );

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('members.manage')
  );

-- ---------------------------------------------------------------------
-- 4. ORGANIZATION SETTINGS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.settings.manage')
  );

-- ---------------------------------------------------------------------
-- 5. DEPARTMENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "departments_select" ON public.departments;
CREATE POLICY "departments_select" ON public.departments
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('departments.view')
  );

DROP POLICY IF EXISTS "departments_write" ON public.departments;
CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('departments.manage')
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='department_members') THEN

    EXECUTE 'DROP POLICY IF EXISTS "department_members_select" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_select" ON public.department_members
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.departments d
                  WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;

    EXECUTE 'DROP POLICY IF EXISTS "department_members_write" ON public.department_members';
    EXECUTE $p$
      CREATE POLICY "department_members_write" ON public.department_members
        FOR ALL USING (
          public.has_any_permission(ARRAY['departments.manage','departments.assign'])
          AND EXISTS (SELECT 1 FROM public.departments d
                      WHERE d.id = department_id AND d.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. ORG POSITIONS (hierarchy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "org_positions_select" ON public.org_positions;
CREATE POLICY "org_positions_select" ON public.org_positions
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.view')
  );

DROP POLICY IF EXISTS "org_positions_write" ON public.org_positions;
CREATE POLICY "org_positions_write" ON public.org_positions
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('hierarchy.manage')
  );

-- ---------------------------------------------------------------------
-- 7. SADHANA REPORTS  (until the tracker primitive replaces them)
-- ---------------------------------------------------------------------
-- Previously: role IN ('counsellor','sadhana_incharge','admin','vmc','oc').
-- Now: anyone holding trackers.view_all, whatever their role is called.

DROP POLICY IF EXISTS "sadhana_select"     ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_insert_own" ON public.sadhana_reports;
DROP POLICY IF EXISTS "sadhana_update_own" ON public.sadhana_reports;

CREATE POLICY "sadhana_select" ON public.sadhana_reports
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.view_all'))
  );

CREATE POLICY "sadhana_insert" ON public.sadhana_reports
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (
      (profile_id = auth.uid() AND public.has_permission('trackers.submit'))
      OR public.has_permission('trackers.manage')
    )
  );

CREATE POLICY "sadhana_update" ON public.sadhana_reports
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

CREATE POLICY "sadhana_delete" ON public.sadhana_reports
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('trackers.manage'))
  );

DROP POLICY IF EXISTS "sadhana_config_select" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_select" ON public.sadhana_score_config
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "sadhana_config_write" ON public.sadhana_score_config;
CREATE POLICY "sadhana_config_write" ON public.sadhana_score_config
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('trackers.manage')
  );

-- ---------------------------------------------------------------------
-- 8. CLEANING  (until the task primitive replaces it)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "cleaning_areas_select" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_select" ON public.cleaning_areas
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "cleaning_areas_write" ON public.cleaning_areas;
CREATE POLICY "cleaning_areas_write" ON public.cleaning_areas
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "cleaning_logs_select" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_select" ON public.cleaning_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "cleaning_logs_insert" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_insert" ON public.cleaning_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.assign'))
  );

DROP POLICY IF EXISTS "cleaning_logs_update" ON public.cleaning_logs;
CREATE POLICY "cleaning_logs_update" ON public.cleaning_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.verify'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='cleaning_assignments') THEN
    EXECUTE 'ALTER TABLE public.cleaning_assignments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_select" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_select" ON public.cleaning_assignments
        FOR SELECT USING (
          EXISTS (SELECT 1 FROM public.cleaning_areas a
                  WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "cleaning_assignments_write" ON public.cleaning_assignments';
    EXECUTE $p$
      CREATE POLICY "cleaning_assignments_write" ON public.cleaning_assignments
        FOR ALL USING (
          public.has_any_permission(ARRAY['tasks.assign','tasks.manage'])
          AND EXISTS (SELECT 1 FROM public.cleaning_areas a
                      WHERE a.id = area_id AND a.org_id = public.current_org_id())
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 9. SERVICES  (until the task primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "services_select" ON public.services;
CREATE POLICY "services_select" ON public.services
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "services_write" ON public.services;
CREATE POLICY "services_write" ON public.services
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('tasks.manage')
  );

DROP POLICY IF EXISTS "service_allocations_select" ON public.service_allocations;
CREATE POLICY "service_allocations_select" ON public.service_allocations
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "service_allocations_write" ON public.service_allocations;
CREATE POLICY "service_allocations_write" ON public.service_allocations
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (
      profile_id = auth.uid()
      OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage','tasks.verify'])
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='service_preferences') THEN
    EXECUTE 'ALTER TABLE public.service_preferences ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_preferences_all" ON public.service_preferences';
    EXECUTE $p$
      CREATE POLICY "service_preferences_all" ON public.service_preferences
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('tasks.assign')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 10. MEAL PLANS  (until the resource primitive replaces them)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "meal_plans_select" ON public.meal_plans;
CREATE POLICY "meal_plans_select" ON public.meal_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "meal_plans_write" ON public.meal_plans;
CREATE POLICY "meal_plans_write" ON public.meal_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- ---------------------------------------------------------------------
-- 11. EVENTS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "events_select" ON public.events;
CREATE POLICY "events_select" ON public.events
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('events.view')
  );

DROP POLICY IF EXISTS "events_insert" ON public.events;
CREATE POLICY "events_insert" ON public.events
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['events.create','events.manage'])
  );

DROP POLICY IF EXISTS "events_write" ON public.events;
DROP POLICY IF EXISTS "events_update" ON public.events;
CREATE POLICY "events_update" ON public.events
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DROP POLICY IF EXISTS "events_delete" ON public.events;
CREATE POLICY "events_delete" ON public.events
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('events.manage'))
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='event_rsvp') THEN
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_select" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_select" ON public.event_rsvp
        FOR SELECT USING (
          profile_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.events e
                     WHERE e.id = event_id AND e.org_id = public.current_org_id()
                       AND public.has_permission('events.attendance'))
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "event_rsvp_write" ON public.event_rsvp';
    EXECUTE $p$
      CREATE POLICY "event_rsvp_write" ON public.event_rsvp
        FOR ALL USING (
          profile_id = auth.uid() OR public.has_permission('events.attendance')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 12. ANNOUNCEMENTS
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='announcements') THEN
    EXECUTE 'DROP POLICY IF EXISTS "announcements_select" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_select" ON public.announcements
        FOR SELECT USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.view')
        )
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "announcements_write" ON public.announcements';
    EXECUTE $p$
      CREATE POLICY "announcements_write" ON public.announcements
        FOR ALL USING (
          org_id = public.current_org_id()
          AND public.has_permission('announcements.manage')
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 13. NOTIFICATIONS
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (profile_id = auth.uid() OR public.has_permission('notifications.send'))
  );

-- ---------------------------------------------------------------------
-- 14. Retire the hardcoded role guard on profile updates
-- ---------------------------------------------------------------------
-- Role no longer lives on profiles; it lives in membership_roles, which has
-- its own policy. Approval moved to memberships.status. This trigger keeps
-- the legacy columns locked down while they still exist.

CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_permission(ARRAY['members.manage','roles.assign']) THEN
    NEW.role        := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.org_id      := OLD.org_id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 15. Signup: create a global identity only. No auto-join to any org.
-- ---------------------------------------------------------------------
-- Previously every new user was silently attached to Surabhikunj via
-- bootstrap_current_user_to_default_voice(). On a real platform, joining an
-- organization is an explicit act (invite, join code, or founding one).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, spiritual_name, email, is_approved)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
      NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    NEW.email,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Kept for backwards compatibility with the deployed bundle, but it is now
-- a no-op unless VITE_DEFAULT_VOICE_ID-style bootstrapping is deliberately
-- re-enabled by an operator.
CREATE OR REPLACE FUNCTION public.bootstrap_current_user_to_default_voice()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN;
END;
$$;


-- FILE: 25_trackers.sql

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


-- FILE: 26_tasks.sql

-- =====================================================================
-- 26. TASKS — Generic recurring assignment primitive
-- =====================================================================
-- Unifies `cleaning_areas`, `cleaning_assignments`, `cleaning_logs`,
-- `services`, `service_allocations`, and `service_preferences` under one
-- consistent model any organization can use for any kind of duty roster,
-- chore schedule, or service allocation.
--
-- Architecture:
--   task_categories   — org-defined groupings (e.g. "Cleaning", "Temple Service")
--   task_templates    — the reusable task itself (what, how long, recurrence)
--   task_areas        — physical or logical locations a task happens in
--   task_assignments  — who is assigned to a task/area in what window
--   task_logs         — per-day completion records
--   task_preferences  — a member's availability preferences per period
--
-- Legacy tables stay; they are migrated into this model.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TASK CATEGORIES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT DEFAULT 'ListChecks',
  color       TEXT DEFAULT '#64748b',
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_categories_org
  ON public.task_categories (org_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. TASK TEMPLATES
-- ---------------------------------------------------------------------
-- Describes a recurring task type. Actual assignments are generated from
-- these templates by managers.

CREATE TABLE IF NOT EXISTS public.task_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES public.task_categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  instructions    TEXT,
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  default_time    TIME,
  duration_min    INTEGER,
  recurrence      TEXT NOT NULL DEFAULT 'daily',  -- daily|weekly|monthly|custom
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.task_templates
  DROP CONSTRAINT IF EXISTS task_templates_recurrence_check;
ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_recurrence_check
  CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'custom', 'once'));

CREATE INDEX IF NOT EXISTS idx_task_templates_org
  ON public.task_templates (org_id, is_active);

-- ---------------------------------------------------------------------
-- 3. TASK AREAS
-- ---------------------------------------------------------------------
-- Optional physical/logical location for a task (cleaning area, worship
-- station, kitchen section, etc.). Tasks can exist without areas.

CREATE TABLE IF NOT EXISTS public.task_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  location    TEXT,           -- floor / building / section
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_areas_org
  ON public.task_areas (org_id, is_active);

-- ---------------------------------------------------------------------
-- 4. TASK ASSIGNMENTS
-- ---------------------------------------------------------------------
-- Assigns a member to a task (and optionally area) for a date window.

CREATE TABLE IF NOT EXISTS public.task_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES public.task_templates(id) ON DELETE CASCADE,
  area_id       UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_date     DATE NOT NULL,
  task_time     TIME,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique: one assignment per user per task per area per day
  UNIQUE (template_id, area_id, user_id, task_date)
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_org_date
  ON public.task_assignments (org_id, task_date, user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user
  ON public.task_assignments (user_id, task_date DESC);

-- ---------------------------------------------------------------------
-- 5. TASK LOGS
-- ---------------------------------------------------------------------
-- Completion record for an assignment on a given day.

CREATE TABLE IF NOT EXISTS public.task_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id  UUID REFERENCES public.task_assignments(id) ON DELETE CASCADE,

  -- Denormalized for queries that don't need the assignment
  template_id    UUID REFERENCES public.task_templates(id) ON DELETE SET NULL,
  area_id        UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  status         TEXT NOT NULL DEFAULT 'pending',
  verified_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at    TIMESTAMPTZ,
  notes          TEXT,
  marked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (assignment_id, log_date)
);

ALTER TABLE public.task_logs
  DROP CONSTRAINT IF EXISTS task_logs_status_check;
ALTER TABLE public.task_logs
  ADD CONSTRAINT task_logs_status_check
  CHECK (status IN ('pending', 'done', 'partial', 'missed', 'excused', 'verified'));

CREATE INDEX IF NOT EXISTS idx_task_logs_org_date
  ON public.task_logs (org_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_logs_user
  ON public.task_logs (user_id, log_date DESC);

-- ---------------------------------------------------------------------
-- 6. TASK PREFERENCES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  preference   INTEGER NOT NULL DEFAULT 1, -- 1=preferred, 0=ok, -1=avoid
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, template_id, period_start)
);

-- ---------------------------------------------------------------------
-- 7. SEED SURABHIKUNJ: create categories for Cleaning and Services
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id          UUID;
  v_cleaning_cat_id UUID;
  v_service_cat_id  UUID;
  v_tmpl_id         UUID;
  v_area_id         UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Categories
  INSERT INTO public.task_categories (org_id, name, icon, color, sort_order)
  VALUES
    (v_org_id, 'Cleanliness', 'Sparkles',   '#16a34a', 10),
    (v_org_id, 'Temple Service', 'ListChecks', '#f97316', 20)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_cleaning_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Cleanliness' LIMIT 1;
  SELECT id INTO v_service_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Temple Service' LIMIT 1;

  -- Migrate cleaning_areas → task_areas
  INSERT INTO public.task_areas (id, org_id, name, description, location, is_active)
  SELECT id, org_id, name, description, floor, is_active
  FROM public.cleaning_areas
  WHERE org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Create one template per cleaning area (simple 1-to-1 for backwards compat)
  FOR v_area_id IN
    SELECT id FROM public.task_areas WHERE org_id = v_org_id
  LOOP
    INSERT INTO public.task_templates (org_id, category_id, name, recurrence, is_active)
    SELECT v_org_id, v_cleaning_cat_id,
           (SELECT name FROM public.task_areas WHERE id = v_area_id),
           'daily', TRUE
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_tmpl_id;
  END LOOP;

  -- Migrate services → task_templates (service category)
  INSERT INTO public.task_templates
    (id, org_id, category_id, name, description, instructions,
     department_id, default_time, duration_min, recurrence, is_active)
  SELECT
    s.id, s.org_id, v_service_cat_id,
    s.name, s.description, s.instructions,
    s.department_id, s.default_time, s.duration_min,
    CASE WHEN s.is_recurring THEN 'daily' ELSE 'once' END,
    s.is_active
  FROM public.services s
  WHERE s.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Migrate cleaning_assignments → task_assignments (date = today for open-ended)
  INSERT INTO public.task_assignments
    (org_id, template_id, area_id, user_id, task_date)
  SELECT
    a.org_id,
    (SELECT tt.id FROM public.task_templates tt
     JOIN public.task_areas ta ON ta.name = (SELECT name FROM public.task_areas WHERE id = ca.area_id)
     WHERE tt.org_id = a.org_id AND tt.name = ta.name LIMIT 1),
    ca.area_id,
    ca.profile_id,
    COALESCE(ca.assigned_from, CURRENT_DATE)
  FROM public.cleaning_assignments ca
  JOIN public.cleaning_areas a ON a.id = ca.area_id
  WHERE a.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate cleaning_logs → task_logs
  INSERT INTO public.task_logs
    (org_id, area_id, user_id, log_date, status, notes, marked_at)
  SELECT
    cl.org_id, cl.area_id, cl.profile_id, cl.log_date,
    CASE cl.status
      WHEN 'done'     THEN 'done'
      WHEN 'partial'  THEN 'partial'
      WHEN 'not_done' THEN 'missed'
      ELSE 'pending'
    END,
    cl.notes, cl.marked_at
  FROM public.cleaning_logs cl
  WHERE cl.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate service_allocations → task_assignments + task_logs
  INSERT INTO public.task_assignments
    (id, org_id, template_id, user_id, assigned_by, task_date, task_time, notes)
  SELECT
    sa.id, sa.org_id, sa.service_id, sa.profile_id, sa.allocated_by,
    sa.service_date, sa.service_time, sa.notes
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.task_logs
    (org_id, assignment_id, template_id, user_id, log_date, status, notes, marked_at)
  SELECT
    sa.org_id, sa.id, sa.service_id, sa.profile_id, sa.service_date,
    CASE sa.status
      WHEN 'done'    THEN 'done'
      WHEN 'missed'  THEN 'missed'
      WHEN 'excused' THEN 'excused'
      ELSE 'pending'
    END,
    sa.notes, sa.updated_at
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id AND sa.status IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Migrate service_preferences → task_preferences
  INSERT INTO public.task_preferences
    (user_id, template_id, period_start, preference)
  SELECT profile_id, service_id, week_start, preference
  FROM public.service_preferences
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.task_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_areas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_categories_select" ON public.task_categories;
CREATE POLICY "task_categories_select" ON public.task_categories
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_categories_write" ON public.task_categories;
CREATE POLICY "task_categories_write" ON public.task_categories
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_templates_select" ON public.task_templates;
CREATE POLICY "task_templates_select" ON public.task_templates
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "task_templates_write" ON public.task_templates;
CREATE POLICY "task_templates_write" ON public.task_templates
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_areas_select" ON public.task_areas;
CREATE POLICY "task_areas_select" ON public.task_areas
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_areas_write" ON public.task_areas;
CREATE POLICY "task_areas_write" ON public.task_areas
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_assignments_select" ON public.task_assignments;
CREATE POLICY "task_assignments_select" ON public.task_assignments
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_assignments_write" ON public.task_assignments;
CREATE POLICY "task_assignments_write" ON public.task_assignments
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_select" ON public.task_logs;
CREATE POLICY "task_logs_select" ON public.task_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_logs_insert" ON public.task_logs;
CREATE POLICY "task_logs_insert" ON public.task_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_update" ON public.task_logs;
CREATE POLICY "task_logs_update" ON public.task_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.verify','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_preferences_all" ON public.task_preferences;
CREATE POLICY "task_preferences_all" ON public.task_preferences
  FOR ALL USING (
    user_id = auth.uid() OR public.has_permission('tasks.assign')
  );

-- ---------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_task_templates_updated_at ON public.task_templates;
CREATE TRIGGER trg_task_templates_updated_at
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_task_assignments_updated_at ON public.task_assignments;
CREATE TRIGGER trg_task_assignments_updated_at
  BEFORE UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 27_resources.sql

-- =====================================================================
-- 27. RESOURCES — Generic planning primitive
-- =====================================================================
-- Generalises `meal_plans` into a flexible planning engine for any
-- resource an organization wants to schedule: food menus, inventory
-- allocation, equipment booking, room reservations, prasad distribution,
-- budget line items, etc.
--
-- Architecture:
--   resource_types     — org-defined categories (Meal, Room, Equipment…)
--   resource_plans     — a scheduled plan for one resource type on one date
--   resource_plan_items— the individual items (dishes, quantities, notes)
--
-- Surabhikunj's meal_plans are migrated into this model.
-- The old table remains for the current bundle; it is deprecated in
-- the contract phase.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RESOURCE TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                  -- "Meal Plan", "Room Booking"
  icon        TEXT DEFAULT 'UtensilsCrossed',
  color       TEXT DEFAULT '#f59e0b',
  description TEXT,

  -- Period controls how one plan covers: 'day' | 'week' | 'month'
  period      TEXT NOT NULL DEFAULT 'day',

  -- Free-form labels for sub-types within a plan (meal types, time slots…)
  -- e.g. ["Breakfast", "Lunch", "Dinner"]
  slots       TEXT[] NOT NULL DEFAULT '{}',

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.resource_types
  DROP CONSTRAINT IF EXISTS resource_types_period_check;
ALTER TABLE public.resource_types
  ADD CONSTRAINT resource_types_period_check
  CHECK (period IN ('day', 'week', 'month'));

CREATE INDEX IF NOT EXISTS idx_resource_types_org
  ON public.resource_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. RESOURCE PLANS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_type_id UUID NOT NULL REFERENCES public.resource_types(id) ON DELETE CASCADE,
  plan_date       DATE NOT NULL,
  slot            TEXT,           -- e.g. "Lunch" — must match one of resource_types.slots
  title           TEXT,           -- optional human label
  notes           TEXT,
  is_special      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, resource_type_id, plan_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_resource_plans_org_date
  ON public.resource_plans (org_id, resource_type_id, plan_date);

-- ---------------------------------------------------------------------
-- 3. RESOURCE PLAN ITEMS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plan_items (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id  UUID NOT NULL REFERENCES public.resource_plans(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,             -- dish name, item name, quantity label
  quantity TEXT,                      -- "500 g", "2 trays", free-form
  notes    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_resource_plan_items_plan
  ON public.resource_plan_items (plan_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Meal Plan resource type + migrate meal_plans
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_type_id    UUID;
  v_plan_id    UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Create the Meal Plan resource type
  INSERT INTO public.resource_types (org_id, name, icon, color, period, slots)
  VALUES (
    v_org_id,
    'Meal Plan',
    'UtensilsCrossed',
    '#f59e0b',
    'day',
    ARRAY['Breakfast', 'Lunch', 'Dinner', 'Special Prasad']
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.resource_types WHERE org_id = v_org_id AND name = 'Meal Plan' LIMIT 1;
  END IF;

  -- Migrate meal_plans → resource_plans + resource_plan_items
  FOR v_plan_id IN
    INSERT INTO public.resource_plans
      (org_id, resource_type_id, plan_date, slot, notes, is_special, created_by, created_at, updated_at)
    SELECT
      m.org_id,
      v_type_id,
      m.plan_date,
      CASE m.meal_type::text
        WHEN 'breakfast'     THEN 'Breakfast'
        WHEN 'lunch'         THEN 'Lunch'
        WHEN 'dinner'        THEN 'Dinner'
        WHEN 'prasad_special' THEN 'Special Prasad'
        ELSE m.meal_type::text
      END,
      m.notes,
      m.is_special,
      m.created_by,
      m.created_at,
      m.updated_at
    FROM public.meal_plans m
    WHERE m.org_id = v_org_id
    ON CONFLICT (org_id, resource_type_id, plan_date, slot) DO NOTHING
    RETURNING id
  LOOP
    -- Create one item per menu entry
    INSERT INTO public.resource_plan_items (plan_id, name, sort_order)
    SELECT
      v_plan_id,
      unnest_item,
      row_number() OVER ()
    FROM (
      SELECT unnest(mp.menu_items) AS unnest_item
      FROM public.meal_plans mp
      JOIN public.resource_plans rp ON rp.id = v_plan_id
      WHERE mp.org_id = v_org_id
        AND mp.plan_date = rp.plan_date
    ) sub
    WHERE unnest_item IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.resource_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resource_types_select" ON public.resource_types;
CREATE POLICY "resource_types_select" ON public.resource_types
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_types_write" ON public.resource_types;
CREATE POLICY "resource_types_write" ON public.resource_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

DROP POLICY IF EXISTS "resource_plans_select" ON public.resource_plans;
CREATE POLICY "resource_plans_select" ON public.resource_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_plans_write" ON public.resource_plans;
CREATE POLICY "resource_plans_write" ON public.resource_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- Items inherit from plans
DROP POLICY IF EXISTS "resource_plan_items_select" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_select" ON public.resource_plan_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
        AND public.has_permission('resources.view')
    )
  );

DROP POLICY IF EXISTS "resource_plan_items_write" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_write" ON public.resource_plan_items
  FOR ALL USING (
    public.has_permission('resources.manage')
    AND EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_resource_plans_updated_at ON public.resource_plans;
CREATE TRIGGER trg_resource_plans_updated_at
  BEFORE UPDATE ON public.resource_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 28_mentorship.sql

-- =====================================================================
-- 28. MENTORSHIP — Generic relationship primitive
-- =====================================================================
-- Replaces the single `profiles.counsellor_id` FK with a typed,
-- versioned, many-to-one (or many-to-many) relationship model any
-- organization can use for:
--   spiritual counsellor / devotee (Surabhikunj)
--   manager / employee
--   senior volunteer / junior volunteer
--   teacher / student
--   buddy / new member
--
-- Architecture:
--   mentorship_types         — org-defined relationship types
--   mentorship_relationships — the actual links (mentor ↔ mentee)
--
-- Existing counsellor_id FK values are migrated.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MENTORSHIP TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                    -- "Counsellor", "Buddy"
  mentor_label     TEXT NOT NULL DEFAULT 'Mentor',   -- label for the mentor side
  mentee_label     TEXT NOT NULL DEFAULT 'Mentee',   -- label for the mentee side
  description      TEXT,
  icon             TEXT DEFAULT 'Users',
  color            TEXT DEFAULT '#0891b2',

  -- Maximum mentees a single mentor can hold (NULL = unlimited)
  max_mentees      INTEGER,

  -- Whether the org enforces a 1-mentor limit per mentee for this type
  exclusive        BOOLEAN NOT NULL DEFAULT TRUE,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_types_org
  ON public.mentorship_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. MENTORSHIP RELATIONSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_relationships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type_id     UUID NOT NULL REFERENCES public.mentorship_types(id) ON DELETE CASCADE,
  mentor_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, type_id, mentee_id)   -- exclusive: one mentor per mentee per type
);

ALTER TABLE public.mentorship_relationships
  DROP CONSTRAINT IF EXISTS mentorship_relationships_status_check;
ALTER TABLE public.mentorship_relationships
  ADD CONSTRAINT mentorship_relationships_status_check
  CHECK (status IN ('active', 'ended', 'paused'));

CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentor
  ON public.mentorship_relationships (mentor_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentee
  ON public.mentorship_relationships (mentee_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_org
  ON public.mentorship_relationships (org_id, type_id, status);

-- ---------------------------------------------------------------------
-- 3. GUARD — mentor cannot be their own mentee
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_self_mentorship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mentor_id = NEW.mentee_id THEN
    RAISE EXCEPTION 'A member cannot be their own mentor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_mentorship ON public.mentorship_relationships;
CREATE TRIGGER trg_prevent_self_mentorship
  BEFORE INSERT OR UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_mentorship();

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Counsellor type + migrate counsellor_id
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id  UUID;
  v_type_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.mentorship_types
    (org_id, name, mentor_label, mentee_label, description, icon, color,
     max_mentees, exclusive, sort_order)
  VALUES
    (v_org_id, 'Counsellor', 'Counsellor', 'Counsellee',
     'Spiritual guidance and sadhana review',
     'Users', '#0891b2', NULL, TRUE, 10)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.mentorship_types WHERE org_id = v_org_id AND name = 'Counsellor' LIMIT 1;
  END IF;

  -- Migrate profiles.counsellor_id → mentorship_relationships
  INSERT INTO public.mentorship_relationships
    (org_id, type_id, mentor_id, mentee_id, status)
  SELECT
    v_org_id,
    v_type_id,
    counsellor_id,
    id,
    'active'
  FROM public.profiles
  WHERE org_id = v_org_id
    AND counsellor_id IS NOT NULL
    AND counsellor_id <> id
  ON CONFLICT (org_id, type_id, mentee_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 5. SYNC TRIGGER — keep the legacy counsellor_id column in sync
-- ---------------------------------------------------------------------
-- During the expand phase, some code still reads profiles.counsellor_id.
-- Any write to mentorship_relationships mirrors back.

CREATE OR REPLACE FUNCTION public.sync_counsellor_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_counsellor_type BOOLEAN;
BEGIN
  SELECT name = 'Counsellor' INTO v_is_counsellor_type
  FROM public.mentorship_types WHERE id = COALESCE(NEW.type_id, OLD.type_id);

  IF NOT v_is_counsellor_type THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status <> 'active') THEN
    UPDATE public.profiles
    SET counsellor_id = NULL, updated_at = NOW()
    WHERE id = OLD.mentee_id AND counsellor_id = OLD.mentor_id;
  ELSE
    UPDATE public.profiles
    SET counsellor_id = NEW.mentor_id, updated_at = NOW()
    WHERE id = NEW.mentee_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_counsellor_id ON public.mentorship_relationships;
CREATE TRIGGER trg_sync_counsellor_id
  AFTER INSERT OR UPDATE OF mentor_id, mentee_id, status OR DELETE
  ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.sync_counsellor_id();

-- ---------------------------------------------------------------------
-- 6. HELPERS
-- ---------------------------------------------------------------------

-- Mentees the caller mentors, with their latest tracker scores
CREATE OR REPLACE FUNCTION public.my_mentees(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentee_id   UUID,
  type_id     UUID,
  type_name   TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentee_id, mr.type_id, mt.name, mr.status, mr.started_at
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  WHERE mr.mentor_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name, mr.started_at;
$$;

-- Who mentors the caller
CREATE OR REPLACE FUNCTION public.my_mentor(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentor_id     UUID,
  type_id       UUID,
  type_name     TEXT,
  status        TEXT,
  started_at    TIMESTAMPTZ,
  mentor_name   TEXT,
  mentor_avatar TEXT,
  mentor_phone  TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentor_id, mr.type_id, mt.name, mr.status, mr.started_at,
         p.spiritual_name, p.avatar_url, p.phone
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  JOIN public.profiles p           ON p.id  = mr.mentor_id
  WHERE mr.mentee_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_mentees(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_mentor(UUID)  TO authenticated;

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.mentorship_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_types_select" ON public.mentorship_types;
CREATE POLICY "mentorship_types_select" ON public.mentorship_types
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "mentorship_types_write" ON public.mentorship_types;
CREATE POLICY "mentorship_types_write" ON public.mentorship_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('mentorship.manage')
  );

-- A mentee sees their own relationship; a mentor sees their mentees;
-- admins with mentorship.view_all see everything.
DROP POLICY IF EXISTS "mentorship_rels_select" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_select" ON public.mentorship_relationships
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      mentee_id = auth.uid()
      OR mentor_id = auth.uid()
      OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
    )
  );

DROP POLICY IF EXISTS "mentorship_rels_write" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_write" ON public.mentorship_relationships
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('mentorship.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_mentorship_rels_updated_at ON public.mentorship_relationships;
CREATE TRIGGER trg_mentorship_rels_updated_at
  BEFORE UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


-- FILE: 29_contract_phase.sql

-- =====================================================================
-- 29. CONTRACT PHASE — Remove expand-phase shims & legacy domain tables
-- =====================================================================
-- PREREQUISITES: Migrations 20-28 must be applied AND verified.
-- All data in legacy tables has already been migrated to primitives.
--
-- Run only after:
--   1. Confirming tracker_entries has rows migrated from sadhana_reports
--   2. Confirming task_logs has rows migrated from cleaning_logs / service_allocations
--   3. Confirming resource_plans has rows migrated from meal_plans
--   4. Confirming mentorship_relationships has rows migrated from counsellor_id links
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. SAFETY CHECKS
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'tracker_definitions') THEN
    RAISE EXCEPTION 'Migration 25 (trackers) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'task_templates') THEN
    RAISE EXCEPTION 'Migration 26 (tasks) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'resource_types') THEN
    RAISE EXCEPTION 'Migration 27 (resources) has not been applied. Aborting.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'mentorship_relationships') THEN
    RAISE EXCEPTION 'Migration 28 (mentorship) has not been applied. Aborting.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Drop backward-compat voices VIEW (shim from migration 20)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.voices;

-- ---------------------------------------------------------------------
-- 2. Drop profiles.counsellor_id (migrated to mentorship_relationships)
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_profiles_counsellor_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS counsellor_id;

-- The expand-phase trigger that synced profiles.counsellor_id must go too,
-- or every write to mentorship_relationships will error after the column is gone.
DROP TRIGGER IF EXISTS trg_sync_counsellor_id ON public.mentorship_relationships;
DROP FUNCTION IF EXISTS public.sync_counsellor_id();

-- ---------------------------------------------------------------------
-- 3. Drop legacy domain tables BEFORE altering profiles.role
--    Some legacy tables have RLS policies that reference profiles.role
--    (e.g., hearing_sources_modify). Dropping them first lets the
--    ALTER TYPE below succeed. CASCADE handles any stray FK references.
-- ---------------------------------------------------------------------

-- Sadhana / sources / scoring — all migrated to trackers
DROP TABLE IF EXISTS public.sadhana_reports          CASCADE;
DROP TABLE IF EXISTS public.sadhana_score_config     CASCADE;
DROP TABLE IF EXISTS public.sadhana_scoring_rules    CASCADE;
DROP TABLE IF EXISTS public.sadhana_config           CASCADE;
DROP TABLE IF EXISTS public.weekly_sadhana_reports   CASCADE;
DROP TABLE IF EXISTS public.hearing_sources          CASCADE;
DROP TABLE IF EXISTS public.reading_types            CASCADE;

-- Cleanliness → Tasks primitive
DROP TABLE IF EXISTS public.cleaning_logs            CASCADE;
DROP TABLE IF EXISTS public.cleaning_assignments     CASCADE;
DROP TABLE IF EXISTS public.cleaning_areas           CASCADE;

-- IM Services → Tasks primitive
DROP TABLE IF EXISTS public.service_preferences      CASCADE;
DROP TABLE IF EXISTS public.service_allocations      CASCADE;
DROP TABLE IF EXISTS public.services                 CASCADE;

-- Kitchen → Resources primitive
DROP TABLE IF EXISTS public.meal_plans               CASCADE;

-- ---------------------------------------------------------------------
-- 4. Convert profiles.role from user_role ENUM to TEXT
--    Values stay identical; this allows dropping the enum below.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'role'
      AND udt_name = 'user_role'
  ) THEN
    ALTER TABLE public.profiles ALTER COLUMN role TYPE TEXT USING role::TEXT;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Drop legacy ENUM types (safe now that all using columns are TEXT/gone)
-- ---------------------------------------------------------------------
DROP TYPE IF EXISTS public.user_role     CASCADE;
DROP TYPE IF EXISTS public.meal_type     CASCADE;
DROP TYPE IF EXISTS public.service_status CASCADE;
DROP TYPE IF EXISTS public.cleaning_status CASCADE;
DROP TYPE IF EXISTS public.scoring_rule_type CASCADE;
-- event_type and hierarchy_level still used by active tables — NOT dropped.

-- ---------------------------------------------------------------------
-- 6. Rewrite RLS policies that still call is_admin() / get_my_role()
--    (migration 24 rewrote most; these are any that slipped through)
-- ---------------------------------------------------------------------

-- organization_settings: was is_admin()
DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- organizations
DROP POLICY IF EXISTS "organizations_write" ON public.organizations;
CREATE POLICY "organizations_write" ON public.organizations
  FOR ALL USING (
    id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- departments
DROP POLICY IF EXISTS "departments_write" ON public.departments;
CREATE POLICY "departments_write" ON public.departments
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['departments.manage', 'org.manage_settings'])
  );

-- org_positions
DROP POLICY IF EXISTS "org_positions_write" ON public.org_positions;
CREATE POLICY "org_positions_write" ON public.org_positions
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('org.manage_settings')
  );

-- profiles update: was is_admin()
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (
    id = auth.uid()
    OR public.has_permission('members.manage')
  );

-- events write: was is_admin()
DROP POLICY IF EXISTS "events_write" ON public.events;
CREATE POLICY "events_write" ON public.events
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['events.manage', 'org.manage_settings'])
  );

-- announcements write/update/delete (was get_my_voice_id() / is_admin())
DROP POLICY IF EXISTS "announcements_select" ON public.announcements;
CREATE POLICY "announcements_select" ON public.announcements
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "announcements_update" ON public.announcements;
CREATE POLICY "announcements_update" ON public.announcements
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('announcements.manage')
  );

DROP POLICY IF EXISTS "announcements_delete" ON public.announcements;
CREATE POLICY "announcements_delete" ON public.announcements
  FOR DELETE USING (
    org_id = public.current_org_id()
    AND public.has_permission('announcements.manage')
  );

-- notifications update/delete (was get_my_voice_id() / is_admin())
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (
    profile_id = auth.uid() AND org_id = public.current_org_id()
  );

DROP POLICY IF EXISTS "notifications_update_self" ON public.notifications;
CREATE POLICY "notifications_update_self" ON public.notifications
  FOR UPDATE USING (
    profile_id = auth.uid() AND org_id = public.current_org_id()
  );

-- ---------------------------------------------------------------------
-- 7. Drop legacy helper functions (now fully replaced)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_voice_id();
DROP FUNCTION IF EXISTS public.get_my_role();
DROP FUNCTION IF EXISTS public.is_admin();
DROP FUNCTION IF EXISTS public.update_sadhana_config_timestamp();

-- ---------------------------------------------------------------------
-- 8. Update handle_new_user() — role is now TEXT, email should be stored
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spiritual TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_display   TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    v_spiritual
  );
BEGIN
  -- Write only the columns that actually exist so sign-ups survive partial migrations.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='display_name')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, display_name, spiritual_name, email, role)
    VALUES (NEW.id, v_display, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, spiritual_name, email, role)
    VALUES (NEW.id, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, spiritual_name, role)
    VALUES (NEW.id, v_spiritual, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Clean up any remaining indexes named after old columns
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_sadhana_reports_org_date;
DROP INDEX IF EXISTS public.idx_sadhana_reports_profile_date;
DROP INDEX IF EXISTS public.idx_cleaning_logs_org_date;
DROP INDEX IF EXISTS public.idx_cleaning_logs_area_date;
DROP INDEX IF EXISTS public.idx_service_allocations_date;
DROP INDEX IF EXISTS public.idx_service_allocations_profile;
DROP INDEX IF EXISTS public.idx_meal_plans_date;

-- ---------------------------------------------------------------------
-- 10. Final status notice
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 29 complete. Legacy tables and shims removed.';
  RAISE NOTICE 'Active tables: organizations, profiles, memberships, roles, permissions,';
  RAISE NOTICE '  role_permissions, membership_roles, modules, module_configs,';
  RAISE NOTICE '  departments, org_positions, events, notifications, announcements,';
  RAISE NOTICE '  push_subscriptions, device_tokens,';
  RAISE NOTICE '  tracker_definitions, tracker_fields, tracker_scoring_rules,';
  RAISE NOTICE '  tracker_entries, tracker_field_values,';
  RAISE NOTICE '  task_categories, task_templates, task_areas, task_assignments, task_logs, task_preferences,';
  RAISE NOTICE '  resource_types, resource_plans, resource_plan_items,';
  RAISE NOTICE '  mentorship_types, mentorship_relationships.';
END $$;


-- FILE: 30_onboarding.sql

-- =====================================================================
-- 30. ONBOARDING — Founding and joining an organization
-- =====================================================================
-- Migration 24 removed the implicit "every signup joins the default VOICE"
-- behaviour and documented that joining should become an explicit act:
-- "invite, join code, or founding one". None of those were ever built, so a
-- brand-new signup landed in a dead end: no membership -> my_organizations()
-- returns nothing -> the app has no org context and no way to obtain one.
--
-- This migration supplies the two missing entry points:
--
--   create_organization()       found a new org, become its owner
--   join_organization_by_code() request to join an existing org
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JOIN CODE — the shareable token members use to find an org
-- ---------------------------------------------------------------------
-- Short, uppercase, unambiguous alphabet (no O/0, I/1) so it can be read
-- aloud or printed on a noticeboard without transcription errors.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS join_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_i        INTEGER;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..7 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill any org created before this migration
UPDATE public.organizations
SET join_code = public.generate_join_code()
WHERE join_code IS NULL;

ALTER TABLE public.organizations ALTER COLUMN join_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_join_code
  ON public.organizations (join_code);

-- ---------------------------------------------------------------------
-- 2. CREATE ORGANIZATION — the founder path
-- ---------------------------------------------------------------------
-- SECURITY DEFINER because the caller has no membership yet and therefore
-- cannot satisfy any org-scoped RLS policy. Everything it writes is keyed
-- to auth.uid(), so a caller can only ever enrol themselves.

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_locale   TEXT DEFAULT 'en-IN'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. JOIN BY CODE — the member path
-- ---------------------------------------------------------------------
-- Creates a membership. Whether it is immediately usable depends on the
-- org's own policy: organization_settings.features.requireApproval. When
-- approval is required the membership starts 'pending' and an admin with
-- members.approve promotes it; otherwise the member is active at once.

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
  FROM public.organizations o
  WHERE o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM public.memberships m
  WHERE m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO v_requires
  FROM public.organization_settings s
  WHERE s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT id INTO v_default_role
  FROM public.roles
  WHERE org_id = v_org.id AND is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles
    SET active_org_id = v_org.id,
        org_id        = COALESCE(org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. PENDING MEMBERSHIPS — so the UI can explain the wait
-- ---------------------------------------------------------------------
-- my_organizations() deliberately lists active memberships only. Without
-- this the onboarding screen cannot distinguish "you have not joined
-- anything" from "you are waiting to be approved".

CREATE OR REPLACE FUNCTION public.my_pending_memberships()
RETURNS TABLE (org_id UUID, org_name TEXT, requested_at TIMESTAMPTZ)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, m.created_at
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'pending'
  ORDER BY m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.my_pending_memberships() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. APPROVE / REJECT a pending membership
-- ---------------------------------------------------------------------
-- Gated on members.approve so any org-defined role carrying that
-- permission can act, not just a hardcoded admin role name.

CREATE OR REPLACE FUNCTION public.approve_membership(
  p_user_id UUID,
  p_approve BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.current_org_id();
BEGIN
  IF NOT public.has_permission('members.approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve members';
  END IF;

  IF p_approve THEN
    UPDATE public.memberships
    SET status = 'active', joined_at = COALESCE(joined_at, NOW()), updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;

    UPDATE public.profiles
    SET is_approved = TRUE, updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.memberships
    SET status = 'left', updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_membership(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Let a signed-in user with no membership read an org's public shell
-- ---------------------------------------------------------------------
-- Needed so the join screen can confirm "you are about to join <name>".
-- Exposes nothing beyond name/slug for a code the caller already holds.

CREATE OR REPLACE FUNCTION public.peek_organization(p_code TEXT)
RETURNS TABLE (org_name TEXT, member_count BIGINT)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.name,
         (SELECT count(*) FROM public.memberships m
          WHERE m.org_id = o.id AND m.status = 'active')
  FROM public.organizations o
  WHERE o.join_code = upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    AND o.status = 'active'
    AND auth.uid() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.peek_organization(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ORG MEMBER DIRECTORY — driven by memberships, not profiles.org_id
-- ---------------------------------------------------------------------
-- The members screen used to filter profiles by org_id. Since joining is now
-- recorded in `memberships`, and a pending member deliberately has no
-- profiles.org_id yet, that query cannot see join requests at all. This RPC
-- makes membership the source of truth so pending members are visible and
-- therefore approvable.

CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
  status         TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id,
         COALESCE(m.display_name, p.display_name),
         p.spiritual_name,
         p.legal_name,
         p.email,
         p.avatar_url,
         p.role,
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Status notice
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 30 complete: organizations can now be founded and joined.';
  RAISE NOTICE 'Existing org join codes:';
END $$;

SELECT name, slug, join_code FROM public.organizations ORDER BY created_at;


-- FILE: 31_fix_handle_new_user.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spiritual TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_display   TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    v_spiritual
  );
BEGIN
  -- Write only the columns that actually exist so sign-ups survive partial migrations.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='display_name')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, display_name, spiritual_name, email, role)
    VALUES (NEW.id, v_display, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, spiritual_name, email, role)
    VALUES (NEW.id, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, spiritual_name, role)
    VALUES (NEW.id, v_spiritual, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- Drop the pre-RBAC create_organization(TEXT,TEXT,TEXT,TEXT) overload from
-- migration 20. Migration 30 defined a new create_organization(TEXT,TEXT,TEXT)
-- (different arg count/names) but Postgres treats that as an overload, not a
-- replacement, so both now exist. PostgREST cannot pick between them when the
-- app calls create_organization with only p_name, and fails with PGRST203
-- ("Could not choose the best candidate function"). The 20_platform_core
-- version also predates memberships/roles/join_code, so it must not win.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_organization(TEXT, TEXT, TEXT, TEXT);


-- FILE: 32_fix_member_management.sql

-- =====================================================================
-- 32. FIX MEMBER MANAGEMENT
-- =====================================================================
-- MembersPage.jsx lets an admin pick a role for a member from the org's
-- `roles` table, then saved that choice by writing profiles.role (the
-- legacy free-text column). Since migration 22, actual access control is
-- resolved from membership_roles / role_permissions, not profiles.role, so
-- every "role change" made through that screen was a silent no-op: the
-- dropdown looked like it worked, nothing about the member's real
-- permissions ever changed.
--
-- This migration:
--   1. Extends org_members() to also report each member's current RBAC
--      role (role_id/role_name), so the UI can show what is actually true.
--   2. Adds set_member_role(), which writes membership_roles instead of
--      the dead profiles.role column.
--   3. Aligns the "members" module's required_permission with the
--      members.manage the /members route already demands, so a member who
--      cannot use the page never sees it in navigation and gets silently
--      bounced back to "/" after clicking it.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. org_members() — report each member's actual RBAC role too
-- ---------------------------------------------------------------------
-- DROP required because we're adding columns to the return type; Postgres
-- does not allow CREATE OR REPLACE to change a function's return signature.

DROP FUNCTION IF EXISTS public.org_members();

CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
  role_id        UUID,
  role_name      TEXT,
  status         TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id,
         COALESCE(m.display_name, p.display_name),
         p.spiritual_name,
         p.legal_name,
         p.email,
         p.avatar_url,
         p.role,
         top_role.role_id,
         top_role.role_name,
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN LATERAL (
    SELECT r.id AS role_id, r.name AS role_name
    FROM public.membership_roles mr
    JOIN public.roles r ON r.id = mr.role_id
    WHERE mr.membership_id = m.id
    ORDER BY r.priority DESC
    LIMIT 1
  ) top_role ON TRUE
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. set_member_role() — the write path org_members() was missing
-- ---------------------------------------------------------------------
-- Replaces whatever role(s) the membership currently holds with a single
-- chosen one. Demoting the organization's last '*' holder is blocked by
-- trg_prevent_last_owner_removal (fires on the DELETE below).

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_role_id UUID
)
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

  SELECT id INTO v_membership
  FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'That role does not belong to this organization';
  END IF;

  DELETE FROM public.membership_roles WHERE membership_id = v_membership;
  INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
  VALUES (v_membership, p_role_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Nav visibility should match what the route actually allows
-- ---------------------------------------------------------------------
-- /members (App.jsx) requires members.manage. The catalog only required
-- members.view, so a plain member saw "Members" in their sidebar, clicked
-- it, and was bounced straight back to "/" with no explanation.

UPDATE public.modules
SET required_permission = 'members.manage'
WHERE key = 'members';


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


-- FILE: 40_notification_backbone.sql

-- =====================================================================
-- 40. NOTIFICATION BACKBONE — platform-wide notification service
-- =====================================================================
-- The existing setup (19_push_notifications.sql) can already deliver a
-- push once a row lands in `notifications`. What it CANNOT do:
--   • respect per-user preferences (everyone gets everything)
--   • categorise notifications (one flat `type` text column)
--   • honour quiet hours
--   • schedule anything (no reminders, no recurrence)
--   • record whether delivery actually succeeded
--
-- This migration adds those five things as a reusable service. Any future
-- module (donations, attendance, library, ...) registers its event types
-- here and gets scheduling, preferences and multi-channel delivery for
-- free — no new plumbing required.
--
-- Design:
--   notification_categories   catalogue of what CAN be sent
--   notification_preferences  per-user opt in/out + channel + timing
--   notification_schedule     queue of things to send later (cron drains it)
--   notification_deliveries   per-channel delivery + read audit trail
--   notify()                  single entry point every module calls
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- pg_cron must normally be enabled from the Supabase dashboard
-- (Database > Extensions > pg_cron). Attempt it here, but do not abort the
-- whole migration if the role lacks permission — everything except the
-- scheduled reminders still works without it.
DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled (%). Scheduled reminders will not run until you enable it in Database > Extensions.', SQLERRM;
END $do$;

-- ---------------------------------------------------------------------
-- 1. CATEGORY CATALOGUE
-- ---------------------------------------------------------------------
-- One row per kind of notification the platform can emit. Adding a new
-- notification type in future = INSERT one row here. Nothing else.

CREATE TABLE IF NOT EXISTS public.notification_categories (
  key             TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  description     TEXT,
  icon            TEXT DEFAULT 'Bell',
  -- Grouping shown in the preferences UI
  group_key       TEXT NOT NULL DEFAULT 'general',
  -- Can a user switch this off? Security/system alerts should stay on.
  user_can_disable BOOLEAN NOT NULL DEFAULT TRUE,
  -- Default state for users who have never touched their preferences
  default_push    BOOLEAN NOT NULL DEFAULT TRUE,
  default_inapp   BOOLEAN NOT NULL DEFAULT TRUE,
  default_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.notification_categories
  (key, label, description, icon, group_key, user_can_disable, default_push, default_inapp, default_whatsapp, sort_order)
VALUES
  ('service.assigned',    'Service Assigned',      'A new service has been assigned to you',        'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 10),
  ('service.updated',     'Service Updated',       'Details of your service changed',               'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 20),
  ('service.cancelled',   'Service Cancelled',     'A service you were assigned was cancelled',     'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 30),
  ('service.reminder',    'Service Reminder',      'Upcoming service reminders',                    'Clock',        'services',      TRUE,  TRUE,  TRUE,  FALSE, 40),
  ('service.completed',   'Service Completed',     'Confirmation that a service was completed',     'CheckCircle2', 'services',      TRUE,  FALSE, TRUE,  FALSE, 50),

  ('sadhana.daily',       'Daily Sadhana Reminder','Reminder to fill your daily sadhana',           'BookOpen',     'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 60),
  ('sadhana.weekly',      'Weekly Sadhana Report', 'Reminder to submit your weekly report',         'BookOpen',     'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 70),
  ('sadhana.missed',      'Missed Sadhana',        'You did not submit yesterday',                  'AlertCircle',  'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 80),

  ('cleanliness.assigned','Cleaning Duty Assigned','A cleaning duty was assigned to you',           'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 90),
  ('cleanliness.reminder','Cleaning Reminder',     'Upcoming cleaning duty',                        'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 100),
  ('cleanliness.completed','Cleaning Completed',   'A duty was marked complete',                    'CheckCircle2', 'cleanliness',   TRUE,  FALSE, TRUE,  FALSE, 110),
  ('cleanliness.reassigned','Area Reassigned',     'Your cleaning area changed',                    'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 120),

  ('announcement.new',    'Announcements',         'Org-wide announcements',                        'Megaphone',    'announcements', TRUE,  TRUE,  TRUE,  FALSE, 130),
  ('event.new',           'New Event',             'A new event was published',                     'CalendarDays', 'events',        TRUE,  TRUE,  TRUE,  FALSE, 140),
  ('event.reminder',      'Event Reminder',        'An event is starting soon',                     'CalendarDays', 'events',        TRUE,  TRUE,  TRUE,  FALSE, 150),
  ('festival.new',        'Festivals',             'Upcoming festivals and celebrations',           'Flame',        'events',        TRUE,  TRUE,  TRUE,  FALSE, 160),

  ('message.personal',    'Personal Messages',     'Direct messages from coordinators/mentors',     'MessageCircle','personal',      TRUE,  TRUE,  TRUE,  FALSE, 170),
  ('system.alert',        'System Alerts',         'Account and security notices',                  'Shield',       'system',        FALSE, TRUE,  TRUE,  FALSE, 180)
ON CONFLICT (key) DO UPDATE
  SET label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      icon             = EXCLUDED.icon,
      group_key        = EXCLUDED.group_key,
      user_can_disable = EXCLUDED.user_can_disable,
      sort_order       = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. PER-USER PREFERENCES
-- ---------------------------------------------------------------------
-- Absence of a row means "use the category defaults", so we never have to
-- backfill a row per user per category.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES public.notification_categories(key) ON DELETE CASCADE,
  push_enabled     BOOLEAN,
  inapp_enabled    BOOLEAN,
  whatsapp_enabled BOOLEAN,
  -- For reminder-style categories: what time of day to fire (user's local tz)
  preferred_time   TIME,
  -- Minutes-before offsets for reminders, e.g. [1440, 120, 30]
  lead_times_min   INTEGER[],
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, category_key)
);

-- Global per-user switches (quiet hours + master mute)
CREATE TABLE IF NOT EXISTS public.notification_settings (
  profile_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_muted       BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opt_in  BOOLEAN NOT NULL DEFAULT FALSE,
  phone_e164       TEXT,
  quiet_start      TIME,
  quiet_end        TIME,
  timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. SCHEDULE QUEUE
-- ---------------------------------------------------------------------
-- Anything that should fire later lands here. pg_cron drains it every
-- minute. Recurrence is expressed as a cron expression evaluated by the
-- owning module, not here — this table only holds concrete send times.

CREATE TABLE IF NOT EXISTS public.notification_schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES public.notification_categories(key) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT,
  reference_id  UUID,
  action_url    TEXT,
  send_at       TIMESTAMPTZ NOT NULL,
  -- pending | sent | cancelled | failed
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);

ALTER TABLE public.notification_schedule
  DROP CONSTRAINT IF EXISTS notification_schedule_status_check;
ALTER TABLE public.notification_schedule
  ADD CONSTRAINT notification_schedule_status_check
  CHECK (status IN ('pending', 'sent', 'cancelled', 'failed'));

CREATE INDEX IF NOT EXISTS idx_notif_schedule_due
  ON public.notification_schedule (send_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_schedule_ref
  ON public.notification_schedule (reference_id, category_key);

-- ---------------------------------------------------------------------
-- 4. DELIVERY AUDIT
-- ---------------------------------------------------------------------
-- Lets the admin dashboard answer "did it arrive, was it read, resend it".

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- push | inapp | whatsapp | email
  channel         TEXT NOT NULL,
  -- queued | sent | delivered | failed | skipped
  status          TEXT NOT NULL DEFAULT 'queued',
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_deliveries_notif
  ON public.notification_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_profile
  ON public.notification_deliveries (profile_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. EXTEND notifications WITH CATEGORY + ACTION URL
-- ---------------------------------------------------------------------
-- The legacy `type` column stays for backwards compatibility; `category_key`
-- is the new structured field the Notification Center filters on.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category_key TEXT REFERENCES public.notification_categories(key),
  ADD COLUMN IF NOT EXISTS action_url   TEXT,
  ADD COLUMN IF NOT EXISTS org_id       UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS read_at      TIMESTAMPTZ;

-- `voice_id` is a legacy NOT NULL column from the single-tenant era. Multi-org
-- notifications have no voice to point at, so relax the constraint rather than
-- forcing every caller to invent a value.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'voice_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.notifications ALTER COLUMN voice_id DROP NOT NULL';
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_notifications_profile_cat
  ON public.notifications (profile_id, category_key, created_at DESC);

-- Backfill category_key from the old free-text type where we can map it
UPDATE public.notifications SET category_key = 'announcement.new'
  WHERE category_key IS NULL AND type IN ('announcement', 'announcements');
UPDATE public.notifications SET category_key = 'service.assigned'
  WHERE category_key IS NULL AND type IN ('service', 'seva');
UPDATE public.notifications SET category_key = 'sadhana.daily'
  WHERE category_key IS NULL AND type = 'sadhana';
UPDATE public.notifications SET category_key = 'cleanliness.assigned'
  WHERE category_key IS NULL AND type IN ('cleaning', 'cleanliness');
UPDATE public.notifications SET category_key = 'event.new'
  WHERE category_key IS NULL AND type = 'event';
UPDATE public.notifications SET category_key = 'system.alert'
  WHERE category_key IS NULL AND type = 'system';
UPDATE public.notifications SET category_key = 'message.personal'
  WHERE category_key IS NULL;

-- ---------------------------------------------------------------------
-- 6. PREFERENCE RESOLUTION
-- ---------------------------------------------------------------------
-- Returns the effective channel switches for one user + category, merging
-- the user's overrides over the category defaults.

CREATE OR REPLACE FUNCTION public.resolve_notification_prefs(
  p_profile_id UUID,
  p_category   TEXT
)
RETURNS TABLE (push BOOLEAN, inapp BOOLEAN, whatsapp BOOLEAN)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(np.push_enabled,     nc.default_push)     AND NOT COALESCE(ns.push_muted, FALSE) AS push,
    COALESCE(np.inapp_enabled,    nc.default_inapp)                                            AS inapp,
    COALESCE(np.whatsapp_enabled, nc.default_whatsapp) AND COALESCE(ns.whatsapp_opt_in, FALSE) AS whatsapp
  FROM public.notification_categories nc
  LEFT JOIN public.notification_preferences np
    ON np.category_key = nc.key AND np.profile_id = p_profile_id
  LEFT JOIN public.notification_settings ns
    ON ns.profile_id = p_profile_id
  WHERE nc.key = p_category;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_notification_prefs(UUID, TEXT) TO authenticated;

-- Is the user inside their quiet hours right now?
CREATE OR REPLACE FUNCTION public.in_quiet_hours(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s      RECORD;
  v_now  TIME;
BEGIN
  SELECT quiet_start, quiet_end, timezone INTO s
  FROM public.notification_settings WHERE profile_id = p_profile_id;

  IF s IS NULL OR s.quiet_start IS NULL OR s.quiet_end IS NULL THEN
    RETURN FALSE;
  END IF;

  v_now := (NOW() AT TIME ZONE COALESCE(s.timezone, 'Asia/Kolkata'))::TIME;

  -- Window that does not cross midnight, e.g. 13:00-15:00
  IF s.quiet_start <= s.quiet_end THEN
    RETURN v_now >= s.quiet_start AND v_now < s.quiet_end;
  END IF;

  -- Window that crosses midnight, e.g. 22:00-06:00
  RETURN v_now >= s.quiet_start OR v_now < s.quiet_end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.in_quiet_hours(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. notify() — THE SINGLE ENTRY POINT
-- ---------------------------------------------------------------------
-- Every module calls this instead of inserting into `notifications`
-- directly. It applies preferences, records a delivery row per channel and
-- lets the existing trg_notify_push trigger handle the actual push.
--
--   PERFORM public.notify(
--     p_profile_id  => '...',
--     p_category    => 'service.assigned',
--     p_title       => 'New service assigned',
--     p_body        => 'Book Distribution today at 5:00 PM',
--     p_reference_id=> v_service_id,
--     p_action_url  => '/services/' || v_service_id
--   );

CREATE OR REPLACE FUNCTION public.notify(
  p_profile_id   UUID,
  p_category     TEXT,
  p_title        TEXT,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL,
  -- Set TRUE for time-critical alerts that should pierce quiet hours
  p_force        BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefs   RECORD;
  v_notif   UUID;
  v_org     UUID := p_org_id;
  v_quiet   BOOLEAN;
BEGIN
  IF p_profile_id IS NULL OR p_title IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prefs
  FROM public.resolve_notification_prefs(p_profile_id, p_category);

  -- Unknown category: fail loudly in logs rather than silently dropping.
  -- NOTE: use FOUND, not `v_prefs IS NULL` — a RECORD is not set to NULL by
  -- SELECT INTO when no row matches, so the NULL test would never fire.
  IF NOT FOUND THEN
    RAISE WARNING 'notify(): unknown category %', p_category;
    RETURN NULL;
  END IF;

  IF NOT v_prefs.inapp AND NOT v_prefs.push AND NOT v_prefs.whatsapp THEN
    RETURN NULL;
  END IF;

  IF v_org IS NULL THEN
    SELECT COALESCE(active_org_id, org_id) INTO v_org
    FROM public.profiles WHERE id = p_profile_id;
  END IF;

  INSERT INTO public.notifications
    (org_id, profile_id, title, body, type, category_key, reference_id, action_url)
  VALUES
    (v_org, p_profile_id, p_title, p_body,
     split_part(p_category, '.', 1), p_category, p_reference_id, p_action_url)
  RETURNING id INTO v_notif;

  INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status)
  VALUES (v_notif, p_profile_id, 'inapp', CASE WHEN v_prefs.inapp THEN 'delivered' ELSE 'skipped' END);

  v_quiet := public.in_quiet_hours(p_profile_id);

  -- trg_notify_push already fired synchronously during the INSERT above and
  -- applied the same preference/quiet-hour checks, so record the outcome
  -- rather than leaving the row 'queued' for a drain that never comes.
  INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status, detail)
  VALUES (
    v_notif, p_profile_id, 'push',
    CASE
      WHEN NOT v_prefs.push                 THEN 'skipped'
      WHEN v_quiet AND NOT p_force          THEN 'skipped'
      ELSE 'sent'
    END,
    CASE
      WHEN NOT v_prefs.push        THEN 'user preference off'
      WHEN v_quiet AND NOT p_force THEN 'quiet hours'
      ELSE NULL
    END
  );

  IF v_prefs.whatsapp THEN
    INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status)
    VALUES (v_notif, p_profile_id, 'whatsapp', 'queued');
  END IF;

  RETURN v_notif;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, BOOLEAN) TO authenticated;

-- Convenience: fan a notification out to many people at once
CREATE OR REPLACE FUNCTION public.notify_many(
  p_profile_ids  UUID[],
  p_category     TEXT,
  p_title        TEXT,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_id IN ARRAY COALESCE(p_profile_ids, ARRAY[]::UUID[]) LOOP
    IF public.notify(v_id, p_category, p_title, p_body, p_reference_id, p_action_url, p_org_id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_many(UUID[], TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. SCHEDULING HELPERS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.schedule_notification(
  p_profile_id   UUID,
  p_category     TEXT,
  p_title        TEXT,
  p_send_at      TIMESTAMPTZ,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notification_schedule
    (org_id, profile_id, category_key, title, body, reference_id, action_url, send_at, created_by)
  VALUES
    (p_org_id, p_profile_id, p_category, p_title, p_body, p_reference_id, p_action_url, p_send_at, auth.uid())
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_notification(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID) TO authenticated;

-- Cancel every pending reminder tied to a record (e.g. service cancelled)
CREATE OR REPLACE FUNCTION public.cancel_scheduled_notifications(
  p_reference_id UUID,
  p_category     TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.notification_schedule
  SET status = 'cancelled'
  WHERE reference_id = p_reference_id
    AND status = 'pending'
    AND (p_category IS NULL OR category_key = p_category);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_scheduled_notifications(UUID, TEXT) TO authenticated;

-- Drain the queue. pg_cron calls this every minute.
CREATE OR REPLACE FUNCTION public.dispatch_due_notifications()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_sent  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.notification_schedule
    WHERE status = 'pending' AND send_at <= NOW()
    ORDER BY send_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.notify(
        r.profile_id, r.category_key, r.title, r.body,
        r.reference_id, r.action_url, r.org_id
      );
      UPDATE public.notification_schedule
      SET status = 'sent', sent_at = NOW(), attempts = attempts + 1
      WHERE id = r.id;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.notification_schedule
      SET status     = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
          attempts   = attempts + 1,
          last_error = SQLERRM
      WHERE id = r.id;
    END;
  END LOOP;

  RETURN v_sent;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. RECURRING REMINDER GENERATORS
-- ---------------------------------------------------------------------
-- Daily sadhana nudge for anyone who has not submitted today.

CREATE OR REPLACE FUNCTION public.enqueue_daily_sadhana_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id AS profile_id, td.org_id, td.id AS tracker_id
    FROM public.profiles p
    JOIN public.tracker_definitions td
      ON td.org_id = COALESCE(p.active_org_id, p.org_id)
     AND td.name = 'Sadhana'
     AND td.is_active
    WHERE COALESCE(p.active_org_id, p.org_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.tracker_entries te
        WHERE te.tracker_id  = td.id
          AND te.user_id     = p.id
          AND te.period_date = CURRENT_DATE
      )
  LOOP
    PERFORM public.notify(
      r.profile_id, 'sadhana.daily',
      'Have you filled today''s sadhana?',
      'Tap to submit your daily practice report.',
      r.tracker_id, '/trackers/' || r.tracker_id, r.org_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Weekly report nudge (run Sunday evening).
CREATE OR REPLACE FUNCTION public.enqueue_weekly_sadhana_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id AS profile_id, td.org_id, td.id AS tracker_id
    FROM public.profiles p
    JOIN public.tracker_definitions td
      ON td.org_id = COALESCE(p.active_org_id, p.org_id)
     AND td.name = 'Sadhana'
     AND td.is_active
    WHERE COALESCE(p.active_org_id, p.org_id) IS NOT NULL
  LOOP
    PERFORM public.notify(
      r.profile_id, 'sadhana.weekly',
      'Weekly Sadhana Report is pending',
      'Please submit before Sunday night.',
      r.tracker_id, '/trackers/' || r.tracker_id, r.org_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------
-- 10. CRON JOBS
-- ---------------------------------------------------------------------
-- Times are UTC. 03:30 UTC = 09:00 IST, 14:30 UTC = 20:00 IST.

DO $do$
BEGIN
  PERFORM cron.unschedule('dispatch-due-notifications');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.unschedule('daily-sadhana-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.unschedule('weekly-sadhana-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.schedule(
    'dispatch-due-notifications', '* * * * *',
    $cron$SELECT public.dispatch_due_notifications();$cron$
  );

  PERFORM cron.schedule(
    'daily-sadhana-reminder', '30 14 * * *',
    $cron$SELECT public.enqueue_daily_sadhana_reminders();$cron$
  );

  PERFORM cron.schedule(
    'weekly-sadhana-reminder', '30 13 * * 0',
    $cron$SELECT public.enqueue_weekly_sadhana_reminders();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not register cron jobs (%). Enable pg_cron then re-run this migration.', SQLERRM;
END $do$;

-- ---------------------------------------------------------------------
-- 11. READ TRACKING
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE, read_at = NOW()
  WHERE profile_id = auth.uid()
    AND is_read = FALSE
    AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(UUID[]) TO authenticated;

-- ---------------------------------------------------------------------
-- 12. TEACH THE EXISTING PUSH TRIGGER ABOUT PREFERENCES
-- ---------------------------------------------------------------------
-- 19_push_notifications.sql fires a push for EVERY notification row. Now
-- that users can opt out and set quiet hours, the trigger has to check
-- before spending a push. Preferences are evaluated here rather than read
-- from notification_deliveries because the trigger runs before notify()
-- has written those rows.

CREATE OR REPLACE FUNCTION public.notify_push_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url text;
  v_key      text;
  v_prefs    RECORD;
BEGIN
  -- Unknown/legacy category: fall through and deliver (old behaviour).
  IF NEW.category_key IS NOT NULL THEN
    SELECT * INTO v_prefs
    FROM public.resolve_notification_prefs(NEW.profile_id, NEW.category_key);

    IF FOUND AND NOT COALESCE(v_prefs.push, TRUE) THEN
      RETURN NEW;
    END IF;

    IF public.in_quiet_hours(NEW.profile_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT value INTO v_base_url FROM private.app_secrets WHERE key = 'edge_base_url';
  SELECT value INTO v_key      FROM private.app_secrets WHERE key = 'service_role_key';

  IF v_base_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'profile_id',   NEW.profile_id,
      'title',        NEW.title,
      'body',         COALESCE(NEW.body, ''),
      'type',         COALESCE(NEW.category_key, NEW.type, 'general'),
      'reference_id', NEW.reference_id,
      'action_url',   NEW.action_url,
      'notification_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_push ON public.notifications;
CREATE TRIGGER trg_notify_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_insert();

-- ---------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.notification_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_categories_read ON public.notification_categories;
CREATE POLICY notif_categories_read ON public.notification_categories
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS notif_prefs_own ON public.notification_preferences;
CREATE POLICY notif_prefs_own ON public.notification_preferences
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS notif_settings_own ON public.notification_settings;
CREATE POLICY notif_settings_own ON public.notification_settings
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- Users see their own queued items; admins see everything in their org
DROP POLICY IF EXISTS notif_schedule_read ON public.notification_schedule;
CREATE POLICY notif_schedule_read ON public.notification_schedule
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
  );

DROP POLICY IF EXISTS notif_schedule_write ON public.notification_schedule;
CREATE POLICY notif_schedule_write ON public.notification_schedule
  FOR ALL USING (public.has_any_permission(ARRAY['announcements.manage', 'members.manage']))
  WITH CHECK (public.has_any_permission(ARRAY['announcements.manage', 'members.manage']));

DROP POLICY IF EXISTS notif_deliveries_read ON public.notification_deliveries;
CREATE POLICY notif_deliveries_read ON public.notification_deliveries
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
  );

NOTIFY pgrst, 'reload schema';


-- FILE: 41_services_cleanliness.sql

-- =====================================================================
-- 41. IM SERVICES + CLEANLINESS — workflow, reminders, notifications
-- =====================================================================
-- Builds on the existing task_* engine (26_tasks.sql) rather than starting
-- over. That engine already models categories, templates, areas,
-- assignments, logs and preferences with RLS keyed on tasks.* permissions.
--
-- What this migration adds:
--   • an acceptance / completion / verification workflow on assignments
--   • a coordinator, priority, and ad-hoc (template-less) assignments
--   • module tagging so one engine drives two distinct nav modules:
--       'service'      -> IM Services   (/services)
--       'cleanliness'  -> Cleanliness   (/cleanliness)
--   • automatic notifications via the 40_notification_backbone notify()
--     service: assigned / updated / cancelled / completed
--   • scheduled reminders at configurable lead times before the due time
--   • a recurrence generator to roll templates into dated assignments
--
-- The generic 'Tasks' nav module is retired in migration 42; the schema
-- stays because Services and Cleanliness both ride on it.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULE TAGGING + WORKFLOW COLUMNS
-- ---------------------------------------------------------------------

ALTER TABLE public.task_categories
  ADD COLUMN IF NOT EXISTS module_key TEXT NOT NULL DEFAULT 'service';

ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS module_key          TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS coordinator_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority             TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_acceptance  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_lead_times  INTEGER[] NOT NULL DEFAULT '{1440,120,30}',
  ADD COLUMN IF NOT EXISTS recurrence_weekdays  INTEGER[];   -- 0=Sun..6=Sat for weekly

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS module_key          TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS title               TEXT,          -- ad-hoc assignments w/o a template
  ADD COLUMN IF NOT EXISTS instructions        TEXT,
  ADD COLUMN IF NOT EXISTS coordinator_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority            TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_acceptance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS accepted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_min        INTEGER;

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_status_check;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_status_check
  CHECK (status IN ('assigned', 'accepted', 'declined', 'in_progress', 'completed', 'verified', 'cancelled'));

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_priority_check;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_task_assignments_module
  ON public.task_assignments (org_id, module_key, task_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_assignments_status
  ON public.task_assignments (user_id, status, task_date DESC);

-- ---------------------------------------------------------------------
-- 2. DUE-TIMESTAMP HELPER
-- ---------------------------------------------------------------------
-- Combines task_date + task_time (falling back to 09:00) into a single
-- timestamptz in the org's timezone, used for reminder scheduling.

CREATE OR REPLACE FUNCTION public.assignment_due_at(p_assignment public.task_assignments)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_tz   TEXT;
  v_time TIME;
BEGIN
  SELECT COALESCE(o.timezone, 'Asia/Kolkata') INTO v_tz
  FROM public.organizations o WHERE o.id = p_assignment.org_id;

  v_time := COALESCE(p_assignment.task_time, TIME '09:00');
  RETURN (p_assignment.task_date + v_time) AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata');
END;
$$;

-- ---------------------------------------------------------------------
-- 3. REMINDER SCHEDULING
-- ---------------------------------------------------------------------
-- (Re)builds the pending reminder rows for an assignment. Cancels any
-- previous pending reminders first so edits don't leave stale ones.

CREATE OR REPLACE FUNCTION public.schedule_service_reminders(p_assignment_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a         public.task_assignments;
  v_due     TIMESTAMPTZ;
  v_leads   INTEGER[];
  v_lead    INTEGER;
  v_at      TIMESTAMPTZ;
  v_cat     TEXT;
  v_title   TEXT;
  v_count   INTEGER := 0;
BEGIN
  SELECT * INTO a FROM public.task_assignments WHERE id = p_assignment_id;
  IF NOT FOUND OR a.status IN ('cancelled', 'completed', 'verified', 'declined') THEN
    RETURN 0;
  END IF;

  -- Drop existing pending reminders for this assignment
  UPDATE public.notification_schedule
  SET status = 'cancelled'
  WHERE reference_id = p_assignment_id
    AND status = 'pending'
    AND category_key = a.module_key || '.reminder';

  v_due := public.assignment_due_at(a);
  IF v_due IS NULL THEN RETURN 0; END IF;

  -- Lead times: template's, else a sensible default
  SELECT COALESCE(t.reminder_lead_times, ARRAY[1440, 120, 30])
  INTO v_leads
  FROM public.task_templates t WHERE t.id = a.template_id;
  IF v_leads IS NULL THEN v_leads := ARRAY[1440, 120, 30]; END IF;

  v_cat   := a.module_key || '.reminder';
  v_title := COALESCE(a.title,
             (SELECT name FROM public.task_templates WHERE id = a.template_id),
             CASE WHEN a.module_key = 'cleanliness' THEN 'Cleaning duty reminder' ELSE 'Service reminder' END);

  FOREACH v_lead IN ARRAY v_leads LOOP
    v_at := v_due - make_interval(mins => v_lead);
    IF v_at > NOW() THEN
      INSERT INTO public.notification_schedule
        (org_id, profile_id, category_key, title, body, reference_id, action_url, send_at)
      VALUES (
        a.org_id, a.user_id, v_cat, v_title,
        'Starts ' || to_char(v_due, 'DD Mon HH24:MI'),
        a.id, '/' || a.module_key || 's/' || a.id, v_at
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_service_reminders(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ASSIGNMENT NOTIFICATION TRIGGERS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_assignment_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_url   TEXT;
BEGIN
  v_title := COALESCE(NEW.title,
             (SELECT name FROM public.task_templates WHERE id = NEW.template_id),
             CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty' ELSE 'Service' END);
  v_url := '/' || NEW.module_key || 's/' || NEW.id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify(
      NEW.user_id, NEW.module_key || '.assigned',
      CASE WHEN NEW.module_key = 'cleanliness' THEN 'New cleaning duty' ELSE 'New service assigned' END,
      v_title || COALESCE(' — ' || to_char(NEW.task_date, 'DD Mon') ||
        COALESCE(' ' || to_char(NEW.task_time, 'HH24:MI'), ''), ''),
      NEW.id, v_url, NEW.org_id
    );
    PERFORM public.schedule_service_reminders(NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Cancellation
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
      PERFORM public.notify(
        NEW.user_id, NEW.module_key || '.cancelled',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty cancelled' ELSE 'Service cancelled' END,
        v_title, NEW.id, v_url, NEW.org_id
      );
      PERFORM public.cancel_scheduled_notifications(NEW.id, NEW.module_key || '.reminder');
      RETURN NEW;
    END IF;

    -- Completion -> tell the coordinator
    IF NEW.status IN ('completed', 'verified')
       AND OLD.status NOT IN ('completed', 'verified')
       AND NEW.coordinator_id IS NOT NULL THEN
      PERFORM public.notify(
        NEW.coordinator_id, NEW.module_key || '.completed',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty completed' ELSE 'Service completed' END,
        v_title, NEW.id, v_url, NEW.org_id
      );
    END IF;

    -- Reschedule / retime -> notify the assignee and rebuild reminders
    IF (NEW.task_date IS DISTINCT FROM OLD.task_date
        OR NEW.task_time IS DISTINCT FROM OLD.task_time
        OR NEW.user_id   IS DISTINCT FROM OLD.user_id)
       AND NEW.status NOT IN ('cancelled', 'completed', 'verified') THEN
      PERFORM public.notify(
        NEW.user_id, NEW.module_key || '.updated',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty updated' ELSE 'Service updated' END,
        v_title || COALESCE(' — ' || to_char(NEW.task_date, 'DD Mon') ||
          COALESCE(' ' || to_char(NEW.task_time, 'HH24:MI'), ''), ''),
        NEW.id, v_url, NEW.org_id
      );
      PERFORM public.schedule_service_reminders(NEW.id);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignment_notify ON public.task_assignments;
CREATE TRIGGER trg_task_assignment_notify
  AFTER INSERT OR UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.task_assignment_notify();

-- ---------------------------------------------------------------------
-- 5. WORKFLOW RPCs (assignee actions)
-- ---------------------------------------------------------------------
-- These enforce that only the assignee can accept/decline/complete their
-- own assignment, on top of the RLS already on the table.

CREATE OR REPLACE FUNCTION public.respond_to_assignment(
  p_assignment_id UUID,
  p_action        TEXT      -- 'accept' | 'decline' | 'complete' | 'start'
)
RETURNS public.task_assignments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.task_assignments;
BEGIN
  SELECT * INTO a FROM public.task_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF a.user_id <> auth.uid() AND NOT public.has_any_permission(ARRAY['tasks.assign','tasks.manage','tasks.verify']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.task_assignments
    SET status = 'accepted', accepted_at = NOW(), declined_at = NULL
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'decline' THEN
    UPDATE public.task_assignments
    SET status = 'declined', declined_at = NOW()
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'start' THEN
    UPDATE public.task_assignments
    SET status = 'in_progress'
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'complete' THEN
    UPDATE public.task_assignments
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action;
  END IF;

  RETURN a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_to_assignment(UUID, TEXT) TO authenticated;

-- Coordinator verification (cleanliness / any service needing sign-off)
CREATE OR REPLACE FUNCTION public.verify_assignment(
  p_assignment_id UUID,
  p_approve       BOOLEAN DEFAULT TRUE
)
RETURNS public.task_assignments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.task_assignments;
BEGIN
  IF NOT public.has_any_permission(ARRAY['tasks.verify','tasks.manage']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  UPDATE public.task_assignments
  SET status      = CASE WHEN p_approve THEN 'verified' ELSE 'in_progress' END,
      verified_by = CASE WHEN p_approve THEN auth.uid() ELSE NULL END,
      verified_at = CASE WHEN p_approve THEN NOW() ELSE NULL END
  WHERE id = p_assignment_id
  RETURNING * INTO a;

  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  RETURN a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_assignment(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. RECURRENCE GENERATOR
-- ---------------------------------------------------------------------
-- Rolls an active template forward into dated assignments for one member.
-- Managers call this from the UI ("schedule recurring"). Idempotent per
-- (template, area, user, date) thanks to the existing UNIQUE constraint.

CREATE OR REPLACE FUNCTION public.generate_assignments_from_template(
  p_template_id UUID,
  p_user_id     UUID,
  p_from        DATE,
  p_to          DATE,
  p_area_id     UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t        public.task_templates;
  d        DATE;
  v_count  INTEGER := 0;
  v_dow    INTEGER;
BEGIN
  SELECT * INTO t FROM public.task_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;

  IF NOT public.has_any_permission(ARRAY['tasks.assign','tasks.manage']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Range too large (max 1 year)';
  END IF;

  d := p_from;
  WHILE d <= p_to LOOP
    v_dow := EXTRACT(DOW FROM d)::INTEGER;  -- 0=Sun..6=Sat

    IF t.recurrence = 'daily'
       OR (t.recurrence = 'weekly' AND (t.recurrence_weekdays IS NULL OR v_dow = ANY(t.recurrence_weekdays)))
       OR (t.recurrence = 'monthly' AND EXTRACT(DAY FROM d) = EXTRACT(DAY FROM p_from))
       OR (t.recurrence IN ('once','custom') AND d = p_from)
    THEN
      INSERT INTO public.task_assignments
        (org_id, template_id, area_id, user_id, assigned_by, task_date, task_time,
         module_key, coordinator_id, priority, requires_acceptance, duration_min, instructions)
      VALUES
        (t.org_id, t.id, p_area_id, p_user_id, auth.uid(), d, t.default_time,
         t.module_key, t.coordinator_id, t.priority, t.requires_acceptance, t.duration_min, t.instructions)
      ON CONFLICT (template_id, area_id, user_id, task_date) DO NOTHING;

      IF FOUND THEN v_count := v_count + 1; END IF;
    END IF;

    d := d + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_assignments_from_template(UUID, UUID, DATE, DATE, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. READ MODEL for the UI (assignments joined to names)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_assignments(
  p_module TEXT DEFAULT 'service',
  p_scope  TEXT DEFAULT 'mine'      -- 'mine' | 'all' (all requires tasks.view_all)
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
  completed_at  TIMESTAMPTZ
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
    a.verified_at, a.completed_at
  FROM public.task_assignments a
  LEFT JOIN public.task_templates t ON t.id = a.template_id
  LEFT JOIN public.task_areas ar     ON ar.id = a.area_id
  LEFT JOIN public.profiles pu       ON pu.id = a.user_id
  LEFT JOIN public.profiles pc       ON pc.id = a.coordinator_id
  WHERE a.org_id = public.current_org_id()
    AND a.module_key = p_module
    AND a.status <> 'cancelled'
    AND (
      (p_scope = 'mine' AND a.user_id = auth.uid())
      OR (p_scope = 'all' AND public.has_permission('tasks.view_all'))
    )
  ORDER BY a.task_date DESC, a.task_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.my_assignments(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. SEED A DEFAULT CATEGORY PER MODULE FOR EVERY ORG
-- ---------------------------------------------------------------------

DO $do$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.task_categories (org_id, name, icon, color, module_key, sort_order)
    SELECT o.id, 'General Services', 'ListChecks', '#f97316', 'service', 10
    WHERE NOT EXISTS (
      SELECT 1 FROM public.task_categories
      WHERE org_id = o.id AND module_key = 'service'
    );

    INSERT INTO public.task_categories (org_id, name, icon, color, module_key, sort_order)
    SELECT o.id, 'Cleaning', 'Sparkles', '#16a34a', 'cleanliness', 10
    WHERE NOT EXISTS (
      SELECT 1 FROM public.task_categories
      WHERE org_id = o.id AND module_key = 'cleanliness'
    );
  END LOOP;
END $do$;

-- Tag any pre-existing Surabhikunj categories by name so their data lands
-- in the right module.
UPDATE public.task_categories SET module_key = 'cleanliness'
  WHERE lower(name) LIKE '%clean%';
UPDATE public.task_templates t SET module_key = 'cleanliness'
  FROM public.task_categories c
  WHERE t.category_id = c.id AND c.module_key = 'cleanliness';
UPDATE public.task_assignments a SET module_key = 'cleanliness'
  FROM public.task_templates t
  WHERE a.template_id = t.id AND t.module_key = 'cleanliness';

NOTIFY pgrst, 'reload schema';


-- FILE: 42_register_service_modules.sql

-- =====================================================================
-- 42. REGISTER IM SERVICES + CLEANLINESS NAV MODULES; RETIRE TASKS
-- =====================================================================
-- Adds two catalogue modules that both ride on the task_* engine:
--   'service'      IM Services   /services
--   'cleanliness'  Cleanliness   /cleanliness
-- and disables the generic 'tasks' module (its schema stays, only the nav
-- entry is retired) so the sidebar shows the two focused modules instead.
--
-- Both reuse the existing tasks.* permission family, so no role reseed is
-- needed. Idempotent.
-- =====================================================================

-- 1. Catalogue entries
INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('service',     'IM Services', 'Individual service assignments and rosters', 'ListChecks', '/services',    'operations', 'tasks.view_own',      FALSE, TRUE, 60),
  ('cleanliness', 'Cleanliness', 'Cleaning duties, areas and verification',    'Sparkles',   '/cleanliness', 'operations', 'tasks.view_own',      FALSE, TRUE, 65),
  ('broadcast',   'Broadcasts',  'Send and schedule notifications to members', 'Megaphone',  '/broadcast',   'comms',      'announcements.manage', FALSE, TRUE, 135)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      sort_order          = EXCLUDED.sort_order;

-- 2. Enable them for every org; leave any label_override intact
INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key IN ('service', 'cleanliness', 'broadcast')
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled = TRUE, updated_at = NOW()
WHERE module_key IN ('service', 'cleanliness', 'broadcast')
  AND enabled IS DISTINCT FROM TRUE;

-- 3. Retire the generic Tasks nav entry (schema + permissions remain)
UPDATE public.organization_modules
SET enabled = FALSE, updated_at = NOW()
WHERE module_key = 'tasks';

NOTIFY pgrst, 'reload schema';


-- FILE: 43_notifications_admin_read.sql

-- =====================================================================
-- 43. BROADEN notifications SELECT: self + org admins
-- =====================================================================
-- Two problems with the 29_contract_phase policy
--   USING (profile_id = auth.uid() AND org_id = current_org_id()):
--   1. Legacy/rows with org_id IS NULL become invisible even to their own
--      owner, so the Notification Center could silently hide items.
--   2. The admin Broadcast > Delivery dashboard needs org-wide read to show
--      delivery + read stats, which this policy forbids.
--
-- This restores "always see your own" and adds an org-scoped admin read for
-- users holding announcements.manage / members.manage — matching the
-- notification_deliveries / notification_schedule policies from migration 40.
--
-- Idempotent.
-- =====================================================================

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (
    profile_id = auth.uid()
    OR (
      org_id = public.current_org_id()
      AND public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
    )
  );

NOTIFY pgrst, 'reload schema';


-- FILE: 44_fix_join_ambiguity.sql

-- =====================================================================
-- 44. FIX AMBIGUOUS org_id IN ORG JOIN FLOW
-- =====================================================================
-- The join-code flow occasionally raised "column reference 'org_id' is
-- ambiguous". That happens when a planner/join in a query (or a trigger it
-- fires) has two `org_id` columns in scope and an `org_id` is written without
-- a table alias. This migration defensively aliases every `org_id` reference
-- in join_organization_by_code and the membership trigger it fires.
--
-- Idempotent: safe to re-run.
-- =====================================================================

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
  FROM public.organizations o
  WHERE o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM public.memberships m
  WHERE m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO v_requires
  FROM public.organization_settings s
  WHERE s.org_id = v_org.id;

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
  FROM public.roles r
  WHERE r.org_id = v_org.id AND r.is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles p
    SET active_org_id = v_org.id,
        org_id        = COALESCE(p.org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- Also harden the trigger that fires on INSERT INTO memberships
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT r.id INTO v_role_id
  FROM public.roles r
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

NOTIFY pgrst, 'reload schema';


-- FILE: 45_fix_admin_autologin.sql

-- =====================================================================
-- 45. FIX ADMIN AUTO-LOGIN
-- =====================================================================
-- Problem: admins/owners who created their org before migration 24/30
-- ran have profiles.active_org_id = NULL. On every fresh login the
-- orgStore cannot resolve which org to open, falls through to the
-- onboarding screen, and asks them to enter the join code again.
--
-- This migration:
--   1. Backfills active_org_id for every profile that has an active
--      membership but a NULL (or stale) active_org_id.
--   2. Hardens current_org_id() so it ALWAYS returns something for a
--      user with at least one active membership — even if active_org_id
--      and org_id are both NULL.
--   3. Adds an after-login trigger: when a session starts (auth.uid()
--      changes inside a transaction), auto-repair active_org_id if it
--      is NULL but the user has exactly one active membership.
--   4. Tightens join_organization_by_code so it always writes
--      active_org_id when the member is already active (covers the
--      "already joined, code re-entered" path).
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ─── 1. ONE-TIME BACKFILL ────────────────────────────────────────────────────
-- For every profile where active_org_id is NULL *but* the user has an
-- active membership, set active_org_id to the most recently joined org.
UPDATE public.profiles p
SET   active_org_id = (
        SELECT m.org_id
        FROM   public.memberships m
        WHERE  m.user_id = p.id
          AND  m.status  = 'active'
        ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
        LIMIT  1
      ),
      -- keep legacy org_id column in sync too
      org_id = COALESCE(
        p.org_id,
        (SELECT m.org_id
         FROM   public.memberships m
         WHERE  m.user_id = p.id AND m.status = 'active'
         ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
         LIMIT  1)
      ),
      is_approved = TRUE,
      updated_at  = NOW()
WHERE p.active_org_id IS NULL
  AND EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = p.id AND m.status = 'active'
      );

-- ─── 2. HARDEN current_org_id() ─────────────────────────────────────────────
-- The previous version could return NULL when active_org_id was NULL
-- (profiles.org_id was null too). The new version always falls through
-- to "most recent active membership" and never returns NULL for a
-- member who genuinely belongs to an org.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Explicitly chosen active org (and membership still valid)
    (SELECT p.active_org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.active_org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.active_org_id
                AND  m.status  = 'active'
            )
    ),
    -- 2. Legacy org_id column
    (SELECT p.org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.org_id
                AND  m.status  = 'active'
            )
    ),
    -- 3. Any single active membership (most recently joined first)
    (SELECT m.org_id
     FROM   public.memberships m
     WHERE  m.user_id = auth.uid()
       AND  m.status  = 'active'
     ORDER  BY m.joined_at DESC NULLS LAST
     LIMIT  1
    )
  );
$$;

-- ─── 3. AUTO-REPAIR FUNCTION ─────────────────────────────────────────────────
-- Called explicitly from the client after login (see below). Writes
-- active_org_id into the profile if it is missing.  Returns the org_id
-- that is now active, or NULL if the user has no active memberships.
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
  FROM   public.profiles p
  WHERE  p.id = v_uid
    AND  p.active_org_id IS NOT NULL
    AND  EXISTS (
           SELECT 1 FROM public.memberships m
           WHERE m.user_id = v_uid AND m.org_id = p.active_org_id AND m.status = 'active'
         );

  IF v_org_id IS NOT NULL THEN RETURN v_org_id; END IF;

  -- Pick the best active membership
  SELECT m.org_id INTO v_org_id
  FROM   public.memberships m
  WHERE  m.user_id = v_uid AND m.status = 'active'
  ORDER  BY m.joined_at DESC NULLS LAST
  LIMIT  1;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Write it back so future calls are fast
  UPDATE public.profiles
  SET    active_org_id = v_org_id,
         org_id        = COALESCE(org_id, v_org_id),
         is_approved   = TRUE,
         updated_at    = NOW()
  WHERE  id = v_uid;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_active_org() TO authenticated;

-- ─── 4. HARDEN join_organization_by_code ────────────────────────────────────
-- When re-entering a code for an org the user is already active in,
-- still write active_org_id so the session picks it up.
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
  FROM   public.organizations o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Check existing membership
  SELECT m.status INTO v_existing
  FROM   public.memberships m
  WHERE  m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    -- Already a member — just make sure active_org_id is set
    UPDATE public.profiles p
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

  -- New join
  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant default role
  SELECT r.id INTO v_default_role
  FROM   public.roles r
  WHERE  r.org_id = v_org.id AND r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Set active org if now active
  IF v_status = 'active' THEN
    UPDATE public.profiles p
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


-- FILE: 52_parental_control_schema.sql

-- =====================================================================
-- 52. PARENTAL CONTROL MODULE — Android-first, Device Owner path
-- =====================================================================
-- Architecture:
--   Parent app (com.surabhikunj.voice)  → reads/writes rules, reads reports
--   Child app  (com.surabhikunj.voice.kids) → DevicePolicyManager (DPC),
--              reports location + app usage, polls command queue
--
-- Auth model:
--   · Parent uses their existing profiles/auth.users account.
--   · Each pc_device gets its own auth.users row (email:
--     device-<android_id>@voice.kids) so the child app can authenticate
--     with narrow RLS — the parent creates this account during enrollment.
--   · Until a device has auth_user_id set, the parent's session is used
--     for everything (enrollment phase).
--
-- Multi-tenancy: every table carries org_id so RLS stays org-scoped.
-- =====================================================================

-- ── ENUMS ─────────────────────────────────────────────────────────────

CREATE TYPE pc_device_owner_mode AS ENUM (
  'none',          -- app installed normally, no admin rights
  'device_admin',  -- legacy Device Administrator (limited)
  'device_owner'   -- full Device Owner via QR provisioning
);

CREATE TYPE pc_app_rule_action AS ENUM (
  'allow',
  'block',
  'time_limit'
);

CREATE TYPE pc_schedule_action AS ENUM (
  'block_all',          -- suspend all non-whitelisted apps + network
  'block_internet',     -- network off, apps still usable
  'allow_list_only'     -- only whitelisted packages remain usable
);

CREATE TYPE pc_command_type AS ENUM (
  'pause_internet',
  'resume_internet',
  'lock_device',
  'sync_rules',
  'grant_bonus_time',
  'revoke_bonus_time',
  'sos_ack',
  'factory_reset'   -- nuclear option, requires extra confirmation
);

CREATE TYPE pc_command_status AS ENUM (
  'pending',
  'delivered',
  'executed',
  'failed',
  'cancelled'
);

CREATE TYPE pc_alert_type AS ENUM (
  'sos',
  'geofence_enter',
  'geofence_exit',
  'screen_time_exceeded',
  'app_time_limit_exceeded',
  'blocked_app_attempt',
  'device_offline',
  'bonus_time_requested',
  'low_battery',
  'device_enrolled'
);

CREATE TYPE pc_alert_severity AS ENUM ('info', 'warning', 'critical');

CREATE TYPE pc_bonus_request_status AS ENUM ('pending', 'approved', 'denied');

CREATE TYPE pc_geofence_event_type AS ENUM ('enter', 'exit', 'dwell');

CREATE TYPE pc_age_group AS ENUM ('toddler', 'child', 'preteen', 'teen');

-- ── CHILDREN ──────────────────────────────────────────────────────────

CREATE TABLE pc_children (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  date_of_birth DATE,
  age_group     pc_age_group,
  -- Optional: child's own Supabase auth account (set after enrollment)
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEVICES ───────────────────────────────────────────────────────────

CREATE TABLE pc_devices (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id            UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Human-readable label set by parent
  device_name         TEXT,

  -- Android identifiers
  android_id          TEXT,          -- Settings.Secure.ANDROID_ID (stable post-enrollment)
  manufacturer        TEXT,
  model               TEXT,
  android_version     TEXT,          -- e.g. "14"
  sdk_version         INTEGER,       -- e.g. 34

  -- App info
  app_version         TEXT,          -- VOICE Kids versionName
  fcm_token           TEXT,          -- FCM push token for parent→child commands

  -- Device Owner state
  device_owner_mode   pc_device_owner_mode NOT NULL DEFAULT 'none',

  -- QR provisioning token (JSON blob scanned during factory-reset setup)
  provisioning_token  TEXT,

  -- Auth for child app narrow-scope RLS
  auth_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Heartbeat
  last_seen_at        TIMESTAMPTZ,

  is_active           BOOLEAN DEFAULT TRUE,
  enrolled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (android_id)   -- one row per physical device
);

-- ── APP RULES ─────────────────────────────────────────────────────────

CREATE TABLE pc_app_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id        UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  -- NULL device_id = rule applies to ALL devices of this child
  device_id       UUID REFERENCES pc_devices(id) ON DELETE CASCADE,
  package_name    TEXT NOT NULL,
  app_name        TEXT,                  -- display label, refreshed from device
  action          pc_app_rule_action NOT NULL,
  -- only relevant when action = 'time_limit'
  daily_limit_min INTEGER,
  is_enabled      BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (child_id, device_id, package_name)
);

-- ── SCHEDULES (time-of-day blocking windows) ──────────────────────────

CREATE TABLE pc_schedules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id      UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES pc_devices(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                    -- "School Time", "Bedtime"
  days_of_week  SMALLINT[] NOT NULL,              -- 0=Sun … 6=Sat
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  action        pc_schedule_action NOT NULL DEFAULT 'block_all',
  -- Packages always allowed even during a block_all schedule (e.g. phone dialer)
  always_allowed_packages TEXT[],
  is_enabled    BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROUTINES (named rule presets that auto-activate) ──────────────────

CREATE TABLE pc_routines (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id          UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,        -- "School Mode", "Bedtime", "Weekend"
  description       TEXT,
  block_internet    BOOLEAN DEFAULT FALSE,
  allow_sos_only    BOOLEAN DEFAULT FALSE, -- only SOS app reachable
  allowed_packages  TEXT[],               -- whitelist (NULL = no restriction)
  blocked_packages  TEXT[],               -- extra blocks on top of app_rules
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pc_routine_schedules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  routine_id    UUID NOT NULL REFERENCES pc_routines(id) ON DELETE CASCADE,
  days_of_week  SMALLINT[] NOT NULL,
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  is_enabled    BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── GEOFENCES ─────────────────────────────────────────────────────────

CREATE TABLE pc_geofences (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id          UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,           -- "Home", "School", "Grandma"
  latitude          DOUBLE PRECISION NOT NULL,
  longitude         DOUBLE PRECISION NOT NULL,
  radius_meters     INTEGER NOT NULL DEFAULT 200,
  notify_arrival    BOOLEAN DEFAULT TRUE,
  notify_departure  BOOLEAN DEFAULT TRUE,
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── LOCATION EVENTS (GPS pings) ───────────────────────────────────────
-- High-volume table — partitioning by month can be added later.
-- Retention: recommend a scheduled job to DELETE rows older than 90 days.

CREATE TABLE pc_location_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id       UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  child_id        UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  accuracy_meters REAL,
  speed_mps       REAL,
  altitude_meters REAL,
  -- recorded_at is the on-device GPS timestamp (authoritative)
  recorded_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── GEOFENCE EVENTS ───────────────────────────────────────────────────
-- Enter/exit computed on the device (Android GeofencingClient), stored here.

CREATE TABLE pc_geofence_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id     UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  child_id      UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  geofence_id   UUID NOT NULL REFERENCES pc_geofences(id) ON DELETE CASCADE,
  event_type    pc_geofence_event_type NOT NULL,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── APP USAGE EVENTS (from UsageStatsManager) ─────────────────────────
-- One row per app per calendar day per device.
-- The child app upserts this daily (or on app foreground).

CREATE TABLE pc_app_usage_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id             UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  child_id              UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  package_name          TEXT NOT NULL,
  app_name              TEXT,
  usage_date            DATE NOT NULL,
  total_foreground_ms   BIGINT NOT NULL DEFAULT 0,
  first_use_at          TIMESTAMPTZ,
  last_use_at           TIMESTAMPTZ,
  reported_at           TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (device_id, package_name, usage_date)
);

-- ── INSTALLED APPS (snapshot, refreshed by child app on boot/daily) ───

CREATE TABLE pc_installed_apps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id       UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  package_name    TEXT NOT NULL,
  app_name        TEXT,
  version_name    TEXT,
  -- coarse category derived from Play Store category on device
  category        TEXT,
  is_system_app   BOOLEAN DEFAULT FALSE,
  installed_at    TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (device_id, package_name)
);

-- ── ALERTS (parent-facing notifications) ──────────────────────────────

CREATE TABLE pc_alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id    UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id   UUID REFERENCES pc_devices(id) ON DELETE SET NULL,
  alert_type  pc_alert_type NOT NULL,
  severity    pc_alert_severity NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  -- flexible extra context (geofence name, package name, coordinates…)
  metadata    JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── SOS EVENTS (panic button) ─────────────────────────────────────────

CREATE TABLE pc_sos_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id       UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  child_id        UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  accuracy_meters REAL,
  notes           TEXT,
  responded_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  responded_at    TIMESTAMPTZ,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── BONUS TIME REQUESTS ───────────────────────────────────────────────

CREATE TABLE pc_bonus_time_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id      UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES pc_devices(id) ON DELETE SET NULL,
  requested_min INTEGER NOT NULL CHECK (requested_min > 0),
  reason        TEXT,
  status        pc_bonus_request_status NOT NULL DEFAULT 'pending',
  -- parent may grant a different amount than requested
  approved_min  INTEGER CHECK (approved_min > 0),
  resolved_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  -- when the granted bonus expires (set on approval)
  expires_at    TIMESTAMPTZ,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEVICE COMMAND QUEUE (parent → child device) ──────────────────────
-- Child app polls this table (or uses Realtime) for pending commands.

CREATE TABLE pc_device_commands (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id     UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  command_type  pc_command_type NOT NULL,
  -- arbitrary JSON payload (e.g. {bonus_minutes: 30, expires_at: "..."})
  payload       JSONB,
  status        pc_command_status NOT NULL DEFAULT 'pending',
  issued_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  delivered_at  TIMESTAMPTZ,   -- child app ACKed receipt
  executed_at   TIMESTAMPTZ,   -- child app confirmed execution
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ══════════════════════════════════════════════════════════════════════

-- Children & devices (parent dashboard lookups)
CREATE INDEX idx_pc_children_parent   ON pc_children (parent_id);
CREATE INDEX idx_pc_children_org      ON pc_children (org_id);
CREATE INDEX idx_pc_devices_child     ON pc_devices  (child_id);

-- Location history (time-range queries)
CREATE INDEX idx_pc_location_device_time  ON pc_location_events (device_id, recorded_at DESC);
CREATE INDEX idx_pc_location_child_time   ON pc_location_events (child_id,  recorded_at DESC);

-- Geofence events
CREATE INDEX idx_pc_geofence_ev_child ON pc_geofence_events (child_id, occurred_at DESC);

-- App usage (daily reports, most-used-app queries)
CREATE INDEX idx_pc_usage_device_date ON pc_app_usage_events (device_id, usage_date DESC);
CREATE INDEX idx_pc_usage_child_date  ON pc_app_usage_events (child_id,  usage_date DESC);

-- Alerts (unread badge count, alert feed)
CREATE INDEX idx_pc_alerts_child_unread ON pc_alerts (child_id, is_read, occurred_at DESC);

-- Commands (child app polls for pending)
CREATE INDEX idx_pc_commands_device_status ON pc_device_commands (device_id, status, created_at);

-- Bonus requests
CREATE INDEX idx_pc_bonus_child_status ON pc_bonus_time_requests (child_id, status, requested_at DESC);

-- ══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE pc_children              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_devices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_app_rules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_schedules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_routines              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_routine_schedules     ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_geofences             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_location_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_geofence_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_app_usage_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_installed_apps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_alerts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_sos_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_bonus_time_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_device_commands       ENABLE ROW LEVEL SECURITY;

-- ── Helper: is this JWT the parent of a given child? ──────────────────

CREATE OR REPLACE FUNCTION pc_is_parent_of(p_child_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pc_children
    WHERE id = p_child_id
      AND parent_id = auth.uid()
  );
$$;

-- ── Helper: is this JWT the device auth user for a given device? ───────

CREATE OR REPLACE FUNCTION pc_is_device_auth(p_device_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pc_devices
    WHERE id = p_device_id
      AND auth_user_id = auth.uid()
  );
$$;

-- ── pc_children ────────────────────────────────────────────────────────

CREATE POLICY "pc_children_parent_all"
  ON pc_children FOR ALL
  USING  (parent_id = auth.uid())
  WITH CHECK (parent_id = auth.uid());

-- ── pc_devices ─────────────────────────────────────────────────────────

-- Parent: full access to devices of their children
CREATE POLICY "pc_devices_parent_all"
  ON pc_devices FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

-- Child device auth: can SELECT and UPDATE their own device row
-- (heartbeat, fcm_token, app_version, last_seen_at)
CREATE POLICY "pc_devices_device_select"
  ON pc_devices FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "pc_devices_device_update"
  ON pc_devices FOR UPDATE
  USING  (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ── pc_app_rules ───────────────────────────────────────────────────────

CREATE POLICY "pc_app_rules_parent_all"
  ON pc_app_rules FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

-- Child device: read-only (rules for this specific device, or child-wide rules)
CREATE POLICY "pc_app_rules_device_select"
  ON pc_app_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_app_rules.child_id
        AND (pc_app_rules.device_id IS NULL OR pc_app_rules.device_id = d.id)
    )
  );

-- ── pc_schedules ───────────────────────────────────────────────────────

CREATE POLICY "pc_schedules_parent_all"
  ON pc_schedules FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_schedules_device_select"
  ON pc_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE (d.id = device_id OR device_id IS NULL)
        AND d.auth_user_id = auth.uid()
    )
  );

-- ── pc_routines ────────────────────────────────────────────────────────

CREATE POLICY "pc_routines_parent_all"
  ON pc_routines FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_routines_device_select"
  ON pc_routines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_children c
        JOIN pc_devices d ON d.child_id = c.id
      WHERE c.id = child_id
        AND d.auth_user_id = auth.uid()
    )
  );

-- ── pc_routine_schedules ───────────────────────────────────────────────

CREATE POLICY "pc_routine_schedules_parent_all"
  ON pc_routine_schedules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM pc_routines r
      WHERE r.id = routine_id
        AND pc_is_parent_of(r.child_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pc_routines r
      WHERE r.id = routine_id
        AND pc_is_parent_of(r.child_id)
    )
  );

CREATE POLICY "pc_routine_schedules_device_select"
  ON pc_routine_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_routines r
        JOIN pc_children c  ON c.id = r.child_id
        JOIN pc_devices  d  ON d.child_id = c.id
      WHERE r.id = routine_id
        AND d.auth_user_id = auth.uid()
    )
  );

-- ── pc_geofences ───────────────────────────────────────────────────────

CREATE POLICY "pc_geofences_parent_all"
  ON pc_geofences FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_geofences_device_select"
  ON pc_geofences FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_children c
        JOIN pc_devices d ON d.child_id = c.id
      WHERE c.id = child_id
        AND d.auth_user_id = auth.uid()
    )
  );

-- ── pc_location_events ─────────────────────────────────────────────────

-- Parent: read only (cannot tamper with child's location log)
CREATE POLICY "pc_location_events_parent_select"
  ON pc_location_events FOR SELECT
  USING (pc_is_parent_of(child_id));

-- Child device: insert only (cannot read other devices' data)
CREATE POLICY "pc_location_events_device_insert"
  ON pc_location_events FOR INSERT
  WITH CHECK (pc_is_device_auth(device_id));

-- ── pc_geofence_events ─────────────────────────────────────────────────

CREATE POLICY "pc_geofence_events_parent_select"
  ON pc_geofence_events FOR SELECT
  USING (pc_is_parent_of(child_id));

CREATE POLICY "pc_geofence_events_device_insert"
  ON pc_geofence_events FOR INSERT
  WITH CHECK (pc_is_device_auth(device_id));

-- ── pc_app_usage_events ────────────────────────────────────────────────

CREATE POLICY "pc_app_usage_parent_select"
  ON pc_app_usage_events FOR SELECT
  USING (pc_is_parent_of(child_id));

-- Upsert: device can INSERT and UPDATE (for the daily aggregated row)
CREATE POLICY "pc_app_usage_device_insert"
  ON pc_app_usage_events FOR INSERT
  WITH CHECK (pc_is_device_auth(device_id));

CREATE POLICY "pc_app_usage_device_update"
  ON pc_app_usage_events FOR UPDATE
  USING  (pc_is_device_auth(device_id))
  WITH CHECK (pc_is_device_auth(device_id));

-- ── pc_installed_apps ──────────────────────────────────────────────────

CREATE POLICY "pc_installed_apps_parent_select"
  ON pc_installed_apps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
        JOIN pc_children c ON c.id = d.child_id
      WHERE d.id = device_id
        AND c.parent_id = auth.uid()
    )
  );

CREATE POLICY "pc_installed_apps_device_upsert"
  ON pc_installed_apps FOR INSERT
  WITH CHECK (pc_is_device_auth(device_id));

CREATE POLICY "pc_installed_apps_device_update"
  ON pc_installed_apps FOR UPDATE
  USING  (pc_is_device_auth(device_id))
  WITH CHECK (pc_is_device_auth(device_id));

-- ── pc_alerts ──────────────────────────────────────────────────────────

-- Parent: full read; UPDATE (mark as read)
CREATE POLICY "pc_alerts_parent_select"
  ON pc_alerts FOR SELECT
  USING (pc_is_parent_of(child_id));

CREATE POLICY "pc_alerts_parent_update"
  ON pc_alerts FOR UPDATE
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

-- Child device: insert alerts (screen time exceeded, blocked app attempt)
CREATE POLICY "pc_alerts_device_insert"
  ON pc_alerts FOR INSERT
  WITH CHECK (
    device_id IS NOT NULL
    AND pc_is_device_auth(device_id)
  );

-- ── pc_sos_events ──────────────────────────────────────────────────────

CREATE POLICY "pc_sos_parent_select"
  ON pc_sos_events FOR SELECT
  USING (pc_is_parent_of(child_id));

CREATE POLICY "pc_sos_parent_update"
  ON pc_sos_events FOR UPDATE
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_sos_device_insert"
  ON pc_sos_events FOR INSERT
  WITH CHECK (pc_is_device_auth(device_id));

-- ── pc_bonus_time_requests ─────────────────────────────────────────────

-- Child device: insert requests; parent: read + update (approve/deny)
CREATE POLICY "pc_bonus_device_insert"
  ON pc_bonus_time_requests FOR INSERT
  WITH CHECK (
    device_id IS NOT NULL
    AND pc_is_device_auth(device_id)
  );

CREATE POLICY "pc_bonus_parent_select"
  ON pc_bonus_time_requests FOR SELECT
  USING (pc_is_parent_of(child_id));

CREATE POLICY "pc_bonus_parent_update"
  ON pc_bonus_time_requests FOR UPDATE
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

-- ── pc_device_commands ─────────────────────────────────────────────────

-- Parent: INSERT (issue commands); SELECT own commands
CREATE POLICY "pc_commands_parent_insert"
  ON pc_device_commands FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pc_devices d
        JOIN pc_children c ON c.id = d.child_id
      WHERE d.id = device_id
        AND c.parent_id = auth.uid()
    )
  );

CREATE POLICY "pc_commands_parent_select"
  ON pc_device_commands FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
        JOIN pc_children c ON c.id = d.child_id
      WHERE d.id = device_id
        AND c.parent_id = auth.uid()
    )
  );

-- Child device: SELECT pending commands; UPDATE status (delivered/executed/failed)
CREATE POLICY "pc_commands_device_select"
  ON pc_device_commands FOR SELECT
  USING (pc_is_device_auth(device_id));

CREATE POLICY "pc_commands_device_update"
  ON pc_device_commands FOR UPDATE
  USING  (pc_is_device_auth(device_id))
  WITH CHECK (pc_is_device_auth(device_id));

-- ══════════════════════════════════════════════════════════════════════
-- REALTIME — enable for tables the parent dashboard / child app poll
-- ══════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE pc_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE pc_device_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE pc_sos_events;
ALTER PUBLICATION supabase_realtime ADD TABLE pc_location_events;
ALTER PUBLICATION supabase_realtime ADD TABLE pc_bonus_time_requests;


-- FILE: 53_pairing_codes.sql

-- =====================================================================
-- 53. DEVICE PAIRING CODES — secure enrollment handshake
-- =====================================================================
-- Replaces the earlier plaintext-password-in-JSONB pairing idea with a
-- short-lived, single-use, hashed code:
--
--   1. Parent app calls edge fn "pc-generate-pairing-code" with
--      { child_id, device_name }.
--      → creates a pc_devices row + a device-only auth.users row with a
--        random (never-exposed) password, generates a 6-char code,
--        stores SHA-256(code) here with a 10-minute expiry, and shows
--        the plaintext code to the parent (or renders it as a QR).
--
--   2. Child app calls edge fn "pc-redeem-pairing-code" with
--      { pairing_code }.
--      → hashes the code, looks up this table, checks expiry/used_at,
--        mints a real Supabase session for the device auth user via
--        generateLink + verifyOtp (service role never returns a
--        password), marks the code used, and returns the session.
--
-- Only the edge functions (service_role) touch this table directly —
-- RLS still restricts any accidental anon/authenticated access.
-- =====================================================================

CREATE TABLE pc_pairing_codes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id    UUID NOT NULL REFERENCES pc_devices(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,             -- SHA-256 hex digest of the plaintext code
  issued_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pc_pairing_codes_hash ON pc_pairing_codes (code_hash) WHERE used_at IS NULL;
CREATE INDEX idx_pc_pairing_codes_device ON pc_pairing_codes (device_id);

ALTER TABLE pc_pairing_codes ENABLE ROW LEVEL SECURITY;

-- No direct client policies — this table is service-role only (edge functions).
-- Parents view enrollment status via pc_devices.enrolled_at instead.

ALTER PUBLICATION supabase_realtime ADD TABLE pc_pairing_codes;

-- Housekeeping: periodically purge expired/used codes (call from a cron
-- edge function or pg_cron if enabled; safe to run manually too).
CREATE OR REPLACE FUNCTION pc_purge_expired_pairing_codes()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM pc_pairing_codes
  WHERE expires_at < NOW() - INTERVAL '1 day';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


-- FILE: 54_parental_control_module.sql

-- =====================================================================
-- 54. REGISTER PARENTAL CONTROL NAV MODULE
-- =====================================================================
-- Parental Control isn't gated by an org RBAC permission — access to a
-- child's data is enforced at the row level (pc_is_parent_of(), matching
-- pc_children.parent_id = auth.uid()), so any active member of an org can
-- see the nav entry and manage only the children/devices they created.
--
-- Idempotent.
-- =====================================================================

INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('parental_control', 'Parental Control', 'Manage children, devices, screen time and safety alerts',
   'ShieldCheck', '/parental-control', 'family', NULL, FALSE, TRUE, 70)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      sort_order          = EXCLUDED.sort_order;

INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key = 'parental_control'
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled = TRUE, updated_at = NOW()
WHERE module_key = 'parental_control'
  AND enabled IS DISTINCT FROM TRUE;

NOTIFY pgrst, 'reload schema';


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

