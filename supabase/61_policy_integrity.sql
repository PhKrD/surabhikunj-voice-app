-- =====================================================================
-- 61_policy_integrity.sql — Policy versioning, identity self-heal,
--                           duplicate prevention, lockout protection.
--
-- ADDITIVE ONLY. No existing table is dropped, no column is removed, no
-- existing policy is replaced. Migrations 52-60 remain valid.
--
-- Fixes six defects found in the production audit:
--
--   C1  The child device caches child_id from pairing and never re-reads
--       it. Once a parent calls reassignDevice() the device queries rules
--       for the wrong child forever. The device could not self-heal
--       because it has no SELECT policy on pc_children.
--       → pc_children_device_select
--
--   C3  Nothing records WHICH policy the device actually applied, so the
--       parent dashboard shows rules from the DB and claims they are in
--       force even when the device never received them.
--       → pc_children.policy_version (auto-bumped by trigger)
--       → pc_devices.applied_policy_version / enforcement_state /
--         last_enforcement_at
--
--   C4  A rule on the dialer/telecom/settings package can lock a child
--       out of emergency calling, or lock the parent out of the device.
--       → pc_is_protected_package() + reject triggers
--
--   H1  pc_audit_log has a SELECT policy but no INSERT policy, so every
--       recordAudit() call from the parent app has been silently denied
--       by RLS since the table was created. The audit trail is empty by
--       construction.
--       → pc_audit_log_parent_insert
--
--   H2  UNIQUE (child_id, device_id, package_name) does not deduplicate
--       child-wide rules, because NULL device_id values are never equal
--       to each other in Postgres. This is how three identical Chrome
--       block rules ended up on one child.
--       → partial unique indexes covering the device_id IS NULL case
--
--   M1  Devices had no platform column, so deviceCapabilities.js had to
--       guess from android_* metadata.
--       → pc_devices.platform
-- =====================================================================


-- ══════════════════════════════════════════════════════════════════════
-- 1. POLICY VERSIONING
-- ══════════════════════════════════════════════════════════════════════
-- A single monotonically increasing counter per child. Every write to any
-- table that changes enforceable policy bumps it. The device reports back
-- the version it has actually applied, which lets the parent UI show a
-- truthful "in sync / syncing / stale" state instead of assuming.

ALTER TABLE public.pc_children
  ADD COLUMN IF NOT EXISTS policy_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE public.pc_devices
  ADD COLUMN IF NOT EXISTS applied_policy_version BIGINT,
  ADD COLUMN IF NOT EXISTS last_enforcement_at    TIMESTAMPTZ,
  -- Free-form diagnostic snapshot written by the child on each successful
  -- enforcement pass: device-owner status, usage-access grant, suspended
  -- package count, last error. Read-only for the parent UI.
  ADD COLUMN IF NOT EXISTS enforcement_state      JSONB,
  ADD COLUMN IF NOT EXISTS platform               TEXT;

COMMENT ON COLUMN public.pc_children.policy_version IS
  'Monotonic policy counter. Bumped by trigger on any rule/schedule/screen-time/website change.';
COMMENT ON COLUMN public.pc_devices.applied_policy_version IS
  'Last pc_children.policy_version this device successfully enforced. NULL = never enforced.';
COMMENT ON COLUMN public.pc_devices.enforcement_state IS
  'Device self-diagnostic snapshot: {device_owner, usage_access, suspended_count, last_error, ...}.';

-- Backfill: existing devices have applied an unknown version. Leaving it
-- NULL is correct and the UI renders that as "never confirmed".

-- ── Trigger function: bump the owning child's policy_version ──────────
-- SECURITY DEFINER because a device-scoped JWT may legitimately cause a
-- policy row to change (e.g. a future device-side rule ACK) but has no
-- UPDATE grant on pc_children.
CREATE OR REPLACE FUNCTION public.pc_bump_policy_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_child UUID;
BEGIN
  target_child := COALESCE(NEW.child_id, OLD.child_id);
  IF target_child IS NOT NULL THEN
    UPDATE public.pc_children
       SET policy_version = policy_version + 1,
           updated_at     = NOW()
     WHERE id = target_child;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to every table whose contents the device enforces.
DROP TRIGGER IF EXISTS trg_pc_app_rules_bump_policy ON public.pc_app_rules;
CREATE TRIGGER trg_pc_app_rules_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_app_rules
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();

DROP TRIGGER IF EXISTS trg_pc_schedules_bump_policy ON public.pc_schedules;
CREATE TRIGGER trg_pc_schedules_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_schedules
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();

DROP TRIGGER IF EXISTS trg_pc_screen_time_bump_policy ON public.pc_screen_time_rules;
CREATE TRIGGER trg_pc_screen_time_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_screen_time_rules
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();

DROP TRIGGER IF EXISTS trg_pc_website_rules_bump_policy ON public.pc_website_rules;
CREATE TRIGGER trg_pc_website_rules_bump_policy
  AFTER INSERT OR UPDATE OR DELETE ON public.pc_website_rules
  FOR EACH ROW EXECUTE FUNCTION public.pc_bump_policy_version();


-- ══════════════════════════════════════════════════════════════════════
-- 2. DUPLICATE RULE PREVENTION  (fixes H2)
-- ══════════════════════════════════════════════════════════════════════
-- The table-level UNIQUE (child_id, device_id, package_name) silently does
-- nothing for child-wide rules because NULL <> NULL in Postgres. Partial
-- unique indexes close the hole for exactly the NULL case, leaving the
-- existing constraint intact for device-scoped rules.
--
-- De-duplicate first, keeping the OLDEST row of each group (it is the one
-- the parent originally intended; later rows were accidental repeats).

DELETE FROM public.pc_app_rules a
 USING public.pc_app_rules b
 WHERE a.device_id IS NULL
   AND b.device_id IS NULL
   AND a.child_id     = b.child_id
   AND a.package_name = b.package_name
   AND a.created_at   > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_app_rules_child_pkg_global
  ON public.pc_app_rules (child_id, package_name)
  WHERE device_id IS NULL;

DELETE FROM public.pc_website_rules a
 USING public.pc_website_rules b
 WHERE a.device_id IS NULL
   AND b.device_id IS NULL
   AND a.child_id   = b.child_id
   AND a.domain     = b.domain
   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_website_rules_child_domain_global
  ON public.pc_website_rules (child_id, domain)
  WHERE device_id IS NULL;


-- ══════════════════════════════════════════════════════════════════════
-- 3. LOCKOUT PROTECTION  (fixes C4)
-- ══════════════════════════════════════════════════════════════════════
-- Emergency calling, the system settings app, the launcher and the VOICE
-- Kids agent itself must never be blockable. Suspending the dialer would
-- prevent a child from calling emergency services; suspending the agent
-- would make the device permanently unmanageable.
--
-- Enforced in the database (not just the UI) so a crafted API request
-- cannot bypass it. 'allow' rules are always permitted — only 'block' and
-- 'time_limit' are refused.

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
      -- The parental-control agent itself
      'com.surabhikunj.voice.kids'
    )
  );
$$;

COMMENT ON FUNCTION public.pc_is_protected_package(TEXT) IS
  'Packages that may never be blocked or time-limited: emergency dialer, core system UI, launcher, and the VOICE Kids agent.';

CREATE OR REPLACE FUNCTION public.pc_reject_protected_app_rule()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action IN ('block', 'time_limit')
     AND public.pc_is_protected_package(NEW.package_name) THEN
    RAISE EXCEPTION
      'Package "%" is protected and cannot be blocked or time-limited. Blocking it would prevent emergency calls or make the device unmanageable.',
      NEW.package_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_app_rules_protect ON public.pc_app_rules;
CREATE TRIGGER trg_pc_app_rules_protect
  BEFORE INSERT OR UPDATE ON public.pc_app_rules
  FOR EACH ROW EXECUTE FUNCTION public.pc_reject_protected_app_rule();

-- Clean up any protected-package rule that predates this trigger. These
-- are actively dangerous (the audit found a 1-minute limit on the dialer).
DELETE FROM public.pc_app_rules
 WHERE action IN ('block', 'time_limit')
   AND public.pc_is_protected_package(package_name);

-- Schedules use always_allowed_packages as an escape hatch. Make sure a
-- block_all schedule can never leave the child with no way to call for
-- help: append the emergency dialer if the parent omitted it.
CREATE OR REPLACE FUNCTION public.pc_ensure_emergency_allowed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.action IN ('block_all', 'allow_list_only') THEN
    NEW.always_allowed_packages := ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(NEW.always_allowed_packages, ARRAY[]::TEXT[])
        || ARRAY['com.android.server.telecom', 'com.android.dialer', 'com.surabhikunj.voice.kids']
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pc_schedules_emergency ON public.pc_schedules;
CREATE TRIGGER trg_pc_schedules_emergency
  BEFORE INSERT OR UPDATE ON public.pc_schedules
  FOR EACH ROW EXECUTE FUNCTION public.pc_ensure_emergency_allowed();


-- ══════════════════════════════════════════════════════════════════════
-- 4. RLS FIXES
-- ══════════════════════════════════════════════════════════════════════

-- ── 4a. Device may read its own child row (fixes C1) ─────────────────
-- Without this the device cannot discover that it was reassigned, and
-- cannot read policy_version to know whether it is up to date. Scoped to
-- children that own a device authenticated as the current JWT — a device
-- can never see another family's child.
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

-- ── 4b. Parent may write audit entries (fixes H1) ────────────────────
-- The audit log was read-only for everyone, so recordAudit() has always
-- failed silently. Parents may only insert rows attributed to themselves,
-- for their own children — they cannot forge another actor.
DROP POLICY IF EXISTS "pc_audit_log_parent_insert" ON public.pc_audit_log;
CREATE POLICY "pc_audit_log_parent_insert"
  ON public.pc_audit_log FOR INSERT
  WITH CHECK (
    actor_id = auth.uid()
    AND (child_id IS NULL OR public.pc_is_parent_of(child_id))
  );

-- Devices may record their own enforcement outcomes for support triage.
DROP POLICY IF EXISTS "pc_audit_log_device_insert" ON public.pc_audit_log;
CREATE POLICY "pc_audit_log_device_insert"
  ON public.pc_audit_log FOR INSERT
  WITH CHECK (
    actor_id IS NULL
    AND device_id IS NOT NULL
    AND public.pc_is_device_auth(device_id)
  );

-- The audit log must be append-only. No UPDATE or DELETE policy exists for
-- any client role, so tampering is impossible through PostgREST.


-- ══════════════════════════════════════════════════════════════════════
-- 5. SUPPORTING INDEXES
-- ══════════════════════════════════════════════════════════════════════

-- Parent dashboard: "which of my devices are out of sync?"
CREATE INDEX IF NOT EXISTS idx_pc_devices_policy_sync
  ON public.pc_devices (child_id, applied_policy_version);

-- Device heartbeat freshness scans.
CREATE INDEX IF NOT EXISTS idx_pc_devices_last_seen
  ON public.pc_devices (last_seen_at DESC);


-- ══════════════════════════════════════════════════════════════════════
-- 6. REALTIME
-- ══════════════════════════════════════════════════════════════════════
-- The parent dashboard needs to see applied_policy_version / heartbeat
-- changes live so the sync indicator is truthful without polling.
-- Wrapped because ALTER PUBLICATION errors if the table is already a
-- member, which would abort the whole migration on re-run.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pc_devices;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pc_app_rules;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END
$$;
