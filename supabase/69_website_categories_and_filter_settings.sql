-- =====================================================================
-- 69. WEBSITE FILTERING: CATEGORIES + SETTINGS + BLOCK ALERTS
-- =====================================================================
-- Extends the existing per-domain pc_website_rules with:
--
-- 1. pc_website_category_rules — per-child allow/block for a curated
--    category (see src/lib/webCategories.js / android WebCategories.kt
--    for the category keys and their seed domain lists). NOT present
--    for a category = that category's own defaultAction (see
--    webCategories.js) applies.
--
-- 2. pc_website_filter_settings — one row per child holding the
--    Categories-tab gear-icon settings: apply_filters (master on/off),
--    block_unsupported_browsers, block_unknown_websites,
--    enforce_safe_search, alert_on_block.
--
-- 3. pc_alert_type gains 'website_blocked', raised (rate-limited) by the
--    native DNS filter when alert_on_block is enabled and a domain gets
--    blocked.
--
-- Idempotent, additive only.
-- =====================================================================

-- ── 1. Category rules ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pc_website_category_rules (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_id      UUID NOT NULL REFERENCES pc_children(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('allow', 'block')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (child_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_pc_website_category_rules_child
  ON pc_website_category_rules (child_id);

ALTER TABLE pc_website_category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_website_category_rules_parent_all" ON pc_website_category_rules;
CREATE POLICY "pc_website_category_rules_parent_all"
  ON pc_website_category_rules FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

DROP POLICY IF EXISTS "pc_website_category_rules_device_select" ON pc_website_category_rules;
CREATE POLICY "pc_website_category_rules_device_select"
  ON pc_website_category_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_website_category_rules.child_id
    )
  );

CREATE OR REPLACE FUNCTION pc_update_website_category_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pc_website_category_rules_updated_at ON pc_website_category_rules;
CREATE TRIGGER trg_pc_website_category_rules_updated_at
  BEFORE UPDATE ON pc_website_category_rules
  FOR EACH ROW EXECUTE FUNCTION pc_update_website_category_rules_updated_at();

-- ── 2. Per-child filter settings ────────────────────────────────────

CREATE TABLE IF NOT EXISTS pc_website_filter_settings (
  child_id                    UUID PRIMARY KEY REFERENCES pc_children(id) ON DELETE CASCADE,
  apply_filters               BOOLEAN NOT NULL DEFAULT TRUE,
  block_unsupported_browsers  BOOLEAN NOT NULL DEFAULT FALSE,
  block_unknown_websites      BOOLEAN NOT NULL DEFAULT FALSE,
  enforce_safe_search         BOOLEAN NOT NULL DEFAULT FALSE,
  alert_on_block              BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pc_website_filter_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_website_filter_settings_parent_all" ON pc_website_filter_settings;
CREATE POLICY "pc_website_filter_settings_parent_all"
  ON pc_website_filter_settings FOR ALL
  USING  (pc_is_parent_of(child_id))
  WITH CHECK (pc_is_parent_of(child_id));

DROP POLICY IF EXISTS "pc_website_filter_settings_device_select" ON pc_website_filter_settings;
CREATE POLICY "pc_website_filter_settings_device_select"
  ON pc_website_filter_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_website_filter_settings.child_id
    )
  );

CREATE OR REPLACE FUNCTION pc_update_website_filter_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pc_website_filter_settings_updated_at ON pc_website_filter_settings;
CREATE TRIGGER trg_pc_website_filter_settings_updated_at
  BEFORE UPDATE ON pc_website_filter_settings
  FOR EACH ROW EXECUTE FUNCTION pc_update_website_filter_settings_updated_at();

-- ── 3. Website-blocked alert type ───────────────────────────────────

ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'website_blocked';

NOTIFY pgrst, 'reload schema';
