-- =====================================================================
-- 27. RESOURCES — Generic planning primitive
-- =====================================================================
-- Generalises `meal_plans` into a flexible planning engine for any
-- resource an organization wants to schedule: food menus, inventory
-- allocation, equipment booking, room reservations, prasad distribution,
-- budget line items, etc.
--
-- Architecture:
--   resource_types     — org-defined categories (Meal, Room, Equipment…)
--   resource_plans     — a scheduled plan for one resource type on one date
--   resource_plan_items— the individual items (dishes, quantities, notes)
--
-- Surabhikunj's meal_plans are migrated into this model.
-- The old table remains for the current bundle; it is deprecated in
-- the contract phase.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RESOURCE TYPES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                  -- "Meal Plan", "Room Booking"
  icon        TEXT DEFAULT 'UtensilsCrossed',
  color       TEXT DEFAULT '#f59e0b',
  description TEXT,

  -- Period controls how one plan covers: 'day' | 'week' | 'month'
  period      TEXT NOT NULL DEFAULT 'day',

  -- Free-form labels for sub-types within a plan (meal types, time slots…)
  -- e.g. ["Breakfast", "Lunch", "Dinner"]
  slots       TEXT[] NOT NULL DEFAULT '{}',

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.resource_types
  DROP CONSTRAINT IF EXISTS resource_types_period_check;
ALTER TABLE public.resource_types
  ADD CONSTRAINT resource_types_period_check
  CHECK (period IN ('day', 'week', 'month'));

CREATE INDEX IF NOT EXISTS idx_resource_types_org
  ON public.resource_types (org_id, is_active, sort_order);

-- ---------------------------------------------------------------------
-- 2. RESOURCE PLANS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_type_id UUID NOT NULL REFERENCES public.resource_types(id) ON DELETE CASCADE,
  plan_date       DATE NOT NULL,
  slot            TEXT,           -- e.g. "Lunch" — must match one of resource_types.slots
  title           TEXT,           -- optional human label
  notes           TEXT,
  is_special      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, resource_type_id, plan_date, slot)
);

CREATE INDEX IF NOT EXISTS idx_resource_plans_org_date
  ON public.resource_plans (org_id, resource_type_id, plan_date);

-- ---------------------------------------------------------------------
-- 3. RESOURCE PLAN ITEMS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.resource_plan_items (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id  UUID NOT NULL REFERENCES public.resource_plans(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,             -- dish name, item name, quantity label
  quantity TEXT,                      -- "500 g", "2 trays", free-form
  notes    TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_resource_plan_items_plan
  ON public.resource_plan_items (plan_id, sort_order);

-- ---------------------------------------------------------------------
-- 4. SEED SURABHIKUNJ: Meal Plan resource type + migrate meal_plans
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id     UUID;
  v_type_id    UUID;
  v_plan_id    UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Create the Meal Plan resource type
  INSERT INTO public.resource_types (org_id, name, icon, color, period, slots)
  VALUES (
    v_org_id,
    'Meal Plan',
    'UtensilsCrossed',
    '#f59e0b',
    'day',
    ARRAY['Breakfast', 'Lunch', 'Dinner', 'Special Prasad']
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_type_id;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id
    FROM public.resource_types WHERE org_id = v_org_id AND name = 'Meal Plan' LIMIT 1;
  END IF;

  -- Migrate meal_plans → resource_plans + resource_plan_items
  FOR v_plan_id IN
    INSERT INTO public.resource_plans
      (org_id, resource_type_id, plan_date, slot, notes, is_special, created_by, created_at, updated_at)
    SELECT
      m.org_id,
      v_type_id,
      m.plan_date,
      CASE m.meal_type::text
        WHEN 'breakfast'     THEN 'Breakfast'
        WHEN 'lunch'         THEN 'Lunch'
        WHEN 'dinner'        THEN 'Dinner'
        WHEN 'prasad_special' THEN 'Special Prasad'
        ELSE m.meal_type::text
      END,
      m.notes,
      m.is_special,
      m.created_by,
      m.created_at,
      m.updated_at
    FROM public.meal_plans m
    WHERE m.org_id = v_org_id
    ON CONFLICT (org_id, resource_type_id, plan_date, slot) DO NOTHING
    RETURNING id
  LOOP
    -- Create one item per menu entry
    INSERT INTO public.resource_plan_items (plan_id, name, sort_order)
    SELECT
      v_plan_id,
      unnest_item,
      row_number() OVER ()
    FROM (
      SELECT unnest(mp.menu_items) AS unnest_item
      FROM public.meal_plans mp
      JOIN public.resource_plans rp ON rp.id = v_plan_id
      WHERE mp.org_id = v_org_id
        AND mp.plan_date = rp.plan_date
    ) sub
    WHERE unnest_item IS NOT NULL
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.resource_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plans      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "resource_types_select" ON public.resource_types;
CREATE POLICY "resource_types_select" ON public.resource_types
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_types_write" ON public.resource_types;
CREATE POLICY "resource_types_write" ON public.resource_types
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

DROP POLICY IF EXISTS "resource_plans_select" ON public.resource_plans;
CREATE POLICY "resource_plans_select" ON public.resource_plans
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('resources.view')
  );

DROP POLICY IF EXISTS "resource_plans_write" ON public.resource_plans;
CREATE POLICY "resource_plans_write" ON public.resource_plans
  FOR ALL USING (
    org_id = public.current_org_id() AND public.has_permission('resources.manage')
  );

-- Items inherit from plans
DROP POLICY IF EXISTS "resource_plan_items_select" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_select" ON public.resource_plan_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
        AND public.has_permission('resources.view')
    )
  );

DROP POLICY IF EXISTS "resource_plan_items_write" ON public.resource_plan_items;
CREATE POLICY "resource_plan_items_write" ON public.resource_plan_items
  FOR ALL USING (
    public.has_permission('resources.manage')
    AND EXISTS (
      SELECT 1 FROM public.resource_plans rp
      WHERE rp.id = plan_id AND rp.org_id = public.current_org_id()
    )
  );

-- ---------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_resource_plans_updated_at ON public.resource_plans;
CREATE TRIGGER trg_resource_plans_updated_at
  BEFORE UPDATE ON public.resource_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
