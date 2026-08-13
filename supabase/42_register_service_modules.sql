-- =====================================================================
-- 42. REGISTER IM SERVICES + CLEANLINESS NAV MODULES; RETIRE TASKS
-- =====================================================================
-- Adds two catalogue modules that both ride on the task_* engine:
--   'service'      IM Services   /services
--   'cleanliness'  Cleanliness   /cleanliness
-- and disables the generic 'tasks' module (its schema stays, only the nav
-- entry is retired) so the sidebar shows the two focused modules instead.
--
-- Both reuse the existing tasks.* permission family, so no role reseed is
-- needed. Idempotent.
-- =====================================================================

-- 1. Catalogue entries
INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('service',     'IM Services', 'Individual service assignments and rosters', 'ListChecks', '/services',    'operations', 'tasks.view_own',      FALSE, TRUE, 60),
  ('cleanliness', 'Cleanliness', 'Cleaning duties, areas and verification',    'Sparkles',   '/cleanliness', 'operations', 'tasks.view_own',      FALSE, TRUE, 65),
  ('broadcast',   'Broadcasts',  'Send and schedule notifications to members', 'Megaphone',  '/broadcast',   'comms',      'announcements.manage', FALSE, TRUE, 135)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      sort_order          = EXCLUDED.sort_order;

-- 2. Enable them for every org; leave any label_override intact
INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key IN ('service', 'cleanliness', 'broadcast')
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled = TRUE, updated_at = NOW()
WHERE module_key IN ('service', 'cleanliness', 'broadcast')
  AND enabled IS DISTINCT FROM TRUE;

-- 3. Retire the generic Tasks nav entry (schema + permissions remain)
UPDATE public.organization_modules
SET enabled = FALSE, updated_at = NOW()
WHERE module_key = 'tasks';

NOTIFY pgrst, 'reload schema';
