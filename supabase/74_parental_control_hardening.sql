-- 74_parental_control_hardening.sql
--
-- Security + reliability hardening for the Parental Control module, from the
-- October 2026 production audit. Additive and idempotent: safe to re-run;
-- no table or column is dropped, no data is changed.
--
-- 1. CROSS-FAMILY READ: pc_schedules_device_select (migration 52) let ANY
--    paired device read EVERY child's routines that weren't pinned to a
--    device (device_id IS NULL — i.e. nearly all of them), because it never
--    compared the schedule's child with the device's child. Fixed.
--
-- 2. FORGED ROWS: device INSERT policies checked only that the device_id was
--    the caller's own device, never that child_id was that device's child.
--    A paired device could therefore write alerts (fake SOS / tamper /
--    "arrived home"), location points, usage, SOS events, time requests and
--    audit entries into ANOTHER family's child. Every device-written table
--    now requires child_id = the device's own child.
--
-- 3. SECURITY DEFINER helpers without a pinned search_path. Pinned.
--
-- 4. NOTIFICATION FLOOD: every pc_alerts row became a parent push. Repeats
--    (the same blocked app, the same tamper reminder, geofence wobble) now
--    stay in the in-app list but only push once per cool-down window. SOS
--    and anything critical-and-new always push.
--
-- 5. Index for the device's own frequent query pattern + the dedupe check.

-- ── helper ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pc_device_owns_child(p_device_id UUID, p_child_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pc_devices d
    WHERE d.id = p_device_id
      AND d.auth_user_id = auth.uid()
      AND d.child_id = p_child_id
  );
$$;

ALTER FUNCTION public.pc_is_parent_of(UUID)   SET search_path = public;
ALTER FUNCTION public.pc_is_device_auth(UUID) SET search_path = public;

-- ── 1. routines readable only by the child's own devices ──────────────

DROP POLICY IF EXISTS "pc_schedules_device_select" ON public.pc_schedules;
CREATE POLICY "pc_schedules_device_select"
  ON public.pc_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pc_devices d
      WHERE d.auth_user_id = auth.uid()
        AND d.child_id = pc_schedules.child_id
        AND (pc_schedules.device_id IS NULL OR pc_schedules.device_id = d.id)
    )
  );

-- ── 2. device-written rows must belong to the device's own child ──────

DROP POLICY IF EXISTS "pc_alerts_device_insert" ON public.pc_alerts;
CREATE POLICY "pc_alerts_device_insert"
  ON public.pc_alerts FOR INSERT
  WITH CHECK (device_id IS NOT NULL AND public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_location_events_device_insert" ON public.pc_location_events;
CREATE POLICY "pc_location_events_device_insert"
  ON public.pc_location_events FOR INSERT
  WITH CHECK (public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_geofence_events_device_insert" ON public.pc_geofence_events;
CREATE POLICY "pc_geofence_events_device_insert"
  ON public.pc_geofence_events FOR INSERT
  WITH CHECK (public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_app_usage_device_insert" ON public.pc_app_usage_events;
CREATE POLICY "pc_app_usage_device_insert"
  ON public.pc_app_usage_events FOR INSERT
  WITH CHECK (public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_app_usage_device_update" ON public.pc_app_usage_events;
CREATE POLICY "pc_app_usage_device_update"
  ON public.pc_app_usage_events FOR UPDATE
  USING (public.pc_device_owns_child(device_id, child_id))
  WITH CHECK (public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_sos_device_insert" ON public.pc_sos_events;
CREATE POLICY "pc_sos_device_insert"
  ON public.pc_sos_events FOR INSERT
  WITH CHECK (public.pc_device_owns_child(device_id, child_id));

DROP POLICY IF EXISTS "pc_bonus_device_insert" ON public.pc_bonus_time_requests;
CREATE POLICY "pc_bonus_device_insert"
  ON public.pc_bonus_time_requests FOR INSERT
  WITH CHECK (
    device_id IS NOT NULL
    AND status = 'pending'
    AND approved_min IS NULL
    AND resolved_by IS NULL
    AND public.pc_device_owns_child(device_id, child_id)
  );

DO $$
BEGIN
  IF to_regclass('public.pc_web_activity') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "pc_web_activity_device_insert" ON public.pc_web_activity';
    EXECUTE 'CREATE POLICY "pc_web_activity_device_insert" ON public.pc_web_activity FOR INSERT
             WITH CHECK (public.pc_device_owns_child(device_id, child_id))';
  END IF;
  IF to_regclass('public.pc_audit_log') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "pc_audit_log_device_insert" ON public.pc_audit_log';
    EXECUTE 'CREATE POLICY "pc_audit_log_device_insert" ON public.pc_audit_log FOR INSERT
             WITH CHECK (actor_id IS NULL AND device_id IS NOT NULL
                         AND public.pc_device_owns_child(device_id, child_id))';
  END IF;
END
$$;

-- ── 4. push only once per cool-down for repeating alerts ──────────────

CREATE INDEX IF NOT EXISTS idx_pc_alerts_child_type_created
  ON public.pc_alerts (child_id, alert_type, created_at DESC);

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
  v_key      TEXT;
  v_cooldown INTERVAL;
BEGIN
  SELECT parent_id, org_id, display_name INTO v_parent, v_org, v_name
    FROM public.pc_children WHERE id = NEW.child_id;
  IF v_parent IS NULL THEN
    RETURN NEW;
  END IF;

  -- What makes two alerts "the same event" for push purposes.
  v_key := COALESCE(NEW.metadata->>'package_name', NEW.metadata->>'domain',
                    NEW.metadata->>'kind', NEW.metadata->>'geofence_id', '')
           || '|' || COALESCE(NEW.metadata->>'restored', '');
  v_cooldown := CASE NEW.alert_type::text
    WHEN 'blocked_app_attempt' THEN INTERVAL '60 minutes'
    WHEN 'app_opened'          THEN INTERVAL '60 minutes'
    WHEN 'website_blocked'     THEN INTERVAL '60 minutes'
    WHEN 'website_alert'       THEN INTERVAL '60 minutes'
    WHEN 'tamper_detected'     THEN INTERVAL '30 minutes'
    WHEN 'device_offline'      THEN INTERVAL '30 minutes'
    WHEN 'geofence_enter'      THEN INTERVAL '10 minutes'
    WHEN 'geofence_exit'       THEN INTERVAL '10 minutes'
    ELSE NULL  -- sos, bonus requests, limit reached, enrolment: always push
  END;

  IF v_cooldown IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pc_alerts a
    WHERE a.child_id = NEW.child_id
      AND a.alert_type = NEW.alert_type
      AND a.id <> NEW.id
      AND a.created_at > NOW() - v_cooldown
      AND COALESCE(a.metadata->>'package_name', a.metadata->>'domain',
                   a.metadata->>'kind', a.metadata->>'geofence_id', '')
          || '|' || COALESCE(a.metadata->>'restored', '') = v_key
  ) THEN
    RETURN NEW;  -- still visible in the parent's Alerts list; just no new push
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

-- ── 5. the device's command poll ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pc_commands_device_pending
  ON public.pc_device_commands (device_id, created_at)
  WHERE status IN ('pending', 'delivered');

NOTIFY pgrst, 'reload schema';
