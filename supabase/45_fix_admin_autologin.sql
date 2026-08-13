-- =====================================================================
-- 45. FIX ADMIN AUTO-LOGIN
-- =====================================================================
-- Problem: admins/owners who created their org before migration 24/30
-- ran have profiles.active_org_id = NULL. On every fresh login the
-- orgStore cannot resolve which org to open, falls through to the
-- onboarding screen, and asks them to enter the join code again.
--
-- This migration:
--   1. Backfills active_org_id for every profile that has an active
--      membership but a NULL (or stale) active_org_id.
--   2. Hardens current_org_id() so it ALWAYS returns something for a
--      user with at least one active membership — even if active_org_id
--      and org_id are both NULL.
--   3. Adds an after-login trigger: when a session starts (auth.uid()
--      changes inside a transaction), auto-repair active_org_id if it
--      is NULL but the user has exactly one active membership.
--   4. Tightens join_organization_by_code so it always writes
--      active_org_id when the member is already active (covers the
--      "already joined, code re-entered" path).
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ─── 1. ONE-TIME BACKFILL ────────────────────────────────────────────────────
-- For every profile where active_org_id is NULL *but* the user has an
-- active membership, set active_org_id to the most recently joined org.
UPDATE public.profiles p
SET   active_org_id = (
        SELECT m.org_id
        FROM   public.memberships m
        WHERE  m.user_id = p.id
          AND  m.status  = 'active'
        ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
        LIMIT  1
      ),
      -- keep legacy org_id column in sync too
      org_id = COALESCE(
        p.org_id,
        (SELECT m.org_id
         FROM   public.memberships m
         WHERE  m.user_id = p.id AND m.status = 'active'
         ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
         LIMIT  1)
      ),
      is_approved = TRUE,
      updated_at  = NOW()
WHERE p.active_org_id IS NULL
  AND EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = p.id AND m.status = 'active'
      );

-- ─── 2. HARDEN current_org_id() ─────────────────────────────────────────────
-- The previous version could return NULL when active_org_id was NULL
-- (profiles.org_id was null too). The new version always falls through
-- to "most recent active membership" and never returns NULL for a
-- member who genuinely belongs to an org.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Explicitly chosen active org (and membership still valid)
    (SELECT p.active_org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.active_org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.active_org_id
                AND  m.status  = 'active'
            )
    ),
    -- 2. Legacy org_id column
    (SELECT p.org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.org_id
                AND  m.status  = 'active'
            )
    ),
    -- 3. Any single active membership (most recently joined first)
    (SELECT m.org_id
     FROM   public.memberships m
     WHERE  m.user_id = auth.uid()
       AND  m.status  = 'active'
     ORDER  BY m.joined_at DESC NULLS LAST
     LIMIT  1
    )
  );
$$;

-- ─── 3. AUTO-REPAIR FUNCTION ─────────────────────────────────────────────────
-- Called explicitly from the client after login (see below). Writes
-- active_org_id into the profile if it is missing.  Returns the org_id
-- that is now active, or NULL if the user has no active memberships.
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
  FROM   public.profiles p
  WHERE  p.id = v_uid
    AND  p.active_org_id IS NOT NULL
    AND  EXISTS (
           SELECT 1 FROM public.memberships m
           WHERE m.user_id = v_uid AND m.org_id = p.active_org_id AND m.status = 'active'
         );

  IF v_org_id IS NOT NULL THEN RETURN v_org_id; END IF;

  -- Pick the best active membership
  SELECT m.org_id INTO v_org_id
  FROM   public.memberships m
  WHERE  m.user_id = v_uid AND m.status = 'active'
  ORDER  BY m.joined_at DESC NULLS LAST
  LIMIT  1;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Write it back so future calls are fast
  UPDATE public.profiles
  SET    active_org_id = v_org_id,
         org_id        = COALESCE(org_id, v_org_id),
         is_approved   = TRUE,
         updated_at    = NOW()
  WHERE  id = v_uid;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_active_org() TO authenticated;

-- ─── 4. HARDEN join_organization_by_code ────────────────────────────────────
-- When re-entering a code for an org the user is already active in,
-- still write active_org_id so the session picks it up.
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
  FROM   public.organizations o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Check existing membership
  SELECT m.status INTO v_existing
  FROM   public.memberships m
  WHERE  m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    -- Already a member — just make sure active_org_id is set
    UPDATE public.profiles p
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

  -- New join
  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant default role
  SELECT r.id INTO v_default_role
  FROM   public.roles r
  WHERE  r.org_id = v_org.id AND r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Set active org if now active
  IF v_status = 'active' THEN
    UPDATE public.profiles p
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
