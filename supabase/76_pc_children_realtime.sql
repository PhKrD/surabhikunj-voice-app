-- =====================================================================
-- 76. LIVE CHILD STATE FOR THE PARENT DASHBOARD
-- =====================================================================
-- pc_children holds the parent's desired state (parent_lock_active,
-- internet_pause_active, bonus_expires_at — migration 72). Publishing it
-- lets a second parent / second open tab see "Locked" the moment the other
-- one taps it (subscribeToChildState() in src/lib/parentalControlApi.js).
-- Realtime still applies RLS, so a parent only receives their own rows.
--
-- Optional: without it the child page falls back to a 30-second refresh.
-- Idempotent: safe to re-run.
-- =====================================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pc_children;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END
$$;
