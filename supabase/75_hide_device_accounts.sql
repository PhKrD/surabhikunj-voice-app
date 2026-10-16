-- =====================================================================
-- 75. KEEP PARENTAL-CONTROL DEVICE ACCOUNTS OUT OF THE MEMBER LIST
-- =====================================================================
-- pc-generate-pairing-code creates one hidden auth user per unlinked child
-- device (device-<uuid>@voice.kids.internal, user_metadata.role =
-- 'pc_device'). It is a machine identity, not a person. One such account
-- picked up an org membership (it signed into the normal org app before
-- Device Mode existed and joined via the org flow), so it showed up as
-- "device-0f6003cb-…" in Members, Counsellor pickers, Broadcast, etc.
--
-- This migration:
--   1. public.is_device_account(uuid) — one place that decides it.
--   2. Rejects new memberships for device accounts (trigger).
--   3. org_members() skips device accounts (same signature as 32).
--   4. Marks existing device memberships 'left' (rows are kept, so this is
--      reversible: UPDATE ... SET status = 'active').
--
-- Device accounts need no membership: every pc_* RLS policy authorises
-- them through pc_devices.auth_user_id, not through memberships (11 of the
-- 12 live device accounts never had one).
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_device_account(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND lower(p.email) LIKE '%@voice.kids.internal'
  ) OR EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = p_user_id
      AND u.raw_user_meta_data->>'role' = 'pc_device'
  );
$$;

REVOKE ALL ON FUNCTION public.is_device_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_device_account(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. No new memberships for device accounts
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_device_membership()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'left' AND public.is_device_account(NEW.user_id) THEN
    RAISE EXCEPTION 'Parental-control device accounts cannot join an organisation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_device_membership ON public.memberships;
CREATE TRIGGER trg_reject_device_membership
  BEFORE INSERT OR UPDATE OF status, user_id ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.reject_device_membership();

-- ---------------------------------------------------------------------
-- 3. org_members() — identical to 32_fix_member_management.sql plus the
--    device-account filter. Same return type, so CREATE OR REPLACE works.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
  role_id        UUID,
  role_name      TEXT,
  status         TEXT,
  joined_at      TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id,
         COALESCE(m.display_name, p.display_name),
         p.spiritual_name,
         p.legal_name,
         p.email,
         p.avatar_url,
         p.role,
         top_role.role_id,
         top_role.role_name,
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  LEFT JOIN LATERAL (
    SELECT r.id AS role_id, r.name AS role_name
    FROM public.membership_roles mr
    JOIN public.roles r ON r.id = mr.role_id
    WHERE mr.membership_id = m.id
    ORDER BY r.priority DESC
    LIMIT 1
  ) top_role ON TRUE
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND lower(coalesce(p.email, '')) NOT LIKE '%@voice.kids.internal'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 4. Retire existing device memberships (kept, not deleted)
-- ---------------------------------------------------------------------
UPDATE public.memberships m
SET status = 'left', updated_at = NOW()
WHERE m.status <> 'left'
  AND public.is_device_account(m.user_id);
