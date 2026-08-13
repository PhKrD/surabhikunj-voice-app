-- =====================================================================
-- 26. TASKS — Generic recurring assignment primitive
-- =====================================================================
-- Unifies `cleaning_areas`, `cleaning_assignments`, `cleaning_logs`,
-- `services`, `service_allocations`, and `service_preferences` under one
-- consistent model any organization can use for any kind of duty roster,
-- chore schedule, or service allocation.
--
-- Architecture:
--   task_categories   — org-defined groupings (e.g. "Cleaning", "Temple Service")
--   task_templates    — the reusable task itself (what, how long, recurrence)
--   task_areas        — physical or logical locations a task happens in
--   task_assignments  — who is assigned to a task/area in what window
--   task_logs         — per-day completion records
--   task_preferences  — a member's availability preferences per period
--
-- Legacy tables stay; they are migrated into this model.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TASK CATEGORIES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT DEFAULT 'ListChecks',
  color       TEXT DEFAULT '#64748b',
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_categories_org
  ON public.task_categories (org_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. TASK TEMPLATES
-- ---------------------------------------------------------------------
-- Describes a recurring task type. Actual assignments are generated from
-- these templates by managers.

CREATE TABLE IF NOT EXISTS public.task_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES public.task_categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  instructions    TEXT,
  department_id   UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  default_time    TIME,
  duration_min    INTEGER,
  recurrence      TEXT NOT NULL DEFAULT 'daily',  -- daily|weekly|monthly|custom
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.task_templates
  DROP CONSTRAINT IF EXISTS task_templates_recurrence_check;
ALTER TABLE public.task_templates
  ADD CONSTRAINT task_templates_recurrence_check
  CHECK (recurrence IN ('daily', 'weekly', 'monthly', 'custom', 'once'));

CREATE INDEX IF NOT EXISTS idx_task_templates_org
  ON public.task_templates (org_id, is_active);

-- ---------------------------------------------------------------------
-- 3. TASK AREAS
-- ---------------------------------------------------------------------
-- Optional physical/logical location for a task (cleaning area, worship
-- station, kitchen section, etc.). Tasks can exist without areas.

CREATE TABLE IF NOT EXISTS public.task_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  location    TEXT,           -- floor / building / section
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_areas_org
  ON public.task_areas (org_id, is_active);

-- ---------------------------------------------------------------------
-- 4. TASK ASSIGNMENTS
-- ---------------------------------------------------------------------
-- Assigns a member to a task (and optionally area) for a date window.

CREATE TABLE IF NOT EXISTS public.task_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id   UUID REFERENCES public.task_templates(id) ON DELETE CASCADE,
  area_id       UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_date     DATE NOT NULL,
  task_time     TIME,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique: one assignment per user per task per area per day
  UNIQUE (template_id, area_id, user_id, task_date)
);

CREATE INDEX IF NOT EXISTS idx_task_assignments_org_date
  ON public.task_assignments (org_id, task_date, user_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user
  ON public.task_assignments (user_id, task_date DESC);

-- ---------------------------------------------------------------------
-- 5. TASK LOGS
-- ---------------------------------------------------------------------
-- Completion record for an assignment on a given day.

CREATE TABLE IF NOT EXISTS public.task_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id  UUID REFERENCES public.task_assignments(id) ON DELETE CASCADE,

  -- Denormalized for queries that don't need the assignment
  template_id    UUID REFERENCES public.task_templates(id) ON DELETE SET NULL,
  area_id        UUID REFERENCES public.task_areas(id) ON DELETE SET NULL,
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL DEFAULT CURRENT_DATE,

  status         TEXT NOT NULL DEFAULT 'pending',
  verified_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at    TIMESTAMPTZ,
  notes          TEXT,
  marked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (assignment_id, log_date)
);

ALTER TABLE public.task_logs
  DROP CONSTRAINT IF EXISTS task_logs_status_check;
ALTER TABLE public.task_logs
  ADD CONSTRAINT task_logs_status_check
  CHECK (status IN ('pending', 'done', 'partial', 'missed', 'excused', 'verified'));

CREATE INDEX IF NOT EXISTS idx_task_logs_org_date
  ON public.task_logs (org_id, log_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_logs_user
  ON public.task_logs (user_id, log_date DESC);

-- ---------------------------------------------------------------------
-- 6. TASK PREFERENCES
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_preferences (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id  UUID NOT NULL REFERENCES public.task_templates(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  preference   INTEGER NOT NULL DEFAULT 1, -- 1=preferred, 0=ok, -1=avoid
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, template_id, period_start)
);

-- ---------------------------------------------------------------------
-- 7. SEED SURABHIKUNJ: create categories for Cleaning and Services
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_org_id          UUID;
  v_cleaning_cat_id UUID;
  v_service_cat_id  UUID;
  v_tmpl_id         UUID;
  v_area_id         UUID;
BEGIN
  SELECT id INTO v_org_id
  FROM public.organizations WHERE name ILIKE '%surabhikunj%' LIMIT 1;
  IF v_org_id IS NULL THEN RETURN; END IF;

  -- Categories
  INSERT INTO public.task_categories (org_id, name, icon, color, sort_order)
  VALUES
    (v_org_id, 'Cleanliness', 'Sparkles',   '#16a34a', 10),
    (v_org_id, 'Temple Service', 'ListChecks', '#f97316', 20)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_cleaning_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Cleanliness' LIMIT 1;
  SELECT id INTO v_service_cat_id
  FROM public.task_categories WHERE org_id = v_org_id AND name = 'Temple Service' LIMIT 1;

  -- Migrate cleaning_areas → task_areas
  INSERT INTO public.task_areas (id, org_id, name, description, location, is_active)
  SELECT id, org_id, name, description, floor, is_active
  FROM public.cleaning_areas
  WHERE org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Create one template per cleaning area (simple 1-to-1 for backwards compat)
  FOR v_area_id IN
    SELECT id FROM public.task_areas WHERE org_id = v_org_id
  LOOP
    INSERT INTO public.task_templates (org_id, category_id, name, recurrence, is_active)
    SELECT v_org_id, v_cleaning_cat_id,
           (SELECT name FROM public.task_areas WHERE id = v_area_id),
           'daily', TRUE
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_tmpl_id;
  END LOOP;

  -- Migrate services → task_templates (service category)
  INSERT INTO public.task_templates
    (id, org_id, category_id, name, description, instructions,
     department_id, default_time, duration_min, recurrence, is_active)
  SELECT
    s.id, s.org_id, v_service_cat_id,
    s.name, s.description, s.instructions,
    s.department_id, s.default_time, s.duration_min,
    CASE WHEN s.is_recurring THEN 'daily' ELSE 'once' END,
    s.is_active
  FROM public.services s
  WHERE s.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  -- Migrate cleaning_assignments → task_assignments (date = today for open-ended)
  INSERT INTO public.task_assignments
    (org_id, template_id, area_id, user_id, task_date)
  SELECT
    a.org_id,
    (SELECT tt.id FROM public.task_templates tt
     JOIN public.task_areas ta ON ta.name = (SELECT name FROM public.task_areas WHERE id = ca.area_id)
     WHERE tt.org_id = a.org_id AND tt.name = ta.name LIMIT 1),
    ca.area_id,
    ca.profile_id,
    COALESCE(ca.assigned_from, CURRENT_DATE)
  FROM public.cleaning_assignments ca
  JOIN public.cleaning_areas a ON a.id = ca.area_id
  WHERE a.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate cleaning_logs → task_logs
  INSERT INTO public.task_logs
    (org_id, area_id, user_id, log_date, status, notes, marked_at)
  SELECT
    cl.org_id, cl.area_id, cl.profile_id, cl.log_date,
    CASE cl.status
      WHEN 'done'     THEN 'done'
      WHEN 'partial'  THEN 'partial'
      WHEN 'not_done' THEN 'missed'
      ELSE 'pending'
    END,
    cl.notes, cl.marked_at
  FROM public.cleaning_logs cl
  WHERE cl.org_id = v_org_id
  ON CONFLICT DO NOTHING;

  -- Migrate service_allocations → task_assignments + task_logs
  INSERT INTO public.task_assignments
    (id, org_id, template_id, user_id, assigned_by, task_date, task_time, notes)
  SELECT
    sa.id, sa.org_id, sa.service_id, sa.profile_id, sa.allocated_by,
    sa.service_date, sa.service_time, sa.notes
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.task_logs
    (org_id, assignment_id, template_id, user_id, log_date, status, notes, marked_at)
  SELECT
    sa.org_id, sa.id, sa.service_id, sa.profile_id, sa.service_date,
    CASE sa.status
      WHEN 'done'    THEN 'done'
      WHEN 'missed'  THEN 'missed'
      WHEN 'excused' THEN 'excused'
      ELSE 'pending'
    END,
    sa.notes, sa.updated_at
  FROM public.service_allocations sa
  WHERE sa.org_id = v_org_id AND sa.status IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Migrate service_preferences → task_preferences
  INSERT INTO public.task_preferences
    (user_id, template_id, period_start, preference)
  SELECT profile_id, service_id, week_start, preference
  FROM public.service_preferences
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.task_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_areas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_categories_select" ON public.task_categories;
CREATE POLICY "task_categories_select" ON public.task_categories
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_categories_write" ON public.task_categories;
CREATE POLICY "task_categories_write" ON public.task_categories
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_templates_select" ON public.task_templates;
CREATE POLICY "task_templates_select" ON public.task_templates
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND public.has_any_permission(ARRAY['tasks.view_own','tasks.view_all'])
  );

DROP POLICY IF EXISTS "task_templates_write" ON public.task_templates;
CREATE POLICY "task_templates_write" ON public.task_templates
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_areas_select" ON public.task_areas;
CREATE POLICY "task_areas_select" ON public.task_areas
  FOR SELECT USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "task_areas_write" ON public.task_areas;
CREATE POLICY "task_areas_write" ON public.task_areas
  FOR ALL USING (org_id = public.current_org_id() AND public.has_permission('tasks.manage'));

DROP POLICY IF EXISTS "task_assignments_select" ON public.task_assignments;
CREATE POLICY "task_assignments_select" ON public.task_assignments
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_assignments_write" ON public.task_assignments;
CREATE POLICY "task_assignments_write" ON public.task_assignments
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_select" ON public.task_logs;
CREATE POLICY "task_logs_select" ON public.task_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_permission('tasks.view_all'))
  );

DROP POLICY IF EXISTS "task_logs_insert" ON public.task_logs;
CREATE POLICY "task_logs_insert" ON public.task_logs
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.assign','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_logs_update" ON public.task_logs;
CREATE POLICY "task_logs_update" ON public.task_logs
  FOR UPDATE USING (
    org_id = public.current_org_id()
    AND (user_id = auth.uid() OR public.has_any_permission(ARRAY['tasks.verify','tasks.manage']))
  );

DROP POLICY IF EXISTS "task_preferences_all" ON public.task_preferences;
CREATE POLICY "task_preferences_all" ON public.task_preferences
  FOR ALL USING (
    user_id = auth.uid() OR public.has_permission('tasks.assign')
  );

-- ---------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_task_templates_updated_at ON public.task_templates;
CREATE TRIGGER trg_task_templates_updated_at
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_task_assignments_updated_at ON public.task_assignments;
CREATE TRIGGER trg_task_assignments_updated_at
  BEFORE UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
