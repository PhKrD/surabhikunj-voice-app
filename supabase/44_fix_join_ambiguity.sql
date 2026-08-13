-- =====================================================================
-- 44. FIX AMBIGUOUS org_id IN ORG JOIN FLOW
-- =====================================================================
-- The join-code flow occasionally raised "column reference 'org_id' is
-- ambiguous". That happens when a planner/join in a query (or a trigger it
-- fires) has two `org_id` columns in scope and an `org_id` is written without
-- a table alias. This migration defensively aliases every `org_id` reference
-- in join_organization_by_code and the membership trigger it fires.
--
-- Idempotent: safe to re-run.
-- =====================================================================

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
  SELECT r.id INTO v_default_role
  FROM public.roles r
  WHERE r.org_id = v_org.id AND r.is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles p
    SET active_org_id = v_org.id,
        org_id        = COALESCE(p.org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- Also harden the trigger that fires on INSERT INTO memberships
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT r.id INTO v_role_id
  FROM public.roles r
  WHERE r.org_id = NEW.org_id AND r.is_default
  LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
