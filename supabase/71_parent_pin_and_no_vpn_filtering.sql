-- =====================================================================
-- 71_parent_pin_and_no_vpn_filtering.sql
--
-- 1. pc_children.parent_pin_hash + protect_settings — the parent PIN that
--    guards the Settings screens which could switch supervision off on the
--    child's device (android/.../dpc/SettingsGuard.kt). Only the hash is
--    ever stored: sha256('<pin>:<child_id>'), lower-case hex, computed
--    identically by src/lib/parentPin.js and SettingsGuard.hashPin().
--    The child id is the salt. See src/lib/parentPin.js for the honest
--    limits of a 4–6 digit PIN.
--
-- 2. pc_website_filter_settings.use_vpn — the local DNS-filtering VPN is
--    now OPT-IN and OFF by default. Website blocking runs through the
--    accessibility service reading the browser address bar
--    (dpc/WebPolicy.kt), which needs no tunnel and cannot break unrelated
--    browsing. The VPN only adds coverage of non-browser apps, at the cost
--    of routing every DNS lookup on the phone through the app.
--
-- 3. pc_children_device_select — re-declared idempotently. PolicyEnforcer
--    reads the child row every pass (policy_version + the two columns
--    above) and silently stops enforcing without it. Originally added in
--    61_policy_integrity.sql, which may not have been applied.
--
-- Idempotent, additive only. Safe to re-run.
-- =====================================================================

-- ── 1. Parent PIN ─────────────────────────────────────────────────────

ALTER TABLE public.pc_children
  ADD COLUMN IF NOT EXISTS parent_pin_hash  TEXT,
  ADD COLUMN IF NOT EXISTS protect_settings BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.pc_children.parent_pin_hash IS
  'sha256(pin || '':'' || child_id), lower-case hex. NULL = no PIN set, and the '
  'on-device settings guard stays OFF (without a PIN there would be no way past '
  'it, which would lock the PARENT out of granting permissions).';

COMMENT ON COLUMN public.pc_children.protect_settings IS
  'Whether the child device blocks Settings screens that can disable supervision. '
  'Only takes effect once parent_pin_hash is set.';

-- ── 2. Website filtering without a VPN ────────────────────────────────

ALTER TABLE public.pc_website_filter_settings
  ADD COLUMN IF NOT EXISTS use_vpn BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.pc_website_filter_settings.use_vpn IS
  'Opt-in to the local DNS-filtering VPN. Off by default: browser-level blocking '
  'already works without it. Turning it on also covers non-browser apps, but puts '
  'every DNS lookup on the device through the app.';

-- Existing rows predate the column; the DEFAULT above already covers them,
-- but be explicit so an upgraded device never inherits a surprise tunnel.
UPDATE public.pc_website_filter_settings SET use_vpn = FALSE WHERE use_vpn IS NULL;

-- ── 3. Device must be able to read its own child row ──────────────────

DROP POLICY IF EXISTS "pc_children_device_select" ON public.pc_children;
CREATE POLICY "pc_children_device_select"
  ON public.pc_children FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pc_devices d
      WHERE d.child_id = pc_children.id
        AND d.auth_user_id = auth.uid()
    )
  );

-- ── 4. Alert types used by the new enforcement paths ──────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
-- PostgreSQL, so keep these as their own statements at the end of the file.

ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'tamper_detected';
ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'website_blocked';
ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'website_alert';
ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'app_opened';
