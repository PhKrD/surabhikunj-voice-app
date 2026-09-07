-- =====================================================================
-- 67. WEB ACTIVITY (Accessibility-Service-based browser monitoring)
-- =====================================================================
-- New table for Android VoiceKidsAccessibilityService (see
-- android/app/src/main/java/com/surabhikunj/voice/dpc/VoiceKidsAccessibilityService.kt).
--
-- IMPORTANT — read this before trusting the data:
--   This is a BEST-EFFORT signal, not a guaranteed complete log. It works
--   by reading the browser's address-bar text via Android's Accessibility
--   API, using known resource-id patterns per browser (Chrome, Samsung
--   Internet, Edge, Firefox). It requires the parent to manually enable
--   "VOICE" under Settings > Accessibility on the CHILD device (a
--   permission Android will not grant programmatically, by design — same
--   category of manual step as Usage Access). It only sees browsers it
--   recognizes; incognito/private tabs typically hide the same UI so
--   behavior there is browser-dependent and not guaranteed; a browser UI
--   update can change resource ids and silently stop this until the app
--   is updated. See PLATFORM_LIMITATIONS.md for the full writeup. Do not
--   present this as exhaustive "we see everything" monitoring in the UI.
--
-- Idempotent, additive only. Depends on 52_parental_control_schema.sql
-- (pc_children, pc_devices, pc_is_parent_of, pc_is_device_auth).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.pc_web_activity (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id        UUID NOT NULL REFERENCES public.pc_devices(id) ON DELETE CASCADE,
  child_id         UUID NOT NULL REFERENCES public.pc_children(id) ON DELETE CASCADE,
  browser_package  TEXT NOT NULL,
  activity_type    TEXT NOT NULL CHECK (activity_type IN ('visit', 'search')),
  domain           TEXT,
  search_engine    TEXT,
  search_query     TEXT,
  -- on-device timestamp (authoritative), mirrors pc_location_events.recorded_at
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pc_web_activity IS
  'Best-effort browser activity captured via AccessibilityService address-bar reading. Not exhaustive — see PLATFORM_LIMITATIONS.md.';

-- High-volume table, same shape/retention concern as pc_location_events —
-- recommend a scheduled job to DELETE rows older than 90 days.
CREATE INDEX IF NOT EXISTS idx_pc_web_activity_child_time
  ON public.pc_web_activity (child_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pc_web_activity_device_time
  ON public.pc_web_activity (device_id, occurred_at DESC);

ALTER TABLE public.pc_web_activity ENABLE ROW LEVEL SECURITY;

-- Parent: read only (cannot tamper with the child's activity log), same
-- pattern as pc_location_events.
DROP POLICY IF EXISTS "pc_web_activity_parent_select" ON public.pc_web_activity;
CREATE POLICY "pc_web_activity_parent_select"
  ON public.pc_web_activity FOR SELECT
  USING (public.pc_is_parent_of(child_id));

-- Child device: insert only, and only for itself.
DROP POLICY IF EXISTS "pc_web_activity_device_insert" ON public.pc_web_activity;
CREATE POLICY "pc_web_activity_device_insert"
  ON public.pc_web_activity FOR INSERT
  WITH CHECK (public.pc_is_device_auth(device_id));

-- Realtime, so a "Web Activity" tab can show a live feed like Alerts does.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.pc_web_activity;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
