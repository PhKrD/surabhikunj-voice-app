-- =====================================================================
-- 43. BROADEN notifications SELECT: self + org admins
-- =====================================================================
-- Two problems with the 29_contract_phase policy
--   USING (profile_id = auth.uid() AND org_id = current_org_id()):
--   1. Legacy/rows with org_id IS NULL become invisible even to their own
--      owner, so the Notification Center could silently hide items.
--   2. The admin Broadcast > Delivery dashboard needs org-wide read to show
--      delivery + read stats, which this policy forbids.
--
-- This restores "always see your own" and adds an org-scoped admin read for
-- users holding announcements.manage / members.manage — matching the
-- notification_deliveries / notification_schedule policies from migration 40.
--
-- Idempotent.
-- =====================================================================

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (
    profile_id = auth.uid()
    OR (
      org_id = public.current_org_id()
      AND public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
    )
  );

NOTIFY pgrst, 'reload schema';
