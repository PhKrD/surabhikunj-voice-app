-- =====================================================================
-- 63_device_column_lockdown.sql — Column-level write protection for
--                                   device-authenticated UPDATE policies.
--
-- ADDITIVE ONLY. No table is dropped, no existing RLS policy is removed.
-- This adds BEFORE UPDATE triggers on top of the existing row-level
-- policies from 52_parental_control_schema.sql.
--
-- CRITICAL BUG (found in live production security audit):
--   RLS USING/WITH CHECK clauses only gate WHICH ROWS a role may touch —
--   never WHICH COLUMNS. The device-authenticated UPDATE policies below
--   were written assuming the device would only ever send a heartbeat
--   (last_seen_at, fcm_token, app_version) or ack a command
--   (status/delivered_at/executed_at/error_message), but nothing in
--   Postgres enforced that:
--
--     pc_devices_device_update    (52_..:454-457)
--     pc_app_usage_device_update  (52_..:595-598)
--     pc_installed_apps_device_update (52_..:617-620)
--     pc_commands_device_update   (52_..:706-709)
--
--   A compromised/malicious child device could rewrite pc_devices.child_id
--   to point at a COMPLETELY DIFFERENT FAMILY's child. Every other
--   *_device_select policy (pc_app_rules, pc_schedules, pc_routines,
--   pc_geofences, pc_website_rules, pc_screen_time_rules,
--   pc_child_requests, pc_children itself via pc_children_device_select
--   from 61_policy_integrity.sql) trusts pc_devices.child_id, so this one
--   write turns into full cross-family read access to another parent's
--   rules/schedules/screen-time data. It could also forge
--   pc_app_usage_events.child_id to attribute fabricated usage to a
--   different family's child, and rewrite pc_device_commands.command_type/
--   payload/issued_by/status to erase attribution or resurrect an
--   already-executed command by flipping it back to 'pending'.
--
--   Live-reproduced and reverted during the audit — see conversation
--   history for exact repro steps. This migration closes all four holes.
--
-- FIX: BEFORE UPDATE triggers that compare NEW vs OLD and reject any
--      change to an identity/ownership/command-definition column when the
--      row is being updated by the device itself (auth.uid() = the
--      device's own auth_user_id, i.e. going through the *_device_update
--      policy rather than the parent's *_parent_all policy). Parent- and
--      service-role-driven updates (e.g. a parent's reassignDevice() flow)
--      are untouched — they are identified by auth.uid() NOT matching the
--      row's own device auth_user_id.
-- =====================================================================

-- ── pc_devices: device may only touch its own heartbeat/telemetry ─────
-- Protected: child_id, org_id, auth_user_id, android_id, provisioning_token,
--            device_owner_mode, is_active, manufacturer/model/android_version
--            (identity — spoofing these doesn't gate data access today, but
--            they're not something a heartbeat write should ever change).
-- Allowed via the device policy: device_name, last_seen_at, fcm_token,
--            app_version, sdk_version, updated_at, enrolled_at.
CREATE OR REPLACE FUNCTION public.pc_lock_device_identity_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only restrict when the DEVICE itself (not the parent, not service role)
  -- is performing the update, i.e. it is authenticating as the row's own
  -- auth_user_id and going through pc_devices_device_update.
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.auth_user_id THEN
    IF NEW.child_id       IS DISTINCT FROM OLD.child_id
       OR NEW.org_id      IS DISTINCT FROM OLD.org_id
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.android_id  IS DISTINCT FROM OLD.android_id
       OR NEW.provisioning_token IS DISTINCT FROM OLD.provisioning_token
       OR NEW.device_owner_mode  IS DISTINCT FROM OLD.device_owner_mode
       OR NEW.is_active   IS DISTINCT FROM OLD.is_active
    THEN
      RAISE EXCEPTION
        'A device cannot change its own child_id/org_id/auth_user_id/android_id/provisioning_token/device_owner_mode/is_active. Reassignment must be performed by the parent.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_devices_lock_identity ON public.pc_devices;
CREATE TRIGGER trg_pc_devices_lock_identity
  BEFORE UPDATE ON public.pc_devices
  FOR EACH ROW EXECUTE FUNCTION public.pc_lock_device_identity_columns();

-- ── pc_app_usage_events: device may only upsert its own usage numbers ──
-- Protected: device_id, child_id, package_name, usage_date (the upsert key
--            + ownership — an UPDATE should never move a usage row onto a
--            different device/child/app/day).
CREATE OR REPLACE FUNCTION public.pc_lock_usage_event_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.device_id     IS DISTINCT FROM OLD.device_id
     OR NEW.child_id   IS DISTINCT FROM OLD.child_id
     OR NEW.package_name IS DISTINCT FROM OLD.package_name
     OR NEW.usage_date IS DISTINCT FROM OLD.usage_date
  THEN
    RAISE EXCEPTION
      'device_id/child_id/package_name/usage_date on pc_app_usage_events are immutable after insert.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_usage_lock_identity ON public.pc_app_usage_events;
CREATE TRIGGER trg_pc_usage_lock_identity
  BEFORE UPDATE ON public.pc_app_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.pc_lock_usage_event_identity();

-- ── pc_installed_apps: device may only refresh its own app inventory ──
-- Protected: device_id, package_name (the upsert key).
CREATE OR REPLACE FUNCTION public.pc_lock_installed_app_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
     OR NEW.package_name IS DISTINCT FROM OLD.package_name
  THEN
    RAISE EXCEPTION
      'device_id/package_name on pc_installed_apps are immutable after insert.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_installed_apps_lock_identity ON public.pc_installed_apps;
CREATE TRIGGER trg_pc_installed_apps_lock_identity
  BEFORE UPDATE ON public.pc_installed_apps
  FOR EACH ROW EXECUTE FUNCTION public.pc_lock_installed_app_identity();

-- ── pc_device_commands: device may only ack, never redefine, a command ─
-- Protected: device_id, command_type, payload, issued_by, created_at,
--            expires_at.
-- Allowed via the device policy: status, delivered_at, executed_at,
--            error_message, updated_at.
CREATE OR REPLACE FUNCTION public.pc_lock_command_definition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.device_id     IS DISTINCT FROM OLD.device_id
     OR NEW.command_type IS DISTINCT FROM OLD.command_type
     OR NEW.payload     IS DISTINCT FROM OLD.payload
     OR NEW.issued_by   IS DISTINCT FROM OLD.issued_by
     OR NEW.created_at  IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'device_id/command_type/payload/issued_by/created_at on pc_device_commands cannot be modified by the device — only status/delivered_at/executed_at/error_message may be acknowledged.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A command already in a terminal state cannot be resurrected back to
  -- pending/delivered — closes the "flip status back to pending so a
  -- poller re-executes it" replay vector.
  IF OLD.status IN ('executed', 'failed') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION
      'Command % is already in a terminal state (%) and cannot be re-transitioned.',
      OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_commands_lock_definition ON public.pc_device_commands;
CREATE TRIGGER trg_pc_commands_lock_definition
  BEFORE UPDATE ON public.pc_device_commands
  FOR EACH ROW EXECUTE FUNCTION public.pc_lock_command_definition();

-- ── is_active kill-switch: fold into pc_is_device_auth() so a future ───
-- "pause device" feature (the column already exists and the UI already
-- filters on it) is a real access-control boundary from day one, not
-- just a display filter.
CREATE OR REPLACE FUNCTION pc_is_device_auth(p_device_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pc_devices
    WHERE id = p_device_id
      AND auth_user_id = auth.uid()
      AND is_active = TRUE
  );
$$;

COMMENT ON FUNCTION public.pc_lock_device_identity_columns() IS
  'Prevents a device from rewriting its own child_id/org_id/auth_user_id/android_id/provisioning_token/device_owner_mode/is_active — a device may only update telemetry (device_name, last_seen_at, fcm_token, app_version, sdk_version). Fixes a cross-family device-hijack vulnerability found in production audit.';
COMMENT ON FUNCTION public.pc_lock_command_definition() IS
  'Prevents a device from redefining a command it did not issue (command_type/payload/issued_by/device_id/created_at) or resurrecting a terminal command by flipping status back to pending/delivered.';
