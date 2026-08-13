-- =====================================================================
-- 32. FIX MEMBER MANAGEMENT
-- =====================================================================
-- MembersPage.jsx lets an admin pick a role for a member from the org's
-- `roles` table, then saved that choice by writing profiles.role (the
-- legacy free-text column). Since migration 22, actual access control is
-- resolved from membership_roles / role_permissions, not profiles.role, so
-- every "role change" made through that screen was a silent no-op: the
-- dropdown looked like it worked, nothing about the member's real
-- permissions ever changed.
--
-- This migration:
--   1. Extends org_members() to also report each member's current RBAC
--      role (role_id/role_name), so the UI can show what is actually true.
--   2. Adds set_member_role(), which writes membership_roles instead of
--      the dead profiles.role column.
--   3. Aligns the "members" module's required_permission with the
--      members.manage the /members route already demands, so a member who
--      cannot use the page never sees it in navigation and gets silently
--      bounced back to "/" after clicking it.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. org_members() — report each member's actual RBAC role too
-- ---------------------------------------------------------------------
-- DROP required because we're adding columns to the return type; Postgres
-- does not allow CREATE OR REPLACE to change a function's return signature.

DROP FUNCTION IF EXISTS public.org_members();

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
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. set_member_role() — the write path org_members() was missing
-- ---------------------------------------------------------------------
-- Replaces whatever role(s) the membership currently holds with a single
-- chosen one. Demoting the organization's last '*' holder is blocked by
-- trg_prevent_last_owner_removal (fires on the DELETE below).

CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_role_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_membership UUID;
BEGIN
  IF NOT public.has_permission('roles.assign') THEN
    RAISE EXCEPTION 'You do not have permission to assign roles';
  END IF;

  SELECT id INTO v_membership
  FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = p_role_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'That role does not belong to this organization';
  END IF;

  DELETE FROM public.membership_roles WHERE membership_id = v_membership;
  INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
  VALUES (v_membership, p_role_id, auth.uid());
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Nav visibility should match what the route actually allows
-- ---------------------------------------------------------------------
-- /members (App.jsx) requires members.manage. The catalog only required
-- members.view, so a plain member saw "Members" in their sidebar, clicked
-- it, and was bounced straight back to "/" with no explanation.

UPDATE public.modules
SET required_permission = 'members.manage'
WHERE key = 'members';
