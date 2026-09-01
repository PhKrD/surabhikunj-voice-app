-- =====================================================================
-- 64_child_requests_device_insert.sql — Missing device INSERT policy on
--                                         pc_child_requests.
--
-- ADDITIVE ONLY.
--
-- BUG (found in production audit): 60_phase3_4_5_schedules_rules_websites.sql
-- created pc_child_requests with only pc_child_requests_parent_all and
-- pc_child_requests_device_select. There was never a device-INSERT
-- policy, so src/lib/requestApi.js's createRequest() — actively called
-- from RequestPage.jsx, the child app's "ask for more time / an app /
-- a website" screen — has been failing with a 403 for every child on
-- every device since Phase 8 shipped. Fails closed (safe), but broken:
-- children could not actually submit requests through this screen.
--
-- FIX: allow a device to INSERT a request for its own child_id/device_id,
-- but only in the 'pending' state and only for itself — it can never
-- insert a request already approved/denied, attributed to a different
-- child, or issued from a device it doesn't own. Mirrors the existing,
-- working pc_bonus_time_requests_device_insert pattern.
-- =====================================================================

CREATE POLICY "pc_child_requests_device_insert"
  ON public.pc_child_requests FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.pc_devices d
      WHERE d.id = device_id
        AND d.auth_user_id = auth.uid()
        AND d.child_id = pc_child_requests.child_id
    )
  );
