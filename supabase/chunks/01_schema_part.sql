-- CHUNK 1 (schema files)

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

