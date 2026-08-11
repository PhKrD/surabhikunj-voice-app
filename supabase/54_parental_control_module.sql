-- =====================================================================
-- 54. REGISTER PARENTAL CONTROL NAV MODULE
-- =====================================================================
-- Parental Control isn't gated by an org RBAC permission — access to a
-- child's data is enforced at the row level (pc_is_parent_of(), matching
-- pc_children.parent_id = auth.uid()), so any active member of an org can
-- see the nav entry and manage only the children/devices they created.
--
-- Idempotent.
-- =====================================================================

INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('parental_control', 'Parental Control', 'Manage children, devices, screen time and safety alerts',
   'ShieldCheck', '/parental-control', 'family', NULL, FALSE, TRUE, 70)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      sort_order          = EXCLUDED.sort_order;

INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key = 'parental_control'
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled = TRUE, updated_at = NOW()
WHERE module_key = 'parental_control'
  AND enabled IS DISTINCT FROM TRUE;

NOTIFY pgrst, 'reload schema';
