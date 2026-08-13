-- =====================================================================
-- 20. PLATFORM CORE — Generic Multi-Tenant Foundation
-- =====================================================================
-- Transforms the Surabhikunj-specific "voices" tenant into a generic
-- "organizations" tenant that any temple / NGO / community can use.
--
-- EXPAND phase: additive + renames only. Nothing is dropped. A backwards
-- compatible `voices` view keeps older app bundles working until cutover.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. voices -> organizations
-- ---------------------------------------------------------------------
-- Postgres carries all FKs, indexes and RLS policies through a rename,
-- so dependent tables need no changes. Functions with literal SQL text
-- DO break, and are recreated in section 6.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'voices')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'organizations')
  THEN
    ALTER TABLE public.voices RENAME TO organizations;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Platform columns on organizations
-- ---------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS slug          TEXT,
  ADD COLUMN IF NOT EXISTS legal_name    TEXT,
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan          TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS timezone      TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS locale        TEXT NOT NULL DEFAULT 'en-IN',
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS website_url   TEXT,
  ADD COLUMN IF NOT EXISTS owner_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Status is a small controlled vocabulary, not an enum (orgs may need more later)
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'trial', 'archived'));

-- Derive a URL-safe slug for any org that lacks one
UPDATE public.organizations
SET slug = regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g')
WHERE slug IS NULL;

-- Guarantee uniqueness before adding the constraint (append short id suffix on collision)
UPDATE public.organizations o
SET slug = o.slug || '-' || left(o.id::text, 6)
WHERE EXISTS (
  SELECT 1 FROM public.organizations d
  WHERE d.slug = o.slug AND d.id <> o.id AND d.created_at < o.created_at
);

ALTER TABLE public.organizations ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON public.organizations (status);

-- ---------------------------------------------------------------------
-- 3. voice_id -> org_id across every tenant-scoped table
-- ---------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'org_positions', 'departments', 'sadhana_reports',
    'sadhana_score_config', 'cleaning_areas', 'cleaning_logs', 'services',
    'service_allocations', 'meal_plans', 'events', 'notifications',
    'announcements', 'sadhana_config', 'weekly_sadhana_reports',
    'push_subscriptions'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'voice_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'org_id'
    )
    THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN voice_id TO org_id', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. ORGANIZATION SETTINGS — branding, terminology, feature flags
-- ---------------------------------------------------------------------
-- Kept as JSONB so an org can add keys without a schema migration. This is
-- the white-label surface: name, logo, colours, and the words the UI uses.

CREATE TABLE IF NOT EXISTS public.organization_settings (
  org_id      UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- { "primaryColor": "#f97316", "accentColor": "#ec4899", "logoUrl": "...",
  --   "faviconUrl": "...", "iconName": "Flame", "loginTagline": "..." }
  branding    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Overrides for platform nouns, e.g. { "member": "Devotee",
  --   "members": "Devotees", "organization": "VOICE", "tracker": "Sadhana" }
  terminology JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Org-wide toggles that are not modules, e.g. { "requireApproval": true }
  features    JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every existing org gets a settings row
INSERT INTO public.organization_settings (org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

-- Seed Surabhikunj's current look & language as ITS OWN settings, so the
-- platform defaults stay generic while the app looks unchanged for them.
UPDATE public.organization_settings s
SET branding = jsonb_build_object(
      'primaryColor', '#f97316',
      'accentColor',  '#ec4899',
      'iconName',     'Flame',
      'shortName',    'SurabhiKunj',
      'tagline',      'VOICE',
      'loginTagline', 'Vaishnava Organisation for Inspired & Committed Enthusiasts'
    ),
    terminology = jsonb_build_object(
      'member',       'Devotee',
      'members',      'Devotees',
      'organization', 'VOICE',
      'tracker',      'Sadhana',
      'mentor',       'Counsellor',
      'mentee',       'Counsellee'
    )
FROM public.organizations o
WHERE s.org_id = o.id
  AND o.name ILIKE '%surabhikunj%'
  AND s.branding = '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 5. Backwards-compatible `voices` view
-- ---------------------------------------------------------------------
-- Older deployed bundles still SELECT from voices. Reads keep working;
-- writes were admin-only and move to organizations.

CREATE OR REPLACE VIEW public.voices AS
  SELECT id, name, location, description, logo_url, created_at, updated_at
  FROM public.organizations;

GRANT SELECT ON public.voices TO authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. Recreate helper functions broken by the rename
-- ---------------------------------------------------------------------
-- Function bodies are stored as text, so `voice_id` references inside them
-- did NOT follow the column rename and must be redefined.

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

-- Legacy alias — kept so existing policies/queries keep resolving.
CREATE OR REPLACE FUNCTION public.get_my_voice_id()
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.current_org_id();
$$;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_voice_id() TO authenticated;

-- Tenant creation, generalised from create_voice_tenant.
-- Any authenticated user may found an organization; they become its owner.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name     TEXT,
  p_slug     TEXT DEFAULT NULL,
  p_location TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT 'Asia/Kolkata'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_slug   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to create an organization';
  END IF;

  v_slug := COALESCE(
    NULLIF(regexp_replace(lower(trim(p_slug)), '[^a-z0-9]+', '-', 'g'), ''),
    regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g')
  );

  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || left(gen_random_uuid()::text, 6);
  END IF;

  INSERT INTO public.organizations (name, slug, location, timezone, owner_id)
  VALUES (p_name, v_slug, p_location, p_timezone, auth.uid())
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_settings (org_id) VALUES (v_org_id);

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. RLS for the new tables
-- ---------------------------------------------------------------------

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_settings_select" ON public.organization_settings;
CREATE POLICY "org_settings_select" ON public.organization_settings
  FOR SELECT USING (org_id = public.current_org_id());

-- Write access is tightened to a real permission in migration 24.
DROP POLICY IF EXISTS "org_settings_write" ON public.organization_settings;
CREATE POLICY "org_settings_write" ON public.organization_settings
  FOR ALL USING (org_id = public.current_org_id() AND public.is_admin());

DROP POLICY IF EXISTS "organizations_select" ON public.organizations;
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (id = public.current_org_id());

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_org_settings_updated_at ON public.organization_settings;
CREATE TRIGGER trg_org_settings_updated_at
  BEFORE UPDATE ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 9. Re-point indexes named after the old column (cosmetic but keeps
--    future maintenance readable)
-- ---------------------------------------------------------------------

ALTER INDEX IF EXISTS idx_profiles_voice_id        RENAME TO idx_profiles_org_id;
ALTER INDEX IF EXISTS idx_sadhana_reports_voice_date RENAME TO idx_sadhana_reports_org_date;
ALTER INDEX IF EXISTS idx_cleaning_logs_voice_date RENAME TO idx_cleaning_logs_org_date;
