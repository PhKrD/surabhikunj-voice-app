-- =====================================================================
-- 60. PHASE 3 + 4 + 5 — Schedules, App Rules, Website Control
-- =====================================================================
-- Schedules already exist in 52. This migration adds website control
-- tables and a child_requests table for Phase 8.

-- ── WEBSITE RULES ─────────────────────────────────────────────────────
-- Domain-level allow/block lists. Enforcement requires DNS filtering or
-- VPN packet inspection; this schema stores the rules.

CREATE TABLE pc_website_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id        UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES pc_devices(id) ON DELETE CASCADE,
  domain         TEXT NOT NULL,          -- e.g. "youtube.com"
  action         TEXT NOT NULL CHECK (action IN ('allow', 'block')),
  is_enabled     BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (child_id, device_id, domain)
);

-- ── CHILD REQUESTS (Phase 8 — generalize beyond bonus time) ─────────────
-- Child can request: more screen time, app unblock, website access, etc.

CREATE TYPE pc_request_type AS ENUM (
  'bonus_time',
  'app_unblock',
  'website_access',
  'schedule_exception'
);

CREATE TYPE pc_request_status AS ENUM ('pending', 'approved', 'denied');

CREATE TABLE pc_child_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id      UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id     UUID REFERENCES pc_devices(id) ON DELETE SET NULL,
  request_type  pc_request_type NOT NULL,
  metadata      JSONB,                  -- {app: "com.instagram", domain: "tiktok.com", ...}
  reason        TEXT,
  status        pc_request_status NOT NULL DEFAULT 'pending',
  resolved_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,           -- for time-based grants
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────
CREATE INDEX idx_pc_website_rules_child ON pc_website_rules (child_id);
CREATE INDEX idx_pc_child_requests_child_status ON pc_child_requests (child_id, status, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE pc_website_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_child_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pc_website_rules_parent_all"
  ON pc_website_rules FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_website_rules_device_select"
  ON pc_website_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_website_rules.child_id
        AND (pc_website_rules.device_id IS NULL OR pc_website_rules.device_id = d.id)
    )
  );

CREATE POLICY "pc_child_requests_parent_all"
  ON pc_child_requests FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_child_requests_device_select"
  ON pc_child_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_child_requests.child_id
    )
  );

-- Triggers
CREATE OR REPLACE FUNCTION pc_update_website_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pc_website_rules_updated_at
  BEFORE UPDATE ON pc_website_rules
  FOR EACH ROW EXECUTE FUNCTION pc_update_website_rules_updated_at();
