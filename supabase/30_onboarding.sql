-- =====================================================================
-- 30. ONBOARDING — Founding and joining an organization
-- =====================================================================
-- Migration 24 removed the implicit "every signup joins the default VOICE"
-- behaviour and documented that joining should become an explicit act:
-- "invite, join code, or founding one". None of those were ever built, so a
-- brand-new signup landed in a dead end: no membership -> my_organizations()
-- returns nothing -> the app has no org context and no way to obtain one.
--
-- This migration supplies the two missing entry points:
--
--   create_organization()       found a new org, become its owner
--   join_organization_by_code() request to join an existing org
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JOIN CODE — the shareable token members use to find an org
-- ---------------------------------------------------------------------
-- Short, uppercase, unambiguous alphabet (no O/0, I/1) so it can be read
-- aloud or printed on a noticeboard without transcription errors.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS join_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_join_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_i        INTEGER;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..7 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Backfill any org created before this migration
UPDATE public.organizations
SET join_code = public.generate_join_code()
WHERE join_code IS NULL;

ALTER TABLE public.organizations ALTER COLUMN join_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_join_code
  ON public.organizations (join_code);

-- ---------------------------------------------------------------------
-- 2. CREATE ORGANIZATION — the founder path
-- ---------------------------------------------------------------------
-- SECURITY DEFINER because the caller has no membership yet and therefore
-- cannot satisfy any org-scoped RLS policy. Everything it writes is keyed
-- to auth.uid(), so a caller can only ever enrol themselves.

CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_timezone TEXT DEFAULT 'Asia/Kolkata',
  p_locale   TEXT DEFAULT 'en-IN'
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_name       TEXT := nullif(trim(p_name), '');
  v_base_slug  TEXT;
  v_slug       TEXT;
  v_suffix     INTEGER := 0;
  v_org_id     UUID;
  v_code       TEXT;
  v_membership UUID;
  v_owner_role UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to create an organization';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  IF length(v_name) < 3 THEN
    RAISE EXCEPTION 'Organization name must be at least 3 characters';
  END IF;

  -- Derive a unique URL-safe slug
  v_base_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'org';
  END IF;

  v_slug := v_base_slug;
  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug   := v_base_slug || '-' || v_suffix;
  END LOOP;

  v_code := public.generate_join_code();

  -- The org itself. A trigger from migration 23 seeds the module catalog.
  INSERT INTO public.organizations
    (name, slug, join_code, status, plan, timezone, locale, owner_id)
  VALUES
    (v_name, v_slug, v_code, 'active', 'free', p_timezone, p_locale, v_uid)
  RETURNING id INTO v_org_id;

  -- Settings row so the org has a branding/terminology surface immediately
  INSERT INTO public.organization_settings (org_id) VALUES (v_org_id)
  ON CONFLICT DO NOTHING;

  -- Roles (owner/admin/manager/member) and modules. Both are idempotent;
  -- seed_default_modules is also fired by trigger, this is belt-and-braces.
  PERFORM public.seed_default_roles(v_org_id);
  PERFORM public.seed_default_modules(v_org_id);

  -- Founder becomes an active member straight away
  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org_id, v_uid, 'active', NOW())
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = 'active', joined_at = COALESCE(memberships.joined_at, NOW())
  RETURNING id INTO v_membership;

  -- ...holding the wildcard 'owner' role
  SELECT r.id INTO v_owner_role
  FROM public.roles r
  WHERE r.org_id = v_org_id AND r.key = 'owner';

  IF v_owner_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
    VALUES (v_membership, v_owner_role, v_uid)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Make it the active org and clear the legacy approval gate
  UPDATE public.profiles p
  SET active_org_id = v_org_id,
      org_id        = COALESCE(p.org_id, v_org_id),
      is_approved   = TRUE,
      updated_at    = NOW()
  WHERE p.id = v_uid;

  RETURN json_build_object('org_id', v_org_id, 'slug', v_slug, 'join_code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. JOIN BY CODE — the member path
-- ---------------------------------------------------------------------
-- Creates a membership. Whether it is immediately usable depends on the
-- org's own policy: organization_settings.features.requireApproval. When
-- approval is required the membership starts 'pending' and an admin with
-- members.approve promotes it; otherwise the member is active at once.

CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_org          RECORD;
  v_requires     BOOLEAN;
  v_status       TEXT;
  v_membership   UUID;
  v_default_role UUID;
  v_existing     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join an organization';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Join code is required';
  END IF;

  SELECT o.id, o.name, o.status INTO v_org
  FROM public.organizations o
  WHERE o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM public.memberships m
  WHERE m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO v_requires
  FROM public.organization_settings s
  WHERE s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT id INTO v_default_role
  FROM public.roles
  WHERE org_id = v_org.id AND is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles
    SET active_org_id = v_org.id,
        org_id        = COALESCE(org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. PENDING MEMBERSHIPS — so the UI can explain the wait
-- ---------------------------------------------------------------------
-- my_organizations() deliberately lists active memberships only. Without
-- this the onboarding screen cannot distinguish "you have not joined
-- anything" from "you are waiting to be approved".

CREATE OR REPLACE FUNCTION public.my_pending_memberships()
RETURNS TABLE (org_id UUID, org_name TEXT, requested_at TIMESTAMPTZ)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.id, o.name, m.created_at
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'pending'
  ORDER BY m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.my_pending_memberships() TO authenticated;

-- ---------------------------------------------------------------------
-- 5. APPROVE / REJECT a pending membership
-- ---------------------------------------------------------------------
-- Gated on members.approve so any org-defined role carrying that
-- permission can act, not just a hardcoded admin role name.

CREATE OR REPLACE FUNCTION public.approve_membership(
  p_user_id UUID,
  p_approve BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID := public.current_org_id();
BEGIN
  IF NOT public.has_permission('members.approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve members';
  END IF;

  IF p_approve THEN
    UPDATE public.memberships
    SET status = 'active', joined_at = COALESCE(joined_at, NOW()), updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;

    UPDATE public.profiles
    SET is_approved = TRUE, updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE public.memberships
    SET status = 'left', updated_at = NOW()
    WHERE org_id = v_org_id AND user_id = p_user_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_membership(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Let a signed-in user with no membership read an org's public shell
-- ---------------------------------------------------------------------
-- Needed so the join screen can confirm "you are about to join <name>".
-- Exposes nothing beyond name/slug for a code the caller already holds.

CREATE OR REPLACE FUNCTION public.peek_organization(p_code TEXT)
RETURNS TABLE (org_name TEXT, member_count BIGINT)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT o.name,
         (SELECT count(*) FROM public.memberships m
          WHERE m.org_id = o.id AND m.status = 'active')
  FROM public.organizations o
  WHERE o.join_code = upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
    AND o.status = 'active'
    AND auth.uid() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.peek_organization(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ORG MEMBER DIRECTORY — driven by memberships, not profiles.org_id
-- ---------------------------------------------------------------------
-- The members screen used to filter profiles by org_id. Since joining is now
-- recorded in `memberships`, and a pending member deliberately has no
-- profiles.org_id yet, that query cannot see join requests at all. This RPC
-- makes membership the source of truth so pending members are visible and
-- therefore approvable.

CREATE OR REPLACE FUNCTION public.org_members()
RETURNS TABLE (
  id             UUID,
  display_name   TEXT,
  spiritual_name TEXT,
  legal_name     TEXT,
  email          TEXT,
  avatar_url     TEXT,
  role           TEXT,
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
         m.status,
         m.joined_at
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.org_id = public.current_org_id()
    AND m.status <> 'left'
    AND public.has_permission('members.view')
  ORDER BY (m.status = 'pending') DESC, COALESCE(m.display_name, p.display_name);
$$;

GRANT EXECUTE ON FUNCTION public.org_members() TO authenticated;

-- ---------------------------------------------------------------------
-- 8. Status notice
-- ---------------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'Migration 30 complete: organizations can now be founded and joined.';
  RAISE NOTICE 'Existing org join codes:';
END $$;

SELECT name, slug, join_code FROM public.organizations ORDER BY created_at;
