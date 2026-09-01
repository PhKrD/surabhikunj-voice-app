-- =====================================================================
-- 59. PHASE 2 — Screen-Time Management + Audit log foundation
-- =====================================================================
-- Adds authoritative daily screen-time limits and a lightweight audit
-- trail for critical parental actions (Phase 9 seed). RLS keeps parent
-- scope consistent with the rest of the pc_* schema.

-- ── SCREEN TIME RULES ─────────────────────────────────────────────────
-- One row per child. If a per-device override is needed later, a nullable
-- device_id can be added; for Phase 2 the limit is child-wide.

CREATE TABLE pc_screen_time_rules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id        UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  daily_limit_min INTEGER NOT NULL CHECK (daily_limit_min >= 0),
  -- Allow a small grace window (minutes) before enforcement kicks in
  grace_min       INTEGER NOT NULL DEFAULT 0 CHECK (grace_min >= 0),
  is_enabled      BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (child_id)
);

-- ── AUDIT LOG (Phase 9 seed) ──────────────────────────────────────────
-- Immutable record of security-relevant actions: device lock/unlock,
-- internet pause/resume, pairing, rule changes, etc.

CREATE TABLE pc_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id    UUID REFERENCES pc_children(id) ON DELETE CASCADE,
  device_id   UUID REFERENCES pc_devices(id) ON DELETE SET NULL,
  actor_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,          -- 'lock_device','pause_internet','update_rule',...
  target      TEXT,                   -- affected entity summary
  metadata    JSONB,                  -- non-PII change details
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ───────────────────────────────────────────────────────────
CREATE INDEX idx_pc_screen_time_child ON pc_screen_time_rules (child_id);
CREATE INDEX idx_pc_audit_child        ON pc_audit_log (child_id, created_at DESC);
CREATE INDEX idx_pc_audit_actor        ON pc_audit_log (actor_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE pc_screen_time_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_audit_log         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pc_screen_time_rules_parent_all"
  ON pc_screen_time_rules FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

CREATE POLICY "pc_screen_time_rules_device_select"
  ON pc_screen_time_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_screen_time_rules.child_id
    )
  );

-- Audit log is read-only for parents (writers are service/backend)
CREATE POLICY "pc_audit_log_parent_select"
  ON pc_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_children c
      WHERE c.id = pc_audit_log.child_id
        AND c.parent_id = auth.uid()
    )
  );

-- Trigger: updated_at for screen time rules
CREATE OR REPLACE FUNCTION pc_update_screen_time_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pc_screen_time_rules_updated_at
  BEFORE UPDATE ON pc_screen_time_rules
  FOR EACH ROW EXECUTE FUNCTION pc_update_screen_time_updated_at();
