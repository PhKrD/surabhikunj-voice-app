-- =====================================================================
-- 70. PARENTAL CONTROL — QUSTODIO-PARITY PASS
-- =====================================================================
-- Closes the functional gaps between this module and a mainstream
-- consumer parental-control product (Qustodio) WITHOUT requiring Device
-- Owner / a factory reset. Everything here is enforced natively on the
-- child device by android/.../dpc/PolicyEnforcer.kt under the default
-- Device Admin + Accessibility model. Idempotent, additive only.
--
--  1. Daily time limits: a separate limit PER WEEKDAY plus a configurable
--     "when the limit is reached" action (lock navigation / lock device /
--     alert only), on pc_screen_time_rules.
--  2. Restricted times: Qustodio's weekly hour grid (7 days x 24 hours),
--     one row per child in pc_restricted_times.
--  3. Games & Apps: per-app "alert me when used" flag + optional
--     per-weekday time limits on pc_app_rules.
--  4. Web filtering: a third 'alert' action (allow but notify) for both
--     categories and individual websites.
--  5. New alert types: app_opened ("alert me when used"), website_alert
--     (the new 'alert' web-filter action).
--  6. pc_devices.device_owner_mode is now DERIVED from the device's own
--     enforcement_state report (device_admin / device_owner flags) — the
--     column was set to 'none' at pairing and never updated, so the
--     parent UI showed "Not enrolled" forever. Migration 63 forbids the
--     device from writing that column directly, so a trigger that runs
--     AFTER the 63 lock trigger (alphabetical BEFORE-trigger ordering)
--     derives it server-side from the telemetry the device IS allowed to
--     write.
--  7. Policy-version bump triggers for the tables added in 69 (category
--     rules / filter settings) and the new pc_restricted_times — without
--     these the parent UI's "syncing / in sync" indicator never noticed a
--     web-filter change.
--  8. Push notifications for parents: every pc_alerts INSERT now fans out
--     through the existing notify() backbone (40_notification_backbone.sql)
--     to the child's parent, so SOS / blocked attempts / limit reached
--     arrive as real push + in-app notifications instead of only being
--     visible when the Alerts tab happens to be open.
-- =====================================================================


-- ══════════════════════════════════════════════════════════════════════
-- 1. DAILY TIME LIMITS — per weekday + limit action
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pc_screen_time_rules
  -- {"0": 120, "1": 60, ... "6": 180} — minutes per JS getDay() weekday
  -- (0 = Sunday). A missing key falls back to daily_limit_min.
  ADD COLUMN IF NOT EXISTS daily_limits_by_dow JSONB,
  ADD COLUMN IF NOT EXISTS limit_action TEXT NOT NULL DEFAULT 'lock_navigation',
  ADD COLUMN IF NOT EXISTS alert_on_limit BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.pc_screen_time_rules
  DROP CONSTRAINT IF EXISTS pc_screen_time_rules_limit_action_check;
ALTER TABLE public.pc_screen_time_rules
  ADD CONSTRAINT pc_screen_time_rules_limit_action_check
  CHECK (limit_action IN ('lock_navigation', 'lock_device', 'alert_only'));

COMMENT ON COLUMN public.pc_screen_time_rules.daily_limits_by_dow IS
  'Per-weekday daily limit in minutes keyed by JS getDay() ("0"=Sun … "6"=Sat). Missing key => daily_limit_min applies. 0 = no screen time that day.';
COMMENT ON COLUMN public.pc_screen_time_rules.limit_action IS
  'What the device does once today''s limit is reached: lock_navigation (block every app except always-allowed + pause internet), lock_device (same + lockNow()), alert_only (just notify the parent).';


-- ══════════════════════════════════════════════════════════════════════
-- 2. RESTRICTED TIMES — weekly hour grid
-- ══════════════════════════════════════════════════════════════════════
-- One row per child. `cells` is {"0": [22,23,0,1,2,3,4,5,6], "1": [...]}:
-- for each JS weekday, the list of hours (0-23) during which the device is
-- restricted. Enforced natively like a block_all schedule; the emergency
-- dialer + VOICE itself are always reachable (same protected-package rule
-- as everywhere else).

CREATE TABLE IF NOT EXISTS public.pc_restricted_times (
  child_id    UUID PRIMARY KEY REFERENCES public.pc_children(id) ON DELETE CASCADE,
  cells       JSONB NOT NULL DEFAULT '{}'::jsonb,
  action      TEXT NOT NULL DEFAULT 'lock_navigation',
  is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT pc_restricted_times_action_check
    CHECK (action IN ('lock_navigation', 'lock_device', 'block_internet'))
);

ALTER TABLE public.pc_restricted_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_restricted_times_parent_all" ON public.pc_restricted_times;
CREATE POLICY "pc_restricted_times_parent_all"
  ON public.pc_restricted_times FOR ALL
  USING  (public.pc_is_parent_of(child_id))
  WITH CHECK (public.pc_is_parent_of(child_id));

DROP POLICY IF EXISTS "pc_restricted_times_device_select" ON public.pc_restricted_times;
CREATE POLICY "pc_restricted_times_device_select"
  ON public.pc_restricted_times FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_restricted_times.child_id
    )
  );

CREATE OR REPLACE FUNCTION public.pc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_restricted_times_updated_at ON public.pc_restricted_times;
CREATE TRIGGER trg_pc_restricted_times_updated_at
  BEFORE UPDATE ON public.pc_restricted_times
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_updated_at();


-- ══════════════════════════════════════════════════════════════════════
-- 3. GAMES & APPS — alert on use + per-weekday limits
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pc_app_rules
  ADD COLUMN IF NOT EXISTS alert_on_use BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS daily_limits_by_dow JSONB;

COMMENT ON COLUMN public.pc_app_rules.alert_on_use IS
  'Raise a (rate-limited) app_opened alert to the parent every time this app comes to the foreground on the child device.';
COMMENT ON COLUMN public.pc_app_rules.daily_limits_by_dow IS
  'Optional per-weekday override of daily_limit_min for time_limit rules, keyed by JS getDay() ("0"=Sun … "6"=Sat).';


-- ══════════════════════════════════════════════════════════════════════
-- 4. WEB FILTERING — 'alert' action
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.pc_website_rules
  DROP CONSTRAINT IF EXISTS pc_website_rules_action_check;
ALTER TABLE public.pc_website_rules
  ADD CONSTRAINT pc_website_rules_action_check
  CHECK (action IN ('allow', 'block', 'alert'));

ALTER TABLE public.pc_website_category_rules
  DROP CONSTRAINT IF EXISTS pc_website_category_rules_action_check;
ALTER TABLE public.pc_website_category_rules
  ADD CONSTRAINT pc_website_category_rules_action_check
  CHECK (action IN ('allow', 'block', 'alert'));


-- ══════════════════════════════════════════════════════════════════════
-- 5. NEW ALERT TYPES
-- ══════════════════════════════════════════════════════════════════════

-- (daily-limit-reached keeps using the existing 'screen_time_exceeded' type.)
ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'app_opened';
ALTER TYPE public.pc_alert_type ADD VALUE IF NOT EXISTS 'website_alert';


-- ══════════════════════════════════════════════════════════════════════
-- 6. device_owner_mode DERIVED FROM enforcement_state
-- ══════════════════════════════════════════════════════════════════════
-- Trigger name deliberately sorts AFTER trg_pc_devices_lock_identity so the
-- 63 lock check still sees NEW.device_owner_mode == OLD.device_owner_mode
-- (a device is not allowed to set it directly) and THEN this derives it.

CREATE OR REPLACE FUNCTION public.pc_derive_device_owner_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.enforcement_state IS NOT NULL
     AND NEW.enforcement_state IS DISTINCT FROM OLD.enforcement_state THEN
    IF COALESCE((NEW.enforcement_state->>'device_owner')::boolean, FALSE) THEN
      NEW.device_owner_mode := 'device_owner';
    ELSIF COALESCE((NEW.enforcement_state->>'device_admin')::boolean, FALSE) THEN
      NEW.device_owner_mode := 'device_admin';
    ELSE
      NEW.device_owner_mode := 'none';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_devices_zz_derive_owner_mode ON public.pc_devices;
CREATE TRIGGER trg_pc_devices_zz_derive_owner_mode
  BEFORE UPDATE ON public.pc_devices
  FOR EACH ROW EXECUTE FUNCTION public.pc_derive_device_owner_mode();

-- Backfill from whatever the devices have already reported.
UPDATE public.pc_devices
   SET device_owner_mode = CASE
     WHEN COALESCE((enforcement_state->>'device_owner')::boolean, FALSE) THEN 'device_owner'::pc_device_owner_mode
     WHEN COALESCE((enforcement_state->>'device_admin')::boolean, FALSE) THEN 'device_admin'::pc_device_owner_mode
     ELSE 'none'::pc_device_owner_mode
   END
 WHERE enforcement_state IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════
-- 7. POLICY-VERSION BUMPS for 69 tables + restricted times
-- ══════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_pc_website_category_rules_bump_policy ON public.pc_website_category_rules;
CREATE TRIGGER trg_pc_website_category_rules_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_website_category_rules
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();

DROP TRIGGER IF EXISTS trg_pc_website_filter_settings_bump_policy ON public.pc_website_filter_settings;
CREATE TRIGGER trg_pc_website_filter_settings_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_website_filter_settings
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();

DROP TRIGGER IF EXISTS trg_pc_restricted_times_bump_policy ON public.pc_restricted_times;
CREATE TRIGGER trg_pc_restricted_times_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_restricted_times
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();


-- ══════════════════════════════════════════════════════════════════════
-- 8. PARENT PUSH NOTIFICATIONS for pc_alerts
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO public.notification_categories
  (key, label, description, icon, group_key, user_can_disable, default_push, default_inapp, default_whatsapp, sort_order)
VALUES
  ('parental.sos',      'Child SOS',              'Your child pressed the SOS button',                         'ShieldAlert', 'parental', FALSE, TRUE, TRUE, FALSE, 200),
  ('parental.alert',    'Parental Control Alerts','Limits reached, blocked attempts, tampering, location',    'Shield',      'parental', TRUE,  TRUE, TRUE, FALSE, 210),
  ('parental.activity', 'Child Activity',         'App opened / website visited notifications you asked for', 'Activity',    'parental', TRUE,  TRUE, TRUE, FALSE, 220)
ON CONFLICT (key) DO UPDATE
  SET label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      icon             = EXCLUDED.icon,
      group_key        = EXCLUDED.group_key,
      user_can_disable = EXCLUDED.user_can_disable,
      sort_order       = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.pc_notify_parent_on_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent   UUID;
  v_org      UUID;
  v_name     TEXT;
  v_category TEXT;
BEGIN
  SELECT parent_id, org_id, display_name INTO v_parent, v_org, v_name
    FROM public.pc_children WHERE id = NEW.child_id;
  IF v_parent IS NULL THEN
    RETURN NEW;
  END IF;

  v_category := CASE
    WHEN NEW.alert_type = 'sos' THEN 'parental.sos'
    WHEN NEW.alert_type IN ('app_opened', 'website_alert') THEN 'parental.activity'
    ELSE 'parental.alert'
  END;

  PERFORM public.notify(
    p_profile_id   => v_parent,
    p_category     => v_category,
    p_title        => COALESCE(v_name, 'Child') || ': ' || NEW.title,
    p_body         => NEW.body,
    p_reference_id => NEW.id,
    p_action_url   => '/parental-control/' || NEW.child_id::text,
    p_org_id       => v_org,
    p_force        => (NEW.severity = 'critical')
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification hiccup must never make the device's alert insert fail.
  RAISE WARNING 'pc_notify_parent_on_alert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_alerts_notify_parent ON public.pc_alerts;
CREATE TRIGGER trg_pc_alerts_notify_parent
  AFTER INSERT ON public.pc_alerts
  FOR EACH ROW EXECUTE FUNCTION public.pc_notify_parent_on_alert();

-- Realtime for the new table so the parent UI can live-update.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pc_restricted_times;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;

NOTIFY pgrst, 'reload schema';
