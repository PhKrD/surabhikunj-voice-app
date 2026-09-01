-- =====================================================================
-- 65_fix_announcement_notify_trigger.sql — Fix a live-breaking bug:
--   every announcement INSERT currently fails.
--
-- ADDITIVE ONLY (CREATE OR REPLACE FUNCTION on an existing function; no
-- table dropped, no data lost).
--
-- BUG (found while live-testing the Announcements module during a
-- production audit): the trigger trg_notify_announcement on
-- public.announcements calls notify_voice_on_announcement()
-- (11_notifications_triggers.sql), which was written for the ORIGINAL
-- schema — public.announcements.voice_id and public.notifications.voice_id.
-- Both tables were renamed to org_id years ago (organizations replaced
-- voices), but this one trigger function was never updated. Every
-- INSERT into public.announcements has been failing with:
--   ERROR: column "voice_id" of relation "notifications" does not exist
-- ...since that rename, which means the "New Announcement" button in
-- AnnouncementsPage.jsx has been completely broken in production this
-- whole time — confirmed by a live insert attempt during this audit.
--
-- FIX: rewrite the function to use org_id, and route through the modern
-- notify_many() backbone (40_notification_backbone.sql) instead of a raw
-- INSERT into public.notifications, so announcement notifications get
-- the same preference/quiet-hours/push handling as every other
-- notification category — using the already-seeded 'announcement.new'
-- category (see 40_notification_backbone.sql:79).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.notify_voice_on_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipients UUID[];
BEGIN
  SELECT array_agg(p.id) INTO v_recipients
  FROM public.profiles p
  WHERE p.org_id = NEW.org_id
    AND p.is_active = true
    AND (NEW.created_by IS NULL OR p.id <> NEW.created_by);

  IF v_recipients IS NOT NULL AND array_length(v_recipients, 1) > 0 THEN
    PERFORM public.notify_many(
      v_recipients,
      'announcement.new',
      'Announcement: ' || NEW.title,
      NEW.body,
      NEW.id,
      NULL,
      NEW.org_id
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_voice_on_announcement() IS
  'Fires on announcements INSERT. Rewritten in 65_ to use org_id (not the long-retired voice_id) and to route through notify_many() so recipients preferences/push/quiet-hours are respected.';
