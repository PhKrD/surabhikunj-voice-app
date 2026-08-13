-- =====================================================================
-- 41. IM SERVICES + CLEANLINESS — workflow, reminders, notifications
-- =====================================================================
-- Builds on the existing task_* engine (26_tasks.sql) rather than starting
-- over. That engine already models categories, templates, areas,
-- assignments, logs and preferences with RLS keyed on tasks.* permissions.
--
-- What this migration adds:
--   • an acceptance / completion / verification workflow on assignments
--   • a coordinator, priority, and ad-hoc (template-less) assignments
--   • module tagging so one engine drives two distinct nav modules:
--       'service'      -> IM Services   (/services)
--       'cleanliness'  -> Cleanliness   (/cleanliness)
--   • automatic notifications via the 40_notification_backbone notify()
--     service: assigned / updated / cancelled / completed
--   • scheduled reminders at configurable lead times before the due time
--   • a recurrence generator to roll templates into dated assignments
--
-- The generic 'Tasks' nav module is retired in migration 42; the schema
-- stays because Services and Cleanliness both ride on it.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MODULE TAGGING + WORKFLOW COLUMNS
-- ---------------------------------------------------------------------

ALTER TABLE public.task_categories
  ADD COLUMN IF NOT EXISTS module_key TEXT NOT NULL DEFAULT 'service';

ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS module_key          TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS coordinator_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority             TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_acceptance  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reminder_lead_times  INTEGER[] NOT NULL DEFAULT '{1440,120,30}',
  ADD COLUMN IF NOT EXISTS recurrence_weekdays  INTEGER[];   -- 0=Sun..6=Sat for weekly

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS module_key          TEXT NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS title               TEXT,          -- ad-hoc assignments w/o a template
  ADD COLUMN IF NOT EXISTS instructions        TEXT,
  ADD COLUMN IF NOT EXISTS coordinator_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority            TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_acceptance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'assigned',
  ADD COLUMN IF NOT EXISTS accepted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_min        INTEGER;

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_status_check;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_status_check
  CHECK (status IN ('assigned', 'accepted', 'declined', 'in_progress', 'completed', 'verified', 'cancelled'));

ALTER TABLE public.task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_priority_check;
ALTER TABLE public.task_assignments
  ADD CONSTRAINT task_assignments_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_task_assignments_module
  ON public.task_assignments (org_id, module_key, task_date DESC);
CREATE INDEX IF NOT EXISTS idx_task_assignments_status
  ON public.task_assignments (user_id, status, task_date DESC);

-- ---------------------------------------------------------------------
-- 2. DUE-TIMESTAMP HELPER
-- ---------------------------------------------------------------------
-- Combines task_date + task_time (falling back to 09:00) into a single
-- timestamptz in the org's timezone, used for reminder scheduling.

CREATE OR REPLACE FUNCTION public.assignment_due_at(p_assignment public.task_assignments)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_tz   TEXT;
  v_time TIME;
BEGIN
  SELECT COALESCE(o.timezone, 'Asia/Kolkata') INTO v_tz
  FROM public.organizations o WHERE o.id = p_assignment.org_id;

  v_time := COALESCE(p_assignment.task_time, TIME '09:00');
  RETURN (p_assignment.task_date + v_time) AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata');
END;
$$;

-- ---------------------------------------------------------------------
-- 3. REMINDER SCHEDULING
-- ---------------------------------------------------------------------
-- (Re)builds the pending reminder rows for an assignment. Cancels any
-- previous pending reminders first so edits don't leave stale ones.

CREATE OR REPLACE FUNCTION public.schedule_service_reminders(p_assignment_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a         public.task_assignments;
  v_due     TIMESTAMPTZ;
  v_leads   INTEGER[];
  v_lead    INTEGER;
  v_at      TIMESTAMPTZ;
  v_cat     TEXT;
  v_title   TEXT;
  v_count   INTEGER := 0;
BEGIN
  SELECT * INTO a FROM public.task_assignments WHERE id = p_assignment_id;
  IF NOT FOUND OR a.status IN ('cancelled', 'completed', 'verified', 'declined') THEN
    RETURN 0;
  END IF;

  -- Drop existing pending reminders for this assignment
  UPDATE public.notification_schedule
  SET status = 'cancelled'
  WHERE reference_id = p_assignment_id
    AND status = 'pending'
    AND category_key = a.module_key || '.reminder';

  v_due := public.assignment_due_at(a);
  IF v_due IS NULL THEN RETURN 0; END IF;

  -- Lead times: template's, else a sensible default
  SELECT COALESCE(t.reminder_lead_times, ARRAY[1440, 120, 30])
  INTO v_leads
  FROM public.task_templates t WHERE t.id = a.template_id;
  IF v_leads IS NULL THEN v_leads := ARRAY[1440, 120, 30]; END IF;

  v_cat   := a.module_key || '.reminder';
  v_title := COALESCE(a.title,
             (SELECT name FROM public.task_templates WHERE id = a.template_id),
             CASE WHEN a.module_key = 'cleanliness' THEN 'Cleaning duty reminder' ELSE 'Service reminder' END);

  FOREACH v_lead IN ARRAY v_leads LOOP
    v_at := v_due - make_interval(mins => v_lead);
    IF v_at > NOW() THEN
      INSERT INTO public.notification_schedule
        (org_id, profile_id, category_key, title, body, reference_id, action_url, send_at)
      VALUES (
        a.org_id, a.user_id, v_cat, v_title,
        'Starts ' || to_char(v_due, 'DD Mon HH24:MI'),
        a.id, '/' || a.module_key || 's/' || a.id, v_at
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_service_reminders(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. ASSIGNMENT NOTIFICATION TRIGGERS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.task_assignment_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title TEXT;
  v_url   TEXT;
BEGIN
  v_title := COALESCE(NEW.title,
             (SELECT name FROM public.task_templates WHERE id = NEW.template_id),
             CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty' ELSE 'Service' END);
  v_url := '/' || NEW.module_key || 's/' || NEW.id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify(
      NEW.user_id, NEW.module_key || '.assigned',
      CASE WHEN NEW.module_key = 'cleanliness' THEN 'New cleaning duty' ELSE 'New service assigned' END,
      v_title || COALESCE(' — ' || to_char(NEW.task_date, 'DD Mon') ||
        COALESCE(' ' || to_char(NEW.task_time, 'HH24:MI'), ''), ''),
      NEW.id, v_url, NEW.org_id
    );
    PERFORM public.schedule_service_reminders(NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Cancellation
    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
      PERFORM public.notify(
        NEW.user_id, NEW.module_key || '.cancelled',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty cancelled' ELSE 'Service cancelled' END,
        v_title, NEW.id, v_url, NEW.org_id
      );
      PERFORM public.cancel_scheduled_notifications(NEW.id, NEW.module_key || '.reminder');
      RETURN NEW;
    END IF;

    -- Completion -> tell the coordinator
    IF NEW.status IN ('completed', 'verified')
       AND OLD.status NOT IN ('completed', 'verified')
       AND NEW.coordinator_id IS NOT NULL THEN
      PERFORM public.notify(
        NEW.coordinator_id, NEW.module_key || '.completed',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty completed' ELSE 'Service completed' END,
        v_title, NEW.id, v_url, NEW.org_id
      );
    END IF;

    -- Reschedule / retime -> notify the assignee and rebuild reminders
    IF (NEW.task_date IS DISTINCT FROM OLD.task_date
        OR NEW.task_time IS DISTINCT FROM OLD.task_time
        OR NEW.user_id   IS DISTINCT FROM OLD.user_id)
       AND NEW.status NOT IN ('cancelled', 'completed', 'verified') THEN
      PERFORM public.notify(
        NEW.user_id, NEW.module_key || '.updated',
        CASE WHEN NEW.module_key = 'cleanliness' THEN 'Cleaning duty updated' ELSE 'Service updated' END,
        v_title || COALESCE(' — ' || to_char(NEW.task_date, 'DD Mon') ||
          COALESCE(' ' || to_char(NEW.task_time, 'HH24:MI'), ''), ''),
        NEW.id, v_url, NEW.org_id
      );
      PERFORM public.schedule_service_reminders(NEW.id);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_assignment_notify ON public.task_assignments;
CREATE TRIGGER trg_task_assignment_notify
  AFTER INSERT OR UPDATE ON public.task_assignments
  FOR EACH ROW EXECUTE FUNCTION public.task_assignment_notify();

-- ---------------------------------------------------------------------
-- 5. WORKFLOW RPCs (assignee actions)
-- ---------------------------------------------------------------------
-- These enforce that only the assignee can accept/decline/complete their
-- own assignment, on top of the RLS already on the table.

CREATE OR REPLACE FUNCTION public.respond_to_assignment(
  p_assignment_id UUID,
  p_action        TEXT      -- 'accept' | 'decline' | 'complete' | 'start'
)
RETURNS public.task_assignments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.task_assignments;
BEGIN
  SELECT * INTO a FROM public.task_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF a.user_id <> auth.uid() AND NOT public.has_any_permission(ARRAY['tasks.assign','tasks.manage','tasks.verify']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF p_action = 'accept' THEN
    UPDATE public.task_assignments
    SET status = 'accepted', accepted_at = NOW(), declined_at = NULL
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'decline' THEN
    UPDATE public.task_assignments
    SET status = 'declined', declined_at = NOW()
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'start' THEN
    UPDATE public.task_assignments
    SET status = 'in_progress'
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSIF p_action = 'complete' THEN
    UPDATE public.task_assignments
    SET status = 'completed', completed_at = NOW()
    WHERE id = p_assignment_id RETURNING * INTO a;
  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action;
  END IF;

  RETURN a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.respond_to_assignment(UUID, TEXT) TO authenticated;

-- Coordinator verification (cleanliness / any service needing sign-off)
CREATE OR REPLACE FUNCTION public.verify_assignment(
  p_assignment_id UUID,
  p_approve       BOOLEAN DEFAULT TRUE
)
RETURNS public.task_assignments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.task_assignments;
BEGIN
  IF NOT public.has_any_permission(ARRAY['tasks.verify','tasks.manage']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  UPDATE public.task_assignments
  SET status      = CASE WHEN p_approve THEN 'verified' ELSE 'in_progress' END,
      verified_by = CASE WHEN p_approve THEN auth.uid() ELSE NULL END,
      verified_at = CASE WHEN p_approve THEN NOW() ELSE NULL END
  WHERE id = p_assignment_id
  RETURNING * INTO a;

  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  RETURN a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_assignment(UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. RECURRENCE GENERATOR
-- ---------------------------------------------------------------------
-- Rolls an active template forward into dated assignments for one member.
-- Managers call this from the UI ("schedule recurring"). Idempotent per
-- (template, area, user, date) thanks to the existing UNIQUE constraint.

CREATE OR REPLACE FUNCTION public.generate_assignments_from_template(
  p_template_id UUID,
  p_user_id     UUID,
  p_from        DATE,
  p_to          DATE,
  p_area_id     UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t        public.task_templates;
  d        DATE;
  v_count  INTEGER := 0;
  v_dow    INTEGER;
BEGIN
  SELECT * INTO t FROM public.task_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;

  IF NOT public.has_any_permission(ARRAY['tasks.assign','tasks.manage']) THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Range too large (max 1 year)';
  END IF;

  d := p_from;
  WHILE d <= p_to LOOP
    v_dow := EXTRACT(DOW FROM d)::INTEGER;  -- 0=Sun..6=Sat

    IF t.recurrence = 'daily'
       OR (t.recurrence = 'weekly' AND (t.recurrence_weekdays IS NULL OR v_dow = ANY(t.recurrence_weekdays)))
       OR (t.recurrence = 'monthly' AND EXTRACT(DAY FROM d) = EXTRACT(DAY FROM p_from))
       OR (t.recurrence IN ('once','custom') AND d = p_from)
    THEN
      INSERT INTO public.task_assignments
        (org_id, template_id, area_id, user_id, assigned_by, task_date, task_time,
         module_key, coordinator_id, priority, requires_acceptance, duration_min, instructions)
      VALUES
        (t.org_id, t.id, p_area_id, p_user_id, auth.uid(), d, t.default_time,
         t.module_key, t.coordinator_id, t.priority, t.requires_acceptance, t.duration_min, t.instructions)
      ON CONFLICT (template_id, area_id, user_id, task_date) DO NOTHING;

      IF FOUND THEN v_count := v_count + 1; END IF;
    END IF;

    d := d + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_assignments_from_template(UUID, UUID, DATE, DATE, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. READ MODEL for the UI (assignments joined to names)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_assignments(
  p_module TEXT DEFAULT 'service',
  p_scope  TEXT DEFAULT 'mine'      -- 'mine' | 'all' (all requires tasks.view_all)
)
RETURNS TABLE (
  id            UUID,
  module_key    TEXT,
  title         TEXT,
  instructions  TEXT,
  task_date     DATE,
  task_time     TIME,
  status        TEXT,
  priority      TEXT,
  requires_acceptance BOOLEAN,
  area_name     TEXT,
  user_id       UUID,
  assignee_name TEXT,
  assignee_avatar TEXT,
  coordinator_id   UUID,
  coordinator_name TEXT,
  coordinator_phone TEXT,
  verified_at   TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.module_key,
    COALESCE(a.title, t.name) AS title,
    COALESCE(a.instructions, t.instructions) AS instructions,
    a.task_date, a.task_time, a.status, a.priority, a.requires_acceptance,
    ar.name AS area_name,
    a.user_id,
    COALESCE(pu.display_name, pu.spiritual_name, pu.legal_name, pu.email) AS assignee_name,
    pu.avatar_url AS assignee_avatar,
    a.coordinator_id,
    COALESCE(pc.display_name, pc.spiritual_name, pc.legal_name) AS coordinator_name,
    pc.phone AS coordinator_phone,
    a.verified_at, a.completed_at
  FROM public.task_assignments a
  LEFT JOIN public.task_templates t ON t.id = a.template_id
  LEFT JOIN public.task_areas ar     ON ar.id = a.area_id
  LEFT JOIN public.profiles pu       ON pu.id = a.user_id
  LEFT JOIN public.profiles pc       ON pc.id = a.coordinator_id
  WHERE a.org_id = public.current_org_id()
    AND a.module_key = p_module
    AND a.status <> 'cancelled'
    AND (
      (p_scope = 'mine' AND a.user_id = auth.uid())
      OR (p_scope = 'all' AND public.has_permission('tasks.view_all'))
    )
  ORDER BY a.task_date DESC, a.task_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.my_assignments(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. SEED A DEFAULT CATEGORY PER MODULE FOR EVERY ORG
-- ---------------------------------------------------------------------

DO $do$
DECLARE o RECORD;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.task_categories (org_id, name, icon, color, module_key, sort_order)
    SELECT o.id, 'General Services', 'ListChecks', '#f97316', 'service', 10
    WHERE NOT EXISTS (
      SELECT 1 FROM public.task_categories
      WHERE org_id = o.id AND module_key = 'service'
    );

    INSERT INTO public.task_categories (org_id, name, icon, color, module_key, sort_order)
    SELECT o.id, 'Cleaning', 'Sparkles', '#16a34a', 'cleanliness', 10
    WHERE NOT EXISTS (
      SELECT 1 FROM public.task_categories
      WHERE org_id = o.id AND module_key = 'cleanliness'
    );
  END LOOP;
END $do$;

-- Tag any pre-existing Surabhikunj categories by name so their data lands
-- in the right module.
UPDATE public.task_categories SET module_key = 'cleanliness'
  WHERE lower(name) LIKE '%clean%';
UPDATE public.task_templates t SET module_key = 'cleanliness'
  FROM public.task_categories c
  WHERE t.category_id = c.id AND c.module_key = 'cleanliness';
UPDATE public.task_assignments a SET module_key = 'cleanliness'
  FROM public.task_templates t
  WHERE a.template_id = t.id AND t.module_key = 'cleanliness';

NOTIFY pgrst, 'reload schema';
