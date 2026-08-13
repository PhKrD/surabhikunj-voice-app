-- =====================================================================
-- 21. MEMBERSHIPS — Users belong to MANY organizations
-- =====================================================================
-- Splits the overloaded `profiles` table into two concepts:
--
--   profiles     = global identity  (one row per human, org-agnostic)
--   memberships  = identity IN an org (one row per human per org)
--
-- Org-specific data (display name, approval state, custom fields like
-- "initiated" or "room number") moves onto the membership, so the same
-- person can be "Palanhar Krsna Das" in one org and "P. Taur" in another.
--
-- EXPAND phase: profiles keeps its old columns; they are dropped in the
-- contract migration once the frontend reads from memberships.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Global identity columns on profiles
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill the org-neutral name from the Surabhikunj-specific column
UPDATE public.profiles
SET display_name = COALESCE(NULLIF(trim(spiritual_name), ''), 'Member')
WHERE display_name IS NULL;

ALTER TABLE public.profiles ALTER COLUMN display_name SET NOT NULL;

-- spiritual_name must stop being mandatory — it is now an org custom field
ALTER TABLE public.profiles ALTER COLUMN spiritual_name DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 2. MEMBERSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memberships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,

  -- Name shown inside THIS org (may differ per org)
  display_name TEXT,

  status       TEXT NOT NULL DEFAULT 'pending',

  -- Values for this org's custom member fields (see member_field_definitions)
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,

  invited_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, user_id)
);

ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_status_check;
ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'left'));

CREATE INDEX IF NOT EXISTS idx_memberships_org    ON public.memberships (org_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_user   ON public.memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_attrs  ON public.memberships USING GIN (attributes);

-- ---------------------------------------------------------------------
-- 3. CUSTOM MEMBER FIELDS — orgs define their own member profile schema
-- ---------------------------------------------------------------------
-- Replaces hardcoded columns like `initiated`, `room_number`, `legal_name`.
-- An NGO can instead define "employee_id" or "blood_group" with no migration.

CREATE TABLE IF NOT EXISTS public.member_field_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text',
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- for select/multiselect
  help_text   TEXT,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,      -- visible only to admins
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, key)
);

ALTER TABLE public.member_field_definitions
  DROP CONSTRAINT IF EXISTS member_field_definitions_type_check;
ALTER TABLE public.member_field_definitions
  ADD CONSTRAINT member_field_definitions_type_check
  CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'boolean',
                        'select', 'multiselect', 'email', 'phone', 'url'));

-- ---------------------------------------------------------------------
-- 4. BACKFILL — every existing profile becomes a membership
-- ---------------------------------------------------------------------

INSERT INTO public.memberships (org_id, user_id, display_name, status, attributes, joined_at)
SELECT
  p.org_id,
  p.id,
  COALESCE(NULLIF(trim(p.spiritual_name), ''), p.display_name),
  CASE WHEN p.is_approved THEN 'active' ELSE 'pending' END,
  -- Preserve the temple-specific fields as org custom attributes
  jsonb_strip_nulls(jsonb_build_object(
    'spiritual_name', p.spiritual_name,
    'legal_name',     p.legal_name,
    'initiated',      p.initiated,
    'room_number',    p.room_number,
    'joined_date',    p.joined_date
  )),
  COALESCE(p.joined_date::timestamptz, p.created_at)
FROM public.profiles p
WHERE p.org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Register those attributes as real, editable field definitions for any org
-- that actually has data in them, so they render in the member form.
INSERT INTO public.member_field_definitions (org_id, key, label, field_type, sort_order)
SELECT DISTINCT o.id, d.key, d.label, d.field_type, d.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('spiritual_name', 'Spiritual Name', 'text',    10),
  ('legal_name',     'Legal Name',     'text',    20),
  ('initiated',      'Initiated',      'boolean', 30),
  ('room_number',    'Room Number',    'text',    40),
  ('joined_date',    'Joined Date',    'date',    50)
) AS d(key, label, field_type, sort_order)
WHERE EXISTS (
  SELECT 1 FROM public.memberships m
  WHERE m.org_id = o.id AND m.attributes ? d.key
)
ON CONFLICT (org_id, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. HELPERS
-- ---------------------------------------------------------------------

-- The caller's membership in their currently active org.
CREATE OR REPLACE FUNCTION public.current_membership_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT m.id
  FROM public.memberships m
  WHERE m.user_id = auth.uid()
    AND m.org_id  = public.current_org_id()
  LIMIT 1;
$$;

-- Is the caller an active member of the given org?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE user_id = auth.uid() AND org_id = p_org_id AND status = 'active'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_membership_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID)     TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Keep memberships in sync while `profiles` is still the write path
-- ---------------------------------------------------------------------
-- During the expand phase the app still writes profiles.org_id /
-- is_approved. Mirror those onto memberships so both stay consistent.

CREATE OR REPLACE FUNCTION public.sync_membership_from_profile()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.memberships (org_id, user_id, display_name, status, joined_at)
  VALUES (
    NEW.org_id,
    NEW.id,
    COALESCE(NULLIF(trim(NEW.spiritual_name), ''), NEW.display_name),
    CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
    NOW()
  )
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET status     = CASE WHEN NEW.is_approved THEN 'active' ELSE 'pending' END,
        updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_membership ON public.profiles;
CREATE TRIGGER trg_sync_membership
  AFTER INSERT OR UPDATE OF org_id, is_approved ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_from_profile();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.memberships              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_field_definitions ENABLE ROW LEVEL SECURITY;

-- See fellow members of orgs you belong to; always see your own rows.
DROP POLICY IF EXISTS "memberships_select" ON public.memberships;
CREATE POLICY "memberships_select" ON public.memberships
  FOR SELECT USING (
    user_id = auth.uid() OR org_id = public.current_org_id()
  );

-- A user may create their own PENDING membership (self sign-up / join).
DROP POLICY IF EXISTS "memberships_insert_self" ON public.memberships;
CREATE POLICY "memberships_insert_self" ON public.memberships
  FOR INSERT WITH CHECK (user_id = auth.uid() AND status = 'pending');

-- Tightened to the members.manage permission in migration 24.
DROP POLICY IF EXISTS "memberships_admin_write" ON public.memberships;
CREATE POLICY "memberships_admin_write" ON public.memberships
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS "member_fields_select" ON public.member_field_definitions;
CREATE POLICY "member_fields_select" ON public.member_field_definitions
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "member_fields_write" ON public.member_field_definitions;
CREATE POLICY "member_fields_write" ON public.member_field_definitions
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_memberships_updated_at ON public.memberships;
CREATE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
