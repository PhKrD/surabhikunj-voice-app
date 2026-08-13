-- =====================================================================
-- 23. MODULE REGISTRY — Org-controlled features & navigation
-- =====================================================================
-- The sidebar is currently a hardcoded array, so every org sees Sadhana,
-- Kitchen and Cleanliness whether or not they use them.
--
--   modules              global catalog of installable features
--   organization_modules which are on for an org, in what order, named what
--
-- An org enables only what it needs, renames labels to its own vocabulary,
-- reorders navigation, and stores per-module config as JSONB. Adding a new
-- module later is one INSERT into the catalog — no core changes.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULE CATALOG (global)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.modules (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  icon                TEXT,      -- lucide icon name
  route               TEXT,      -- frontend path
  category            TEXT NOT NULL DEFAULT 'general',

  -- Permission a member needs before the nav item is shown to them
  required_permission TEXT REFERENCES public.permissions(key) ON DELETE SET NULL,

  -- Core modules cannot be disabled (an org always needs members + settings)
  is_core             BOOLEAN NOT NULL DEFAULT FALSE,

  -- Enabled automatically for brand-new organizations
  default_enabled     BOOLEAN NOT NULL DEFAULT TRUE,

  -- JSON Schema describing this module's config surface (for admin UI)
  config_schema       JSONB NOT NULL DEFAULT '{}'::jsonb,

  sort_order          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('dashboard',     'Dashboard',     'Overview and key metrics',                  'LayoutDashboard', '/',              'core',        NULL,                  TRUE,  TRUE,  0),
  ('members',       'Members',       'Member directory and profiles',             'Users',           '/members',       'core',        'members.view',        TRUE,  TRUE,  10),
  ('departments',   'Departments',   'Teams, departments and their members',      'Building2',       '/departments',   'structure',   'departments.view',    FALSE, TRUE,  20),
  ('hierarchy',     'Org Structure', 'Organization chart and reporting lines',    'GitBranch',       '/hierarchy',     'structure',   'hierarchy.view',      FALSE, TRUE,  30),
  ('events',        'Events',        'Calendar, programs and attendance',         'CalendarDays',    '/events',        'operations',  'events.view',         FALSE, TRUE,  40),
  ('trackers',      'Trackers',      'Recurring self-reported metrics & scoring', 'BookOpen',        '/trackers',      'operations',  'trackers.view_own',   FALSE, FALSE, 50),
  ('tasks',         'Tasks',         'Recurring assignments and duty rosters',    'ListChecks',      '/tasks',         'operations',  'tasks.view_own',      FALSE, FALSE, 60),
  ('resources',     'Resource Plans','Meal, inventory and resource planning',     'UtensilsCrossed', '/resources',     'operations',  'resources.view',      FALSE, FALSE, 70),
  ('mentorship',    'Mentorship',    'Mentor and mentee relationships',           'Users',           '/mentorship',    'people',      'mentorship.view_own', FALSE, FALSE, 80),
  ('announcements', 'Announcements', 'Org-wide posts and notices',                'Megaphone',       '/announcements', 'comms',       'announcements.view',  FALSE, TRUE,  90),
  ('notifications', 'Notifications', 'Personal notification inbox',               'Bell',            '/notifications', 'comms',       NULL,                  TRUE,  TRUE,  100),
  ('reports',       'Reports',       'Analytics, dashboards and exports',         'BarChart3',       '/reports',       'insights',    'reports.view',        FALSE, FALSE, 110),
  ('settings',      'Settings',      'Organization and personal settings',        'Settings',        '/settings',      'core',        NULL,                  TRUE,  TRUE,  120)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      is_core             = EXCLUDED.is_core,
      sort_order          = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. PER-ORGANIZATION MODULE STATE
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_modules (
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key     TEXT NOT NULL REFERENCES public.modules(key)      ON DELETE CASCADE,

  enabled        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Org's own wording, e.g. trackers -> "Sadhana", members -> "Devotees"
  label_override TEXT,
  icon_override  TEXT,

  sort_order     INTEGER NOT NULL DEFAULT 0,

  -- Module-specific configuration
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (org_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_enabled
  ON public.organization_modules (org_id, enabled, sort_order);

-- ---------------------------------------------------------------------
-- 3. SEEDING
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_default_modules(p_org_id UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
  SELECT p_org_id, key, (default_enabled OR is_core), sort_order
  FROM public.modules
  ON CONFLICT (org_id, module_key) DO NOTHING;
$$;

-- Every existing org gets the full catalog at platform defaults
DO $$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_modules(o.id);
  END LOOP;
END $$;

-- New orgs are seeded automatically
CREATE OR REPLACE FUNCTION public.seed_modules_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_default_modules(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_modules_for_new_org ON public.organizations;
CREATE TRIGGER trg_seed_modules_for_new_org
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_modules_for_new_org();

-- ---------------------------------------------------------------------
-- 4. SURABHIKUNJ: turn on the modules they actually use, in their words
-- ---------------------------------------------------------------------
-- Their existing feature set is expressed as configuration rather than as
-- platform defaults, which is exactly the point of this migration.

DO $$
DECLARE v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Sadhana',    icon_override = 'BookOpen'        WHERE org_id = v_org_id AND module_key = 'trackers';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Services',   icon_override = 'ListChecks'      WHERE org_id = v_org_id AND module_key = 'tasks';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Kitchen',    icon_override = 'UtensilsCrossed' WHERE org_id = v_org_id AND module_key = 'resources';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Counsellor', icon_override = 'Users'           WHERE org_id = v_org_id AND module_key = 'mentorship';
  UPDATE public.organization_modules SET enabled = TRUE, label_override = 'Residents'                                     WHERE org_id = v_org_id AND module_key = 'members';
  UPDATE public.organization_modules SET enabled = TRUE                                                                   WHERE org_id = v_org_id AND module_key = 'reports';
END $$;

-- ---------------------------------------------------------------------
-- 5. NAVIGATION RESOLVER
-- ---------------------------------------------------------------------
-- One call returns the caller's sidebar: enabled modules they have
-- permission to see, already labelled and ordered. Replaces the hardcoded
-- navItems array in Sidebar.jsx.

CREATE OR REPLACE FUNCTION public.my_navigation()
RETURNS TABLE (
  key        TEXT,
  label      TEXT,
  icon       TEXT,
  route      TEXT,
  category   TEXT,
  sort_order INTEGER,
  config     JSONB
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    m.key,
    COALESCE(om.label_override, m.name)  AS label,
    COALESCE(om.icon_override,  m.icon)  AS icon,
    m.route,
    m.category,
    om.sort_order,
    om.config
  FROM public.organization_modules om
  JOIN public.modules m ON m.key = om.module_key
  WHERE om.org_id = public.current_org_id()
    AND om.enabled
    AND (
      m.required_permission IS NULL
      OR public.has_permission(m.required_permission)
    )
  ORDER BY om.sort_order, m.name;
$$;

GRANT EXECUTE ON FUNCTION public.my_navigation() TO authenticated;

-- Is a module switched on for the caller's org? Used to guard routes and
-- to short-circuit queries against disabled features.
CREATE OR REPLACE FUNCTION public.module_enabled(p_module_key TEXT)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM public.organization_modules
     WHERE org_id = public.current_org_id() AND module_key = p_module_key),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.module_enabled(TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. GUARD — core modules stay enabled
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_core_modules()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enabled = FALSE
     AND EXISTS (SELECT 1 FROM public.modules WHERE key = NEW.module_key AND is_core)
  THEN
    RAISE EXCEPTION 'Module "%" is core and cannot be disabled', NEW.module_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_core_modules ON public.organization_modules;
CREATE TRIGGER trg_protect_core_modules
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.protect_core_modules();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "modules_select" ON public.modules;
CREATE POLICY "modules_select" ON public.modules
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "org_modules_select" ON public.organization_modules;
CREATE POLICY "org_modules_select" ON public.organization_modules
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "org_modules_write" ON public.organization_modules;
CREATE POLICY "org_modules_write" ON public.organization_modules
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('org.modules.manage')
  );

-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_org_modules_updated_at ON public.organization_modules;
CREATE TRIGGER trg_org_modules_updated_at
  BEFORE UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
