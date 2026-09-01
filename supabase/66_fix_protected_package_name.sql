-- =====================================================================
-- 66_fix_protected_package_name.sql — Correct the lockout-protection list
--                                      for the post-merge single app.
--
-- ADDITIVE ONLY (CREATE OR REPLACE of two functions). No table changes.
--
-- BUG: 61_policy_integrity.sql hardcoded 'com.surabhikunj.voice.kids' as
-- the parental-control agent's own package in:
--   1. pc_is_protected_package()      — the "never block this" safety net
--   2. pc_ensure_emergency_allowed()  — auto-injects the agent into
--      always_allowed_packages for block_all/allow_list_only schedules
--
-- After the Parent+Child merge, the single installed app is
-- 'com.surabhikunj.voice' — the old package no longer exists on any real
-- device. Practical effect of the bug:
--   - A parent could accidentally create a rule that blocks/suspends the
--     VOICE app itself (the DB would have allowed it — the protection
--     check never matched the real package).
--   - A 'block_all' or 'allow_list_only' schedule would NOT automatically
--     keep the VOICE app itself in the lock-task allow-list, so activating
--     such a schedule could kick the child out of the very app that shows
--     their SOS button, bonus-time request UI, and screen-time status.
--
-- Also mirrored client-side in src/lib/policy.js, src/lib/protectedPackages.js
-- and natively in android/.../dpc/PolicyEnforcer.kt — keep all four in sync.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pc_is_protected_package(p_package TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_package IS NOT NULL AND (
    p_package IN (
      -- Emergency + telephony
      'com.android.server.telecom',
      'com.android.phone',
      'com.android.dialer',
      'com.google.android.dialer',
      'com.android.emergency',
      'com.android.incallui',
      -- Core system surfaces (locking these bricks the device)
      'android',
      'com.android.systemui',
      'com.android.settings',
      'com.android.providers.settings',
      -- Launchers (no launcher = unusable device)
      'com.android.launcher3',
      'com.google.android.apps.nexuslauncher',
      -- The parental-control agent itself (single merged app, post-52/61)
      'com.surabhikunj.voice'
    )
  );
$$;

COMMENT ON FUNCTION public.pc_is_protected_package(TEXT) IS
  'Packages that may never be blocked or time-limited: emergency dialer, core system UI, launcher, and the VOICE agent itself.';

CREATE OR REPLACE FUNCTION public.pc_ensure_emergency_allowed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action IN ('block_all', 'allow_list_only') THEN
    NEW.always_allowed_packages := ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(NEW.always_allowed_packages, ARRAY[]::TEXT[])
        || ARRAY['com.android.server.telecom', 'com.android.dialer', 'com.surabhikunj.voice']
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: any existing block_all/allow_list_only schedule created before
-- this fix is missing the correct agent package in its allow-list. Add it
-- without touching anything the parent already configured.
UPDATE public.pc_schedules
   SET always_allowed_packages = ARRAY(
         SELECT DISTINCT unnest(
           COALESCE(always_allowed_packages, ARRAY[]::TEXT[]) || ARRAY['com.surabhikunj.voice']
         )
       )
 WHERE action IN ('block_all', 'allow_list_only')
   AND NOT ('com.surabhikunj.voice' = ANY(COALESCE(always_allowed_packages, ARRAY[]::TEXT[])));

-- Remove any now-orphaned rule that blocked/time-limited the current agent
-- package before this fix closed the loophole (defensive cleanup — should
-- be rare/empty in practice).
DELETE FROM public.pc_app_rules
 WHERE action IN ('block', 'time_limit')
   AND package_name = 'com.surabhikunj.voice';
