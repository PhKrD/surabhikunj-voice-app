-- =====================================================================
-- 28. MENTORSHIP — Generic relationship primitive
-- =====================================================================
-- Replaces the single `profiles.counsellor_id` FK with a typed,
-- versioned, many-to-one (or many-to-many) relationship model any
-- organization can use for:
--   spiritual counsellor / devotee (Surabhikunj)
--   manager / employee
--   senior volunteer / junior volunteer
--   teacher / student
--   buddy / new member
--
-- Architecture:
--   mentorship_types         — org-defined relationship types
--   mentorship_relationships — the actual links (mentor ↔ mentee)
--
-- Existing counsellor_id FK values are migrated.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MENTORSHIP TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,                    -- "Counsellor", "Buddy"
  mentor_label     TEXT NOT NULL DEFAULT 'Mentor',   -- label for the mentor side
  mentee_label     TEXT NOT NULL DEFAULT 'Mentee',   -- label for the mentee side
  description      TEXT,
  icon             TEXT DEFAULT 'Users',
  color            TEXT DEFAULT '#0891b2',

  -- Maximum mentees a single mentor can hold (NULL = unlimited)
  max_mentees      INTEGER,

  -- Whether the org enforces a 1-mentor limit per mentee for this type
  exclusive        BOOLEAN NOT NULL DEFAULT TRUE,

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_types_org
  ON public.mentorship_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. MENTORSHIP RELATIONSHIPS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_relationships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type_id     UUID NOT NULL REFERENCES public.mentorship_types(id) ON DELETE CASCADE,
  mentor_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  notes       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, type_id, mentee_id)   -- exclusive: one mentor per mentee per type
);

ALTER TABLE public.mentorship_relationships
  DROP CONSTRAINT IF EXISTS mentorship_relationships_status_check;
ALTER TABLE public.mentorship_relationships
  ADD CONSTRAINT mentorship_relationships_status_check
  CHECK (status IN ('active', 'ended', 'paused'));

CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentor
  ON public.mentorship_relationships (mentor_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_mentee
  ON public.mentorship_relationships (mentee_id, org_id, status);
CREATE INDEX IF NOT EXISTS idx_mentorship_rels_org
  ON public.mentorship_relationships (org_id, type_id, status);

-- ---------------------------------------------------------------------
-- 3. GUARD — mentor cannot be their own mentee
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_self_mentorship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mentor_id = NEW.mentee_id THEN
    RAISE EXCEPTION 'A member cannot be their own mentor';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_mentorship ON public.mentorship_relationships;
CREATE TRIGGER trg_prevent_self_mentorship
  BEFORE INSERT OR UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_self_mentorship();

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Counsellor type + migrate counsellor_id
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id  UUID;
  v_type_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.mentorship_types
    (org_id, name, mentor_label, mentee_label, description, icon, color,
     max_mentees, exclusive, sort_order)
  VALUES
    (v_org_id, 'Counsellor', 'Counsellor', 'Counsellee',
     'Spiritual guidance and sadhana review',
     'Users', '#0891b2', NULL, TRUE, 10)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.mentorship_types WHERE org_id = v_org_id AND name = 'Counsellor' LIMIT 1;
  END IF;

  -- Migrate profiles.counsellor_id → mentorship_relationships
  INSERT INTO public.mentorship_relationships
    (org_id, type_id, mentor_id, mentee_id, status)
  SELECT
    v_org_id,
    v_type_id,
    counsellor_id,
    id,
    'active'
  FROM public.profiles
  WHERE org_id = v_org_id
    AND counsellor_id IS NOT NULL
    AND counsellor_id <> id
  ON CONFLICT (org_id, type_id, mentee_id) DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 5. SYNC TRIGGER — keep the legacy counsellor_id column in sync
-- ---------------------------------------------------------------------
-- During the expand phase, some code still reads profiles.counsellor_id.
-- Any write to mentorship_relationships mirrors back.

CREATE OR REPLACE FUNCTION public.sync_counsellor_id()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_counsellor_type BOOLEAN;
BEGIN
  SELECT name = 'Counsellor' INTO v_is_counsellor_type
  FROM public.mentorship_types WHERE id = COALESCE(NEW.type_id, OLD.type_id);

  IF NOT v_is_counsellor_type THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status <> 'active') THEN
    UPDATE public.profiles
    SET counsellor_id = NULL, updated_at = NOW()
    WHERE id = OLD.mentee_id AND counsellor_id = OLD.mentor_id;
  ELSE
    UPDATE public.profiles
    SET counsellor_id = NEW.mentor_id, updated_at = NOW()
    WHERE id = NEW.mentee_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_counsellor_id ON public.mentorship_relationships;
CREATE TRIGGER trg_sync_counsellor_id
  AFTER INSERT OR UPDATE OF mentor_id, mentee_id, status OR DELETE
  ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.sync_counsellor_id();

-- ---------------------------------------------------------------------
-- 6. HELPERS
-- ---------------------------------------------------------------------

-- Mentees the caller mentors, with their latest tracker scores
CREATE OR REPLACE FUNCTION public.my_mentees(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentee_id   UUID,
  type_id     UUID,
  type_name   TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentee_id, mr.type_id, mt.name, mr.status, mr.started_at
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  WHERE mr.mentor_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name, mr.started_at;
$$;

-- Who mentors the caller
CREATE OR REPLACE FUNCTION public.my_mentor(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentor_id     UUID,
  type_id       UUID,
  type_name     TEXT,
  status        TEXT,
  started_at    TIMESTAMPTZ,
  mentor_name   TEXT,
  mentor_avatar TEXT,
  mentor_phone  TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.mentor_id, mr.type_id, mt.name, mr.status, mr.started_at,
         p.spiritual_name, p.avatar_url, p.phone
  FROM public.mentorship_relationships mr
  JOIN public.mentorship_types mt ON mt.id = mr.type_id
  JOIN public.profiles p           ON p.id  = mr.mentor_id
  WHERE mr.mentee_id = auth.uid()
    AND mr.org_id    = public.current_org_id()
    AND mr.status    = 'active'
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
  ORDER BY mt.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_mentees(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_mentor(UUID)  TO authenticated;

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.mentorship_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentorship_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_types_select" ON public.mentorship_types;
CREATE POLICY "mentorship_types_select" ON public.mentorship_types
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "mentorship_types_write" ON public.mentorship_types;
CREATE POLICY "mentorship_types_write" ON public.mentorship_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('mentorship.manage')
  );

-- A mentee sees their own relationship; a mentor sees their mentees;
-- admins with mentorship.view_all see everything.
DROP POLICY IF EXISTS "mentorship_rels_select" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_select" ON public.mentorship_relationships
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      mentee_id = auth.uid()
      OR mentor_id = auth.uid()
      OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
    )
  );

DROP POLICY IF EXISTS "mentorship_rels_write" ON public.mentorship_relationships;
CREATE POLICY "mentorship_rels_write" ON public.mentorship_relationships
  FOR ALL USING (
    org_id = public.current_org_id()
    AND public.has_permission('mentorship.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_mentorship_rels_updated_at ON public.mentorship_relationships;
CREATE TRIGGER trg_mentorship_rels_updated_at
  BEFORE UPDATE ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
