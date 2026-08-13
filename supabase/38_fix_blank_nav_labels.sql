-- =====================================================================
-- 38. FIX BLANK NAV LABELS — AGGRESSIVE CLEANUP
-- =====================================================================
-- my_navigation() returns empty string labels when label_override is ''
-- or whitespace (COALESCE only skips NULL, not empty string). The client-
-- side trim+fallback in Sidebar.jsx should handle this, but we also clean
-- the database so the issue can never recurse.
--
-- This migration supersedes / is safe to run alongside migration 36.
-- Idempotent.
-- =====================================================================

-- 1. Wipe empty or whitespace-only label / icon overrides everywhere
UPDATE public.organization_modules
SET label_override = NULL
WHERE label_override IS NOT NULL AND trim(label_override) = '';

UPDATE public.organization_modules
SET icon_override = NULL
WHERE icon_override IS NOT NULL AND trim(icon_override) = '';

-- 2. Ensure the canonical module names are never blank
--    (defensive: re-set them to the correct English defaults if something
--     wiped them during an early migration / conflict)
UPDATE public.modules SET name = 'Dashboard'      WHERE key = 'dashboard'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Members'        WHERE key = 'members'     AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Departments'    WHERE key = 'departments' AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Org Structure'  WHERE key = 'hierarchy'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Events'         WHERE key = 'events'      AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Trackers'       WHERE key = 'trackers'    AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Tasks'          WHERE key = 'tasks'       AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Resource Plans' WHERE key = 'resources'   AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Mentorship'     WHERE key = 'mentorship'  AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Announcements'  WHERE key = 'announcements' AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Reports'        WHERE key = 'reports'     AND (name IS NULL OR trim(name) = '');
UPDATE public.modules SET name = 'Residents'      WHERE key = 'residents'   AND (name IS NULL OR trim(name) = '');

-- 3. Replace my_navigation() with a triple-safe version:
--    • NULLIF trims blank label_override before COALESCE
--    • Falls back to key if name is somehow also blank
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
    COALESCE(
      NULLIF(trim(om.label_override), ''),
      NULLIF(trim(m.name), ''),
      m.key
    ) AS label,
    COALESCE(
      NULLIF(trim(om.icon_override), ''),
      NULLIF(trim(m.icon), ''),
      'Circle'
    ) AS icon,
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

NOTIFY pgrst, 'reload schema';
