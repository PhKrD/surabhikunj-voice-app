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
  'unlock_device',
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
