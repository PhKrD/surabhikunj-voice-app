-- =====================================================================
-- 47. FINAL FIX: ambiguous org_id in join / membership flow
-- =====================================================================
-- Run this in the Supabase SQL Editor if users get:
--   "column reference 'org_id' is ambiguous"
-- while joining an organization.
--
-- It re-creates every function in the join path with fully-qualified
-- table aliases so no `org_id` reference is ever ambiguous.
-- Idempotent: safe to re-run.
-- =====================================================================

-- -----------------------------------------------------------------
-- 1. TRIGGER: assign_default_role (fires on INSERT INTO memberships)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT r.id INTO v_role_id
  FROM public.roles AS r
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

-- Make sure the trigger exists and is bound idempotently
DROP TRIGGER IF EXISTS trg_assign_default_role ON public.memberships;
CREATE TRIGGER trg_assign_default_role
  AFTER INSERT ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_default_role();

-- -----------------------------------------------------------------
-- 2. FUNCTION: current_org_id (used by RLS / UI)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Explicitly chosen active org (and membership still valid)
    (SELECT p.active_org_id
     FROM   public.profiles AS p
     WHERE  p.id = auth.uid()
       AND  p.active_org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships AS m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.active_org_id
                AND  m.status  = 'active'
            )
    ),
    -- 2. Legacy org_id column
    (SELECT p.org_id
     FROM   public.profiles AS p
     WHERE  p.id = auth.uid()
       AND  p.org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships AS m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.org_id
                AND  m.status  = 'active'
            )
    ),
    -- 3. Any single active membership (most recently joined first)
    (SELECT m.org_id
     FROM   public.memberships AS m
     WHERE  m.user_id = auth.uid()
       AND  m.status  = 'active'
     ORDER  BY m.joined_at DESC NULLS LAST
     LIMIT  1
    )
  );
$$;

-- -----------------------------------------------------------------
-- 3. FUNCTION: ensure_active_org (client auto-repair)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_active_org()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_org_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- Already set and valid? Done.
  SELECT p.active_org_id INTO v_org_id
  FROM   public.profiles AS p
  WHERE  p.id = v_uid
    AND  p.active_org_id IS NOT NULL
    AND  EXISTS (
           SELECT 1 FROM public.memberships AS m
           WHERE m.user_id = v_uid
             AND m.org_id = p.active_org_id
             AND m.status = 'active'
         );

  IF v_org_id IS NOT NULL THEN RETURN v_org_id; END IF;

  -- Pick the best active membership
  SELECT m.org_id INTO v_org_id
  FROM   public.memberships AS m
  WHERE  m.user_id = v_uid
    AND  m.status  = 'active'
  ORDER  BY m.joined_at DESC NULLS LAST
  LIMIT  1;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Write it back so future calls are fast
  UPDATE public.profiles AS p
  SET    active_org_id = v_org_id,
         org_id        = COALESCE(p.org_id, v_org_id),
         is_approved   = TRUE,
         updated_at    = NOW()
  WHERE  p.id = v_uid;

  RETURN v_org_id;
END;
$$;

-- -----------------------------------------------------------------
-- 4. FUNCTION: join_organization_by_code (the failing one)
-- -----------------------------------------------------------------
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
  FROM   public.organizations AS o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM   public.memberships AS m
  WHERE  m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    -- Already a member — make sure active_org_id is set
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
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT r.id INTO v_default_role
  FROM   public.roles AS r
  WHERE  r.org_id = v_org.id AND r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
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

-- -----------------------------------------------------------------
-- 5. Also backfill any profiles that still have a NULL active_org_id
-- -----------------------------------------------------------------
UPDATE public.profiles AS p
SET   active_org_id = (
        SELECT m.org_id
        FROM   public.memberships AS m
        WHERE  m.user_id = p.id
          AND  m.status  = 'active'
        ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
        LIMIT  1
      ),
      org_id = COALESCE(
        p.org_id,
        (SELECT m.org_id
         FROM   public.memberships AS m
         WHERE  m.user_id = p.id
           AND  m.status  = 'active'
         ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
         LIMIT  1)
      ),
      is_approved = TRUE,
      updated_at  = NOW()
WHERE p.active_org_id IS NULL
  AND EXISTS (
        SELECT 1 FROM public.memberships AS m
        WHERE m.user_id = p.id
          AND m.status  = 'active'
      );

NOTIFY pgrst, 'reload schema';
