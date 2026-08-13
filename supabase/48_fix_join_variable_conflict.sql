-- =====================================================================
-- 48. FIX join_organization_by_code variable/column conflict
-- =====================================================================
-- Root cause:
--   join_organization_by_code RETURNS TABLE (org_id, org_name, status)
--   which means `org_id` and `status` are implicit PL/pgSQL variables.
--   Inside UPDATE/UPSERT statements, targets like:
--      SET org_id = ...
--      DO UPDATE SET status = ...
--   can still raise:
--      column reference "org_id" is ambiguous
--
-- Fix:
--   Recreate the function with `#variable_conflict use_column` so SQL
--   column names always win over PL/pgSQL variables when ambiguous.
--
-- Safe to re-run.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
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
  FROM   public.organizations AS o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  SELECT m.status INTO v_existing
  FROM   public.memberships AS m
  WHERE  m.org_id = v_org.id
    AND  m.user_id = v_uid;

  IF v_existing = 'active' THEN
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;

    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings AS s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (
    v_org.id,
    v_uid,
    v_status,
    CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END
  )
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  SELECT r.id INTO v_default_role
  FROM   public.roles AS r
  WHERE  r.org_id = v_org.id
    AND  r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_status = 'active' THEN
    UPDATE public.profiles AS p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
