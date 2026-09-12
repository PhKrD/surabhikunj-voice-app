-- =====================================================================
-- 72_remote_lock_desired_state.sql
--
-- Makes "Lock now" / "Unlock", "Pause internet" / "Resume internet" and
-- extra time RELIABLE regardless of whether the child's device happens to
-- be online at the moment the parent taps the button.
--
-- THE BUG THIS FIXES
-- Until now those four controls existed ONLY as transient
-- pc_device_commands rows, and the resulting state lived ONLY in the
-- device's local SharedPreferences (VoiceKidsPrefs.parent_lock_active /
-- manual_internet_pause / bonus_expires_at). That has two consequences:
--
--   1. If the device is offline (or the app was force-stopped, or its JWT
--      had expired, or PolicyEnforcer's policy fetch failed) when the
--      command was issued, nothing applied it. The parent UI stamps
--      expires_at = now + 90s (COMMAND_TIMEOUT_MS) and then reports the
--      command as "timed out", so a locked device stayed locked and
--      "Unlock" looked broken.
--   2. There was no authoritative record of what the parent WANTS, so
--      nothing could ever reconcile. A single missed command left the
--      device stuck in the wrong state permanently, with no self-healing
--      path — the parent could only keep re-sending commands and hope.
--
-- THE FIX
-- Store the parent's INTENT on pc_children, which PolicyEnforcer already
-- re-reads on every single enforcement pass (see its loadInputs(): it
-- GETs the child row with select=* each time, before its policy_version
-- cache check). The device therefore converges on the desired state the
-- moment it is next online, whether or not any command was ever
-- delivered. Commands stay as the fast path for an instantly-reachable
-- device; these columns are the source of truth.
--
-- This is the same "desired state, reconciled" model the app already uses
-- for app blocking (pc_app_rules -> VoiceKidsPrefs.desiredBlockedPackages)
-- rather than fire-and-forget commands.
--
-- Idempotent, additive only. Safe to re-run.
-- =====================================================================

-- ── Desired enforcement state (parent intent) ─────────────────────────

ALTER TABLE public.pc_children
  ADD COLUMN IF NOT EXISTS parent_lock_active    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS internet_pause_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bonus_expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS desired_state_at      TIMESTAMPTZ;

COMMENT ON COLUMN public.pc_children.parent_lock_active IS
  'Parent''s "Lock now" as DESIRED STATE, not an event. TRUE = every app should be '
  'held off-screen (dialer + VOICE excepted) until the parent unlocks. PolicyEnforcer '
  'mirrors this into VoiceKidsPrefs.parent_lock_active on every pass, so an offline '
  'device applies it when it next reconnects instead of losing the command.';

COMMENT ON COLUMN public.pc_children.internet_pause_active IS
  'Parent''s "Pause internet" as DESIRED STATE. Survives an offline device, a reboot '
  'and an app reinstall, unlike the pause_internet command that used to be the only '
  'carrier of this bit.';

COMMENT ON COLUMN public.pc_children.bonus_expires_at IS
  'When the current grant of extra time runs out (NULL = none). Desired-state twin of '
  'the grant_bonus_time/revoke_bonus_time commands, so extra time granted while the '
  'device is offline is still honoured — and still EXPIRES correctly — once it is back.';

COMMENT ON COLUMN public.pc_children.desired_state_at IS
  'When a parent last changed any of the three columns above. Lets the parent UI say '
  '"queued, will apply when the device is back online" honestly instead of showing a '
  'command as failed.';

-- ── Keep desired_state_at truthful without trusting the client ────────
-- Stamped server-side so a clock-skewed phone can't backdate its intent.

CREATE OR REPLACE FUNCTION public.pc_touch_desired_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.parent_lock_active    IS DISTINCT FROM OLD.parent_lock_active)
  OR (NEW.internet_pause_active IS DISTINCT FROM OLD.internet_pause_active)
  OR (NEW.bonus_expires_at      IS DISTINCT FROM OLD.bonus_expires_at) THEN
    NEW.desired_state_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_children_desired_state ON public.pc_children;
CREATE TRIGGER trg_pc_children_desired_state
  BEFORE UPDATE ON public.pc_children
  FOR EACH ROW EXECUTE FUNCTION public.pc_touch_desired_state();

-- ── Backfill from what devices last reported ──────────────────────────
-- A device that is currently locked/paused reported so in
-- pc_devices.enforcement_state. Seed the new columns from that so
-- migrating does not silently release a lock a parent set before this ran.

UPDATE public.pc_children c
SET parent_lock_active = TRUE
WHERE c.parent_lock_active = FALSE
  AND EXISTS (
    SELECT 1 FROM public.pc_devices d
    WHERE d.child_id = c.id
      AND d.is_active
      AND d.enforcement_state ->> 'lock_reason' = 'parent_lock'
  );

-- NB: only manual_internet_pause is the parent's own pause. The sibling
-- enforcement_state.internet_paused is ALSO true whenever a lock is in
-- force (a parent lock's action is lock_device, whose pausesInternet is
-- true — see PolicyEnforcer.LockDecision), so seeding from that would
-- invent an internet pause the parent never asked for. Compared as text
-- rather than cast to boolean so an unexpected value can't abort the
-- migration.
UPDATE public.pc_children c
SET internet_pause_active = TRUE
WHERE c.internet_pause_active = FALSE
  AND EXISTS (
    SELECT 1 FROM public.pc_devices d
    WHERE d.child_id = c.id
      AND d.is_active
      AND d.enforcement_state ->> 'manual_internet_pause' = 'true'
  );

-- RLS: no new policies needed. The parent already has full write access via
-- pc_children_parent_all (52_parental_control_schema.sql) and the device
-- already reads its own child row via pc_children_device_select
-- (61_policy_integrity.sql, re-declared in 71).
