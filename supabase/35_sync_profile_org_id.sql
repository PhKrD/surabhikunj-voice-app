-- =====================================================================
-- 35. SYNC profiles.org_id WITH ACTIVE ORGANIZATION
-- =====================================================================
-- The app still reads org context from profiles.org_id in many places, but
-- newer flows (multi-org, switch org) set only profiles.active_org_id. That
-- leaves profiles.org_id NULL, causing:
--   - .eq('org_id', null) SQL errors
--   - INSERT RLS violations because the inserted org_id is NULL
--
-- This migration:
--   1. Backfills profiles.org_id from active_org_id or the single active
--      membership, for any row where org_id is currently NULL.
--   2. Adds a trigger so future updates to active_org_id keep org_id in sync.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- -----------------------------------------------------------------
-- 1. Backfill org_id for existing users
-- -----------------------------------------------------------------
UPDATE public.profiles p
SET org_id = COALESCE(
  p.active_org_id,
  (
    SELECT m.org_id
    FROM public.memberships m
    WHERE m.user_id = p.id AND m.status = 'active'
    ORDER BY m.joined_at ASC
    LIMIT 1
  )
)
WHERE p.org_id IS NULL;

-- -----------------------------------------------------------------
-- 2. Keep org_id in sync with active_org_id going forward
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_org_id IS DISTINCT FROM OLD.active_org_id THEN
    NEW.org_id := NEW.active_org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_org_id ON public.profiles;
CREATE TRIGGER trg_sync_profile_org_id
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_org_id();
