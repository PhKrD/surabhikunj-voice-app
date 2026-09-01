-- =====================================================================
-- 62_counsellor_scope_fix.sql — Revoke org-wide view_all from the
--                                 seeded "counsellor" role.
--
-- ADDITIVE ONLY (a DELETE of over-broad grants, not a schema change). No
-- table is dropped, no existing RLS policy is replaced.
--
-- BUG (found in production audit):
--   22_rbac.sql originally seeded the 'counsellor' role with
--   'trackers.view_all' and 'tasks.view_all'. Migration 51 later added
--   public.is_active_mentor_of() scoping to tracker_entries /
--   tracker_field_values / task_assignments / task_logs RLS policies so a
--   counsellor should only see their ASSIGNED mentees' data — but every
--   one of those policies is an OR-clause:
--     user_id = auth.uid() OR has_permission('trackers.view_all') OR is_active_mentor_of(user_id)
--   Because every counsellor already held 'trackers.view_all'/'tasks.view_all'
--   from 22_rbac.sql, the mentor-scoping check was never the deciding
--   factor — any counsellor could read every member's Sadhana/task data
--   org-wide, not just their assigned counsellees. This is a live data
--   exposure bug, not theoretical: src/lib/counsellorApi.js actively
--   calls ensure_counsellor_role() from the Counsellor Management UI to
--   grant this exact role.
--
-- FIX:
--   1. 22_rbac.sql (source) no longer grants trackers.view_all/tasks.view_all
--      to new orgs going forward (see that file's diff).
--   2. This migration revokes the two over-broad grants from every
--      existing 'counsellor' role row, in every org, without touching any
--      other permission the role holds (members.view, mentorship.view_own,
--      trackers.view_own, trackers.submit, tasks.view_own, etc. all stay).
--
--   After this runs, a counsellor's visibility into trackers/tasks for
--   anyone other than themselves is governed solely by
--   public.is_active_mentor_of() (an active row in
--   mentorship_relationships with status = 'active'), exactly as intended
--   by 51_counsellor_management.sql.
-- =====================================================================

DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.key = 'counsellor'
  AND rp.permission_key IN ('trackers.view_all', 'tasks.view_all');
