-- =====================================================================
-- 51. COUNSELLOR MANAGEMENT
-- =====================================================================
-- Builds the full Counsellor <-> Counselli supervision system on TOP of
-- the existing generic primitives — no duplicate schema, no duplicate
-- calculation engines:
--
--   mentorship_types / mentorship_relationships (28_mentorship.sql)
--     -> already the CounsellorAssignment model (typed, versioned,
--        exclusive-by-default, assigned_by, started_at/ended_at).
--   RBAC roles/permissions (22_rbac.sql)
--     -> already has mentorship.view_own / view_all / manage.
--   tracker_entries + trackerScoring.js (25/49/50, src/lib/trackerScoring.js)
--     -> the single source of truth for Sadhana. Not touched here.
--   task_assignments / task_logs (26/41)
--     -> the single source of truth for Cleanliness + Seva/Service.
--
-- What this migration ADDS:
--   1. public.is_active_mentor_of(mentee_id) — the one helper that all
--      "counsellor can see this member's data" RLS checks call. This is
--      the backend enforcement the spec requires (never a frontend-only
--      filter).
--   2. RLS extensions on tracker_entries / tracker_field_values /
--      task_assignments / task_logs so an active counsellor of a member
--      can SELECT (never write) that member's existing reports.
--   3. mentorship_notes, mentorship_followups — private counsellor notes
--      and follow-up action items (view only, cannot touch scores).
--   4. mentorship_audit_log — assignment/transfer/role audit trail.
--   5. Admin RPCs: ensure_counsellor_role, add_member_role,
--      remove_member_role, admin_mentorship_overview, assign_mentee,
--      end_mentorship, mentee_assignment_history, admin_mentee_search.
--   6. Notification categories + trigger for assignment/transfer.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CORE AUTHORIZATION HELPER
-- ---------------------------------------------------------------------
-- The single choke point every "counsellor view" RLS policy calls.
-- A counsellor may see a member's data ONLY while an ACTIVE mentorship
-- relationship exists between them in the caller's current org.

CREATE OR REPLACE FUNCTION public.is_active_mentor_of(p_mentee_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mentorship_relationships mr
    WHERE mr.mentor_id = auth.uid()
      AND mr.mentee_id = p_mentee_id
      AND mr.status    = 'active'
      AND mr.org_id     = public.current_org_id()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_mentor_of(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. RLS EXTENSIONS — counsellor read access to existing reports
-- ---------------------------------------------------------------------
-- Sadhana (tracker_entries / tracker_field_values). View-only: the write
-- policies are untouched, so a counsellor can never edit/delete a
-- counselli's entries.

DROP POLICY IF EXISTS "tracker_entries_select" ON public.tracker_entries;
CREATE POLICY "tracker_entries_select" ON public.tracker_entries
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('trackers.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

DROP POLICY IF EXISTS "tracker_fv_select" ON public.tracker_field_values;
CREATE POLICY "tracker_fv_select" ON public.tracker_field_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tracker_entries te
      WHERE te.id = entry_id
        AND te.org_id = public.current_org_id()
        AND (
          te.user_id = auth.uid()
          OR public.has_permission('trackers.view_all')
          OR public.is_active_mentor_of(te.user_id)
        )
    )
  );

-- Cleanliness + Seva/Service (task_assignments / task_logs).
DROP POLICY IF EXISTS "task_assignments_select" ON public.task_assignments;
CREATE POLICY "task_assignments_select" ON public.task_assignments
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('tasks.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

DROP POLICY IF EXISTS "task_logs_select" ON public.task_logs;
CREATE POLICY "task_logs_select" ON public.task_logs
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      user_id = auth.uid()
      OR public.has_permission('tasks.view_all')
      OR public.is_active_mentor_of(user_id)
    )
  );

-- Extend the existing my_assignments() RPC with an explicit 'mentee' scope
-- so the Counselli Profile screen can request one specific member's
-- Cleanliness/Seva history without needing tasks.view_all.
CREATE OR REPLACE FUNCTION public.my_assignments(
  p_module  TEXT DEFAULT 'service',
  p_scope   TEXT DEFAULT 'mine',      -- 'mine' | 'all' | 'mentee'
  p_user_id UUID DEFAULT NULL         -- required when p_scope = 'mentee'
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
  completed_at  TIMESTAMPTZ,
  duration_min  INTEGER
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
    a.verified_at, a.completed_at, a.duration_min
  FROM public.task_assignments a
  LEFT JOIN public.task_templates t ON t.id = a.template_id
  LEFT JOIN public.task_areas ar     ON ar.id = a.area_id
  LEFT JOIN public.profiles pu       ON pu.id = a.user_id
  LEFT JOIN public.profiles pc       ON pc.id = a.coordinator_id
  WHERE a.org_id = public.current_org_id()
    AND a.module_key = p_module
    AND a.status <> 'cancelled'
    AND (
      (p_scope = 'mine'   AND a.user_id = auth.uid())
      OR (p_scope = 'all'    AND public.has_permission('tasks.view_all'))
      OR (p_scope = 'mentee' AND p_user_id IS NOT NULL AND a.user_id = p_user_id
          AND (public.has_permission('tasks.view_all') OR public.is_active_mentor_of(p_user_id)))
    )
  ORDER BY a.task_date DESC, a.task_time NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.my_assignments(TEXT, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. COUNSELLOR NOTES (private, view-only w.r.t. Sadhana data)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_notes_mentee
  ON public.mentorship_notes (mentee_id, created_at DESC);

ALTER TABLE public.mentorship_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_notes_select" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_select" ON public.mentorship_notes
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (
      public.is_active_mentor_of(mentee_id)
      OR public.has_permission('mentorship.manage')
      OR author_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "mentorship_notes_insert" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_insert" ON public.mentorship_notes
  FOR INSERT WITH CHECK (
    org_id = public.current_org_id()
    AND author_id = auth.uid()
    AND (public.is_active_mentor_of(mentee_id) OR public.has_permission('mentorship.manage'))
  );

DROP POLICY IF EXISTS "mentorship_notes_update" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_update" ON public.mentorship_notes
  FOR UPDATE USING (author_id = auth.uid() OR public.has_permission('mentorship.manage'));

DROP POLICY IF EXISTS "mentorship_notes_delete" ON public.mentorship_notes;
CREATE POLICY "mentorship_notes_delete" ON public.mentorship_notes
  FOR DELETE USING (author_id = auth.uid() OR public.has_permission('mentorship.manage'));

DROP TRIGGER IF EXISTS trg_mentorship_notes_updated_at ON public.mentorship_notes;
CREATE TRIGGER trg_mentorship_notes_updated_at
  BEFORE UPDATE ON public.mentorship_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 4. FOLLOW-UP / ACTION ITEMS
-- ---------------------------------------------------------------------
-- Deliberately separate from tracker_entries — a counsellor can never
-- touch a Sadhana score through this table.

CREATE TABLE IF NOT EXISTS public.mentorship_followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mentee_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  due_date    DATE,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mentorship_followups
  DROP CONSTRAINT IF EXISTS mentorship_followups_status_check;
ALTER TABLE public.mentorship_followups
  ADD CONSTRAINT mentorship_followups_status_check
  CHECK (status IN ('pending', 'completed'));

CREATE INDEX IF NOT EXISTS idx_mentorship_followups_mentee
  ON public.mentorship_followups (mentee_id, status, due_date);

ALTER TABLE public.mentorship_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_followups_select" ON public.mentorship_followups;
CREATE POLICY "mentorship_followups_select" ON public.mentorship_followups
  FOR SELECT USING (
    org_id = public.current_org_id()
    AND (public.is_active_mentor_of(mentee_id) OR public.has_permission('mentorship.manage') OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "mentorship_followups_write" ON public.mentorship_followups;
CREATE POLICY "mentorship_followups_write" ON public.mentorship_followups
  FOR ALL USING (
    org_id = public.current_org_id()
    AND (created_by = auth.uid() OR public.has_permission('mentorship.manage'))
  );

DROP TRIGGER IF EXISTS trg_mentorship_followups_updated_at ON public.mentorship_followups;
CREATE TRIGGER trg_mentorship_followups_updated_at
  BEFORE UPDATE ON public.mentorship_followups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ---------------------------------------------------------------------
-- 5. AUDIT LOG
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mentorship_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,          -- 'assigned' | 'transferred' | 'ended' | 'role_granted' | 'role_revoked'
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  mentee_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  relationship_id UUID REFERENCES public.mentorship_relationships(id) ON DELETE SET NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentorship_audit_org
  ON public.mentorship_audit_log (org_id, created_at DESC);

ALTER TABLE public.mentorship_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentorship_audit_select" ON public.mentorship_audit_log;
CREATE POLICY "mentorship_audit_select" ON public.mentorship_audit_log
  FOR SELECT USING (
    org_id = public.current_org_id() AND public.has_permission('mentorship.manage')
  );

-- No INSERT/UPDATE/DELETE policy: only written by SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------
-- 6. ROLE MANAGEMENT — additive grant/revoke (keeps other roles intact)
-- ---------------------------------------------------------------------
-- set_member_role() (32_fix_member_management.sql) REPLACES all of a
-- member's roles with one. That is wrong for "Member + Counsellor"
-- (a counsellor must keep their normal member role). These are the
-- additive equivalents.

CREATE OR REPLACE FUNCTION public.add_member_role(p_user_id UUID, p_role_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_membership UUID;
BEGIN
  IF NOT public.has_permission('roles.assign') THEN
    RAISE EXCEPTION 'You do not have permission to assign roles';
  END IF;

  SELECT id INTO v_membership FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;
  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id = p_role_id AND org_id = v_org_id) THEN
    RAISE EXCEPTION 'That role does not belong to this organization';
  END IF;

  INSERT INTO public.membership_roles (membership_id, role_id, assigned_by)
  VALUES (v_membership, p_role_id, auth.uid())
  ON CONFLICT (membership_id, role_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_member_role(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member_role(p_user_id UUID, p_role_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_membership UUID;
BEGIN
  IF NOT public.has_permission('roles.assign') THEN
    RAISE EXCEPTION 'You do not have permission to assign roles';
  END IF;

  SELECT id INTO v_membership FROM public.memberships
  WHERE org_id = v_org_id AND user_id = p_user_id;
  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'That member does not belong to this organization';
  END IF;

  DELETE FROM public.membership_roles
  WHERE membership_id = v_membership AND role_id = p_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_member_role(UUID, UUID) TO authenticated;

-- Idempotently ensures the current org has a "Counsellor" role granting
-- mentorship.view_own (the permission that unlocks the Counsellor
-- Dashboard). Safe to call repeatedly; returns the role id.
CREATE OR REPLACE FUNCTION public.ensure_counsellor_role()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id  UUID := public.current_org_id();
  v_role_id UUID;
BEGIN
  IF NOT public.has_permission('roles.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage roles';
  END IF;

  SELECT id INTO v_role_id FROM public.roles WHERE org_id = v_org_id AND key = 'counsellor';

  IF v_role_id IS NULL THEN
    INSERT INTO public.roles (org_id, key, name, description, color, priority)
    VALUES (v_org_id, 'counsellor', 'Counsellor', 'Can view and support assigned counsellis', '#0891b2', 5)
    RETURNING id INTO v_role_id;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_key)
  VALUES (v_role_id, 'mentorship.view_own')
  ON CONFLICT DO NOTHING;

  RETURN v_role_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_counsellor_role() TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ADMIN RPCs — assignment management
-- ---------------------------------------------------------------------

-- Every counsellor (any mentor with >=1 active relationship OR the
-- 'counsellor' role) with their counselli counts, for the management table.
CREATE OR REPLACE FUNCTION public.admin_mentorship_overview(p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  mentor_id       UUID,
  mentor_name     TEXT,
  mentor_avatar   TEXT,
  mentor_phone    TEXT,
  is_active       BOOLEAN,
  active_mentees  BIGINT,
  assigned_since  TIMESTAMPTZ
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT
    p.id, COALESCE(p.display_name, p.spiritual_name, p.legal_name), p.avatar_url, p.phone,
    p.is_active,
    COUNT(mr.id) FILTER (WHERE mr.status = 'active'),
    MIN(mr.started_at)
  FROM public.mentorship_relationships mr
  JOIN public.profiles p ON p.id = mr.mentor_id
  WHERE mr.org_id = public.current_org_id()
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
    AND public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
  GROUP BY p.id, p.display_name, p.spiritual_name, p.legal_name, p.avatar_url, p.phone, p.is_active
  ORDER BY COALESCE(p.display_name, p.spiritual_name, p.legal_name);
$$;

GRANT EXECUTE ON FUNCTION public.admin_mentorship_overview(UUID) TO authenticated;

-- All relationships for one mentor (current + ended), for "Manage Counsellis".
CREATE OR REPLACE FUNCTION public.mentor_relationships(p_mentor_id UUID, p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  id           UUID,
  mentee_id    UUID,
  mentee_name  TEXT,
  mentee_avatar TEXT,
  status       TEXT,
  started_at   TIMESTAMPTZ,
  ended_at     TIMESTAMPTZ,
  notes        TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.id, mr.mentee_id,
         COALESCE(p.display_name, p.spiritual_name, p.legal_name), p.avatar_url,
         mr.status, mr.started_at, mr.ended_at, mr.notes
  FROM public.mentorship_relationships mr
  JOIN public.profiles p ON p.id = mr.mentee_id
  WHERE mr.org_id = public.current_org_id()
    AND mr.mentor_id = p_mentor_id
    AND (p_type_id IS NULL OR mr.type_id = p_type_id)
    AND (p_mentor_id = auth.uid() OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage']))
  ORDER BY (mr.status = 'active') DESC, mr.started_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.mentor_relationships(UUID, UUID) TO authenticated;

-- Member search for the "assign counselli" picker — reuses org_members(),
-- adds each candidate's current mentor (if any) so the UI can warn before
-- creating a conflicting assignment.
CREATE OR REPLACE FUNCTION public.admin_mentee_search(p_query TEXT DEFAULT '', p_type_id UUID DEFAULT NULL)
RETURNS TABLE (
  id                UUID,
  display_name      TEXT,
  avatar_url        TEXT,
  email             TEXT,
  current_mentor_id UUID,
  current_mentor_name TEXT
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_type_id UUID := p_type_id;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  IF v_type_id IS NULL THEN
    SELECT mt.id INTO v_type_id FROM public.mentorship_types mt
    WHERE mt.org_id = public.current_org_id() AND mt.name = 'Counsellor' LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT om.id, om.display_name, om.avatar_url, om.email,
         mr.mentor_id, COALESCE(pm.display_name, pm.spiritual_name, pm.legal_name)
  FROM public.org_members() om
  LEFT JOIN public.mentorship_relationships mr
    ON mr.mentee_id = om.id AND mr.type_id = v_type_id AND mr.status = 'active'
  LEFT JOIN public.profiles pm ON pm.id = mr.mentor_id
  WHERE p_query = '' OR om.display_name ILIKE '%' || p_query || '%'
     OR om.spiritual_name ILIKE '%' || p_query || '%'
     OR om.legal_name ILIKE '%' || p_query || '%'
     OR om.email ILIKE '%' || p_query || '%'
  ORDER BY om.display_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_mentee_search(TEXT, UUID) TO authenticated;

-- Assign (or transfer) a counselli to a counsellor. If the mentee already
-- has an active relationship of the same type, it is ended (preserving
-- history) and the new one created — a "transfer", never a silent
-- duplicate. Enforces mentorship_types.max_mentees.
CREATE OR REPLACE FUNCTION public.assign_mentee(
  p_mentee_id UUID,
  p_mentor_id UUID,
  p_type_id   UUID DEFAULT NULL,
  p_notes     TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     UUID := public.current_org_id();
  v_type_id    UUID := p_type_id;
  v_max        INTEGER;
  v_current    INTEGER;
  v_old        RECORD;
  v_new_id     UUID;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  IF p_mentee_id = p_mentor_id THEN
    RAISE EXCEPTION 'A member cannot be their own counsellor';
  END IF;

  IF v_type_id IS NULL THEN
    SELECT id INTO v_type_id FROM public.mentorship_types
    WHERE org_id = v_org_id AND name = 'Counsellor' LIMIT 1;
  END IF;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'No mentorship type configured for this organization';
  END IF;

  SELECT max_mentees INTO v_max FROM public.mentorship_types WHERE id = v_type_id;
  IF v_max IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current FROM public.mentorship_relationships
    WHERE mentor_id = p_mentor_id AND type_id = v_type_id AND status = 'active';
    IF v_current >= v_max THEN
      RAISE EXCEPTION 'This counsellor already has the maximum number of counsellis (%)', v_max;
    END IF;
  END IF;

  -- End any existing active relationship of this type for the mentee (transfer)
  SELECT * INTO v_old FROM public.mentorship_relationships
  WHERE mentee_id = p_mentee_id AND type_id = v_type_id AND status = 'active';

  IF FOUND THEN
    IF v_old.mentor_id = p_mentor_id THEN
      -- Already assigned to this exact counsellor; nothing to do.
      RETURN v_old.id;
    END IF;
    UPDATE public.mentorship_relationships
    SET status = 'ended', ended_at = NOW(), updated_at = NOW()
    WHERE id = v_old.id;

    INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
    VALUES (v_org_id, 'transferred', auth.uid(), p_mentor_id, p_mentee_id, v_old.id,
            jsonb_build_object('from_mentor_id', v_old.mentor_id, 'to_mentor_id', p_mentor_id));
  END IF;

  INSERT INTO public.mentorship_relationships (org_id, type_id, mentor_id, mentee_id, assigned_by, notes)
  VALUES (v_org_id, v_type_id, p_mentor_id, p_mentee_id, auth.uid(), p_notes)
  RETURNING id INTO v_new_id;

  INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
  VALUES (v_org_id, 'assigned', auth.uid(), p_mentor_id, p_mentee_id, v_new_id, '{}'::jsonb);

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_mentee(UUID, UUID, UUID, TEXT) TO authenticated;

-- End a relationship (unassign) without creating a replacement.
CREATE OR REPLACE FUNCTION public.end_mentorship(p_relationship_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rel RECORD;
BEGIN
  IF NOT public.has_permission('mentorship.manage') THEN
    RAISE EXCEPTION 'You do not have permission to manage mentorship assignments';
  END IF;

  SELECT * INTO v_rel FROM public.mentorship_relationships
  WHERE id = p_relationship_id AND org_id = public.current_org_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Relationship not found';
  END IF;

  UPDATE public.mentorship_relationships
  SET status = 'ended', ended_at = NOW(), updated_at = NOW()
  WHERE id = p_relationship_id;

  INSERT INTO public.mentorship_audit_log (org_id, action, actor_id, mentor_id, mentee_id, relationship_id, detail)
  VALUES (v_rel.org_id, 'ended', auth.uid(), v_rel.mentor_id, v_rel.mentee_id, v_rel.id, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_mentorship(UUID) TO authenticated;

-- Full assignment history for one mentee (current + all past counsellors).
CREATE OR REPLACE FUNCTION public.mentee_assignment_history(p_mentee_id UUID)
RETURNS TABLE (
  id          UUID,
  mentor_id   UUID,
  mentor_name TEXT,
  status      TEXT,
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  assigned_by_name TEXT
)
LANGUAGE SQL SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT mr.id, mr.mentor_id, COALESCE(pm.display_name, pm.spiritual_name, pm.legal_name),
         mr.status, mr.started_at, mr.ended_at,
         COALESCE(pa.display_name, pa.spiritual_name, pa.legal_name)
  FROM public.mentorship_relationships mr
  JOIN public.profiles pm ON pm.id = mr.mentor_id
  LEFT JOIN public.profiles pa ON pa.id = mr.assigned_by
  WHERE mr.org_id = public.current_org_id()
    AND mr.mentee_id = p_mentee_id
    AND (
      mr.mentee_id = auth.uid()
      OR public.is_active_mentor_of(p_mentee_id)
      OR public.has_any_permission(ARRAY['mentorship.view_all','mentorship.manage'])
    )
  ORDER BY mr.started_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.mentee_assignment_history(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. NOTIFICATIONS
-- ---------------------------------------------------------------------

INSERT INTO public.notification_categories
  (key, label, description, icon, group_key, user_can_disable, default_push, default_inapp, default_whatsapp, sort_order)
VALUES
  ('mentorship.assigned', 'Counsellor Assigned', 'You have been assigned a counsellor, or a new counselli', 'Users', 'mentorship', TRUE, TRUE, TRUE, FALSE, 130)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, icon = EXCLUDED.icon,
      group_key = EXCLUDED.group_key, sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.mentorship_relationship_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mentor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    SELECT COALESCE(display_name, spiritual_name, legal_name) INTO v_mentor_name
    FROM public.profiles WHERE id = NEW.mentor_id;

    PERFORM public.notify(
      NEW.mentee_id, 'mentorship.assigned',
      'You have a new counsellor',
      COALESCE(v_mentor_name, 'Your counsellor') || ' is now supporting your sadhana.',
      NEW.id, '/mentorship', NEW.org_id
    );
    PERFORM public.notify(
      NEW.mentor_id, 'mentorship.assigned',
      'New counselli assigned',
      'A new member has been assigned to you.',
      NEW.id, '/mentorship', NEW.org_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mentorship_relationship_notify ON public.mentorship_relationships;
CREATE TRIGGER trg_mentorship_relationship_notify
  AFTER INSERT ON public.mentorship_relationships
  FOR EACH ROW EXECUTE FUNCTION public.mentorship_relationship_notify();

NOTIFY pgrst, 'reload schema';
