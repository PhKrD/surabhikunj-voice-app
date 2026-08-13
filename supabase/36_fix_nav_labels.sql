-- =====================================================================
-- 36. FIX BLANK NAVIGATION LABELS
-- =====================================================================
-- my_navigation() used COALESCE(om.label_override, m.name). COALESCE only
-- falls back on NULL, so an empty-string label_override (easy to save from
-- the Settings screen) produced a nav item with no visible text — the
-- sidebar rendered a blank row where "Org Structure" should be.
--
-- Fix: treat blank/whitespace-only overrides as "no override" via NULLIF,
-- and clean up any empty overrides already stored.
--
-- Idempotent: safe to re-run.
-- =====================================================================

UPDATE public.organization_modules
SET label_override = NULL
WHERE label_override IS NOT NULL AND trim(label_override) = '';

UPDATE public.organization_modules
SET icon_override = NULL
WHERE icon_override IS NOT NULL AND trim(icon_override) = '';

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
    COALESCE(NULLIF(trim(om.label_override), ''), m.name)  AS label,
    COALESCE(NULLIF(trim(om.icon_override),  ''), m.icon)  AS icon,
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
