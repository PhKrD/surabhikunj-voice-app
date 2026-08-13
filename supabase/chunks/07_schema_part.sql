-- CHUNK 7 (schema files)

-- FILE: 40_notification_backbone.sql
-- =====================================================================
-- 40. NOTIFICATION BACKBONE — platform-wide notification service
-- =====================================================================
-- The existing setup (19_push_notifications.sql) can already deliver a
-- push once a row lands in `notifications`. What it CANNOT do:
--   • respect per-user preferences (everyone gets everything)
--   • categorise notifications (one flat `type` text column)
--   • honour quiet hours
--   • schedule anything (no reminders, no recurrence)
--   • record whether delivery actually succeeded
--
-- This migration adds those five things as a reusable service. Any future
-- module (donations, attendance, library, ...) registers its event types
-- here and gets scheduling, preferences and multi-channel delivery for
-- free — no new plumbing required.
--
-- Design:
--   notification_categories   catalogue of what CAN be sent
--   notification_preferences  per-user opt in/out + channel + timing
--   notification_schedule     queue of things to send later (cron drains it)
--   notification_deliveries   per-channel delivery + read audit trail
--   notify()                  single entry point every module calls
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- pg_cron must normally be enabled from the Supabase dashboard
-- (Database > Extensions > pg_cron). Attempt it here, but do not abort the
-- whole migration if the role lacks permission — everything except the
-- scheduled reminders still works without it.
DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not enabled (%). Scheduled reminders will not run until you enable it in Database > Extensions.', SQLERRM;
END $do$;

-- ---------------------------------------------------------------------
-- 1. CATEGORY CATALOGUE
-- ---------------------------------------------------------------------
-- One row per kind of notification the platform can emit. Adding a new
-- notification type in future = INSERT one row here. Nothing else.

CREATE TABLE IF NOT EXISTS public.notification_categories (
  key             TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  description     TEXT,
  icon            TEXT DEFAULT 'Bell',
  -- Grouping shown in the preferences UI
  group_key       TEXT NOT NULL DEFAULT 'general',
  -- Can a user switch this off? Security/system alerts should stay on.
  user_can_disable BOOLEAN NOT NULL DEFAULT TRUE,
  -- Default state for users who have never touched their preferences
  default_push    BOOLEAN NOT NULL DEFAULT TRUE,
  default_inapp   BOOLEAN NOT NULL DEFAULT TRUE,
  default_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.notification_categories
  (key, label, description, icon, group_key, user_can_disable, default_push, default_inapp, default_whatsapp, sort_order)
VALUES
  ('service.assigned',    'Service Assigned',      'A new service has been assigned to you',        'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 10),
  ('service.updated',     'Service Updated',       'Details of your service changed',               'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 20),
  ('service.cancelled',   'Service Cancelled',     'A service you were assigned was cancelled',     'ListChecks',   'services',      TRUE,  TRUE,  TRUE,  FALSE, 30),
  ('service.reminder',    'Service Reminder',      'Upcoming service reminders',                    'Clock',        'services',      TRUE,  TRUE,  TRUE,  FALSE, 40),
  ('service.completed',   'Service Completed',     'Confirmation that a service was completed',     'CheckCircle2', 'services',      TRUE,  FALSE, TRUE,  FALSE, 50),

  ('sadhana.daily',       'Daily Sadhana Reminder','Reminder to fill your daily sadhana',           'BookOpen',     'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 60),
  ('sadhana.weekly',      'Weekly Sadhana Report', 'Reminder to submit your weekly report',         'BookOpen',     'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 70),
  ('sadhana.missed',      'Missed Sadhana',        'You did not submit yesterday',                  'AlertCircle',  'sadhana',       TRUE,  TRUE,  TRUE,  FALSE, 80),

  ('cleanliness.assigned','Cleaning Duty Assigned','A cleaning duty was assigned to you',           'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 90),
  ('cleanliness.reminder','Cleaning Reminder',     'Upcoming cleaning duty',                        'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 100),
  ('cleanliness.completed','Cleaning Completed',   'A duty was marked complete',                    'CheckCircle2', 'cleanliness',   TRUE,  FALSE, TRUE,  FALSE, 110),
  ('cleanliness.reassigned','Area Reassigned',     'Your cleaning area changed',                    'Sparkles',     'cleanliness',   TRUE,  TRUE,  TRUE,  FALSE, 120),

  ('announcement.new',    'Announcements',         'Org-wide announcements',                        'Megaphone',    'announcements', TRUE,  TRUE,  TRUE,  FALSE, 130),
  ('event.new',           'New Event',             'A new event was published',                     'CalendarDays', 'events',        TRUE,  TRUE,  TRUE,  FALSE, 140),
  ('event.reminder',      'Event Reminder',        'An event is starting soon',                     'CalendarDays', 'events',        TRUE,  TRUE,  TRUE,  FALSE, 150),
  ('festival.new',        'Festivals',             'Upcoming festivals and celebrations',           'Flame',        'events',        TRUE,  TRUE,  TRUE,  FALSE, 160),

  ('message.personal',    'Personal Messages',     'Direct messages from coordinators/mentors',     'MessageCircle','personal',      TRUE,  TRUE,  TRUE,  FALSE, 170),
  ('system.alert',        'System Alerts',         'Account and security notices',                  'Shield',       'system',        FALSE, TRUE,  TRUE,  FALSE, 180)
ON CONFLICT (key) DO UPDATE
  SET label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      icon             = EXCLUDED.icon,
      group_key        = EXCLUDED.group_key,
      user_can_disable = EXCLUDED.user_can_disable,
      sort_order       = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------
-- 2. PER-USER PREFERENCES
-- ---------------------------------------------------------------------
-- Absence of a row means "use the category defaults", so we never have to
-- backfill a row per user per category.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES public.notification_categories(key) ON DELETE CASCADE,
  push_enabled     BOOLEAN,
  inapp_enabled    BOOLEAN,
  whatsapp_enabled BOOLEAN,
  -- For reminder-style categories: what time of day to fire (user's local tz)
  preferred_time   TIME,
  -- Minutes-before offsets for reminders, e.g. [1440, 120, 30]
  lead_times_min   INTEGER[],
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, category_key)
);

-- Global per-user switches (quiet hours + master mute)
CREATE TABLE IF NOT EXISTS public.notification_settings (
  profile_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  push_muted       BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_opt_in  BOOLEAN NOT NULL DEFAULT FALSE,
  phone_e164       TEXT,
  quiet_start      TIME,
  quiet_end        TIME,
  timezone         TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. SCHEDULE QUEUE
-- ---------------------------------------------------------------------
-- Anything that should fire later lands here. pg_cron drains it every
-- minute. Recurrence is expressed as a cron expression evaluated by the
-- owning module, not here — this table only holds concrete send times.

CREATE TABLE IF NOT EXISTS public.notification_schedule (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES public.notification_categories(key) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT,
  reference_id  UUID,
  action_url    TEXT,
  send_at       TIMESTAMPTZ NOT NULL,
  -- pending | sent | cancelled | failed
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at       TIMESTAMPTZ
);

ALTER TABLE public.notification_schedule
  DROP CONSTRAINT IF EXISTS notification_schedule_status_check;
ALTER TABLE public.notification_schedule
  ADD CONSTRAINT notification_schedule_status_check
  CHECK (status IN ('pending', 'sent', 'cancelled', 'failed'));

CREATE INDEX IF NOT EXISTS idx_notif_schedule_due
  ON public.notification_schedule (send_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notif_schedule_ref
  ON public.notification_schedule (reference_id, category_key);

-- ---------------------------------------------------------------------
-- 4. DELIVERY AUDIT
-- ---------------------------------------------------------------------
-- Lets the admin dashboard answer "did it arrive, was it read, resend it".

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- push | inapp | whatsapp | email
  channel         TEXT NOT NULL,
  -- queued | sent | delivered | failed | skipped
  status          TEXT NOT NULL DEFAULT 'queued',
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_deliveries_notif
  ON public.notification_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_profile
  ON public.notification_deliveries (profile_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. EXTEND notifications WITH CATEGORY + ACTION URL
-- ---------------------------------------------------------------------
-- The legacy `type` column stays for backwards compatibility; `category_key`
-- is the new structured field the Notification Center filters on.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category_key TEXT REFERENCES public.notification_categories(key),
  ADD COLUMN IF NOT EXISTS action_url   TEXT,
  ADD COLUMN IF NOT EXISTS org_id       UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS read_at      TIMESTAMPTZ;

-- `voice_id` is a legacy NOT NULL column from the single-tenant era. Multi-org
-- notifications have no voice to point at, so relax the constraint rather than
-- forcing every caller to invent a value.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'voice_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.notifications ALTER COLUMN voice_id DROP NOT NULL';
  END IF;
END $do$;

CREATE INDEX IF NOT EXISTS idx_notifications_profile_cat
  ON public.notifications (profile_id, category_key, created_at DESC);

-- Backfill category_key from the old free-text type where we can map it
UPDATE public.notifications SET category_key = 'announcement.new'
  WHERE category_key IS NULL AND type IN ('announcement', 'announcements');
UPDATE public.notifications SET category_key = 'service.assigned'
  WHERE category_key IS NULL AND type IN ('service', 'seva');
UPDATE public.notifications SET category_key = 'sadhana.daily'
  WHERE category_key IS NULL AND type = 'sadhana';
UPDATE public.notifications SET category_key = 'cleanliness.assigned'
  WHERE category_key IS NULL AND type IN ('cleaning', 'cleanliness');
UPDATE public.notifications SET category_key = 'event.new'
  WHERE category_key IS NULL AND type = 'event';
UPDATE public.notifications SET category_key = 'system.alert'
  WHERE category_key IS NULL AND type = 'system';
UPDATE public.notifications SET category_key = 'message.personal'
  WHERE category_key IS NULL;

-- ---------------------------------------------------------------------
-- 6. PREFERENCE RESOLUTION
-- ---------------------------------------------------------------------
-- Returns the effective channel switches for one user + category, merging
-- the user's overrides over the category defaults.

CREATE OR REPLACE FUNCTION public.resolve_notification_prefs(
  p_profile_id UUID,
  p_category   TEXT
)
RETURNS TABLE (push BOOLEAN, inapp BOOLEAN, whatsapp BOOLEAN)
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(np.push_enabled,     nc.default_push)     AND NOT COALESCE(ns.push_muted, FALSE) AS push,
    COALESCE(np.inapp_enabled,    nc.default_inapp)                                            AS inapp,
    COALESCE(np.whatsapp_enabled, nc.default_whatsapp) AND COALESCE(ns.whatsapp_opt_in, FALSE) AS whatsapp
  FROM public.notification_categories nc
  LEFT JOIN public.notification_preferences np
    ON np.category_key = nc.key AND np.profile_id = p_profile_id
  LEFT JOIN public.notification_settings ns
    ON ns.profile_id = p_profile_id
  WHERE nc.key = p_category;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_notification_prefs(UUID, TEXT) TO authenticated;

-- Is the user inside their quiet hours right now?
CREATE OR REPLACE FUNCTION public.in_quiet_hours(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s      RECORD;
  v_now  TIME;
BEGIN
  SELECT quiet_start, quiet_end, timezone INTO s
  FROM public.notification_settings WHERE profile_id = p_profile_id;

  IF s IS NULL OR s.quiet_start IS NULL OR s.quiet_end IS NULL THEN
    RETURN FALSE;
  END IF;

  v_now := (NOW() AT TIME ZONE COALESCE(s.timezone, 'Asia/Kolkata'))::TIME;

  -- Window that does not cross midnight, e.g. 13:00-15:00
  IF s.quiet_start <= s.quiet_end THEN
    RETURN v_now >= s.quiet_start AND v_now < s.quiet_end;
  END IF;

  -- Window that crosses midnight, e.g. 22:00-06:00
  RETURN v_now >= s.quiet_start OR v_now < s.quiet_end;
END;
$$;

GRANT EXECUTE ON FUNCTION public.in_quiet_hours(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. notify() — THE SINGLE ENTRY POINT
-- ---------------------------------------------------------------------
-- Every module calls this instead of inserting into `notifications`
-- directly. It applies preferences, records a delivery row per channel and
-- lets the existing trg_notify_push trigger handle the actual push.
--
--   PERFORM public.notify(
--     p_profile_id  => '...',
--     p_category    => 'service.assigned',
--     p_title       => 'New service assigned',
--     p_body        => 'Book Distribution today at 5:00 PM',
--     p_reference_id=> v_service_id,
--     p_action_url  => '/services/' || v_service_id
--   );

CREATE OR REPLACE FUNCTION public.notify(
  p_profile_id   UUID,
  p_category     TEXT,
  p_title        TEXT,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL,
  -- Set TRUE for time-critical alerts that should pierce quiet hours
  p_force        BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefs   RECORD;
  v_notif   UUID;
  v_org     UUID := p_org_id;
  v_quiet   BOOLEAN;
BEGIN
  IF p_profile_id IS NULL OR p_title IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prefs
  FROM public.resolve_notification_prefs(p_profile_id, p_category);

  -- Unknown category: fail loudly in logs rather than silently dropping.
  -- NOTE: use FOUND, not `v_prefs IS NULL` — a RECORD is not set to NULL by
  -- SELECT INTO when no row matches, so the NULL test would never fire.
  IF NOT FOUND THEN
    RAISE WARNING 'notify(): unknown category %', p_category;
    RETURN NULL;
  END IF;

  IF NOT v_prefs.inapp AND NOT v_prefs.push AND NOT v_prefs.whatsapp THEN
    RETURN NULL;
  END IF;

  IF v_org IS NULL THEN
    SELECT COALESCE(active_org_id, org_id) INTO v_org
    FROM public.profiles WHERE id = p_profile_id;
  END IF;

  INSERT INTO public.notifications
    (org_id, profile_id, title, body, type, category_key, reference_id, action_url)
  VALUES
    (v_org, p_profile_id, p_title, p_body,
     split_part(p_category, '.', 1), p_category, p_reference_id, p_action_url)
  RETURNING id INTO v_notif;

  INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status)
  VALUES (v_notif, p_profile_id, 'inapp', CASE WHEN v_prefs.inapp THEN 'delivered' ELSE 'skipped' END);

  v_quiet := public.in_quiet_hours(p_profile_id);

  -- trg_notify_push already fired synchronously during the INSERT above and
  -- applied the same preference/quiet-hour checks, so record the outcome
  -- rather than leaving the row 'queued' for a drain that never comes.
  INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status, detail)
  VALUES (
    v_notif, p_profile_id, 'push',
    CASE
      WHEN NOT v_prefs.push                 THEN 'skipped'
      WHEN v_quiet AND NOT p_force          THEN 'skipped'
      ELSE 'sent'
    END,
    CASE
      WHEN NOT v_prefs.push        THEN 'user preference off'
      WHEN v_quiet AND NOT p_force THEN 'quiet hours'
      ELSE NULL
    END
  );

  IF v_prefs.whatsapp THEN
    INSERT INTO public.notification_deliveries (notification_id, profile_id, channel, status)
    VALUES (v_notif, p_profile_id, 'whatsapp', 'queued');
  END IF;

  RETURN v_notif;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID, BOOLEAN) TO authenticated;

-- Convenience: fan a notification out to many people at once
CREATE OR REPLACE FUNCTION public.notify_many(
  p_profile_ids  UUID[],
  p_category     TEXT,
  p_title        TEXT,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_count INTEGER := 0;
BEGIN
  FOREACH v_id IN ARRAY COALESCE(p_profile_ids, ARRAY[]::UUID[]) LOOP
    IF public.notify(v_id, p_category, p_title, p_body, p_reference_id, p_action_url, p_org_id) IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_many(UUID[], TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 8. SCHEDULING HELPERS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.schedule_notification(
  p_profile_id   UUID,
  p_category     TEXT,
  p_title        TEXT,
  p_send_at      TIMESTAMPTZ,
  p_body         TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_action_url   TEXT DEFAULT NULL,
  p_org_id       UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE SQL SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notification_schedule
    (org_id, profile_id, category_key, title, body, reference_id, action_url, send_at, created_by)
  VALUES
    (p_org_id, p_profile_id, p_category, p_title, p_body, p_reference_id, p_action_url, p_send_at, auth.uid())
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_notification(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, UUID) TO authenticated;

-- Cancel every pending reminder tied to a record (e.g. service cancelled)
CREATE OR REPLACE FUNCTION public.cancel_scheduled_notifications(
  p_reference_id UUID,
  p_category     TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.notification_schedule
  SET status = 'cancelled'
  WHERE reference_id = p_reference_id
    AND status = 'pending'
    AND (p_category IS NULL OR category_key = p_category);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_scheduled_notifications(UUID, TEXT) TO authenticated;

-- Drain the queue. pg_cron calls this every minute.
CREATE OR REPLACE FUNCTION public.dispatch_due_notifications()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_sent  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.notification_schedule
    WHERE status = 'pending' AND send_at <= NOW()
    ORDER BY send_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.notify(
        r.profile_id, r.category_key, r.title, r.body,
        r.reference_id, r.action_url, r.org_id
      );
      UPDATE public.notification_schedule
      SET status = 'sent', sent_at = NOW(), attempts = attempts + 1
      WHERE id = r.id;
      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.notification_schedule
      SET status     = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
          attempts   = attempts + 1,
          last_error = SQLERRM
      WHERE id = r.id;
    END;
  END LOOP;

  RETURN v_sent;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. RECURRING REMINDER GENERATORS
-- ---------------------------------------------------------------------
-- Daily sadhana nudge for anyone who has not submitted today.

CREATE OR REPLACE FUNCTION public.enqueue_daily_sadhana_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id AS profile_id, td.org_id, td.id AS tracker_id
    FROM public.profiles p
    JOIN public.tracker_definitions td
      ON td.org_id = COALESCE(p.active_org_id, p.org_id)
     AND td.name = 'Sadhana'
     AND td.is_active
    WHERE COALESCE(p.active_org_id, p.org_id) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.tracker_entries te
        WHERE te.tracker_id  = td.id
          AND te.user_id     = p.id
          AND te.period_date = CURRENT_DATE
      )
  LOOP
    PERFORM public.notify(
      r.profile_id, 'sadhana.daily',
      'Have you filled today''s sadhana?',
      'Tap to submit your daily practice report.',
      r.tracker_id, '/trackers/' || r.tracker_id, r.org_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Weekly report nudge (run Sunday evening).
CREATE OR REPLACE FUNCTION public.enqueue_weekly_sadhana_reminders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT p.id AS profile_id, td.org_id, td.id AS tracker_id
    FROM public.profiles p
    JOIN public.tracker_definitions td
      ON td.org_id = COALESCE(p.active_org_id, p.org_id)
     AND td.name = 'Sadhana'
     AND td.is_active
    WHERE COALESCE(p.active_org_id, p.org_id) IS NOT NULL
  LOOP
    PERFORM public.notify(
      r.profile_id, 'sadhana.weekly',
      'Weekly Sadhana Report is pending',
      'Please submit before Sunday night.',
      r.tracker_id, '/trackers/' || r.tracker_id, r.org_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------
-- 10. CRON JOBS
-- ---------------------------------------------------------------------
-- Times are UTC. 03:30 UTC = 09:00 IST, 14:30 UTC = 20:00 IST.

DO $do$
BEGIN
  PERFORM cron.unschedule('dispatch-due-notifications');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.unschedule('daily-sadhana-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.unschedule('weekly-sadhana-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

DO $do$
BEGIN
  PERFORM cron.schedule(
    'dispatch-due-notifications', '* * * * *',
    $cron$SELECT public.dispatch_due_notifications();$cron$
  );

  PERFORM cron.schedule(
    'daily-sadhana-reminder', '30 14 * * *',
    $cron$SELECT public.enqueue_daily_sadhana_reminders();$cron$
  );

  PERFORM cron.schedule(
    'weekly-sadhana-reminder', '30 13 * * 0',
    $cron$SELECT public.enqueue_weekly_sadhana_reminders();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not register cron jobs (%). Enable pg_cron then re-run this migration.', SQLERRM;
END $do$;

-- ---------------------------------------------------------------------
-- 11. READ TRACKING
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.notifications
  SET is_read = TRUE, read_at = NOW()
  WHERE profile_id = auth.uid()
    AND is_read = FALSE
    AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(UUID[]) TO authenticated;

-- ---------------------------------------------------------------------
-- 12. TEACH THE EXISTING PUSH TRIGGER ABOUT PREFERENCES
-- ---------------------------------------------------------------------
-- 19_push_notifications.sql fires a push for EVERY notification row. Now
-- that users can opt out and set quiet hours, the trigger has to check
-- before spending a push. Preferences are evaluated here rather than read
-- from notification_deliveries because the trigger runs before notify()
-- has written those rows.

CREATE OR REPLACE FUNCTION public.notify_push_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_url text;
  v_key      text;
  v_prefs    RECORD;
BEGIN
  -- Unknown/legacy category: fall through and deliver (old behaviour).
  IF NEW.category_key IS NOT NULL THEN
    SELECT * INTO v_prefs
    FROM public.resolve_notification_prefs(NEW.profile_id, NEW.category_key);

    IF FOUND AND NOT COALESCE(v_prefs.push, TRUE) THEN
      RETURN NEW;
    END IF;

    IF public.in_quiet_hours(NEW.profile_id) THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT value INTO v_base_url FROM private.app_secrets WHERE key = 'edge_base_url';
  SELECT value INTO v_key      FROM private.app_secrets WHERE key = 'service_role_key';

  IF v_base_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'profile_id',   NEW.profile_id,
      'title',        NEW.title,
      'body',         COALESCE(NEW.body, ''),
      'type',         COALESCE(NEW.category_key, NEW.type, 'general'),
      'reference_id', NEW.reference_id,
      'action_url',   NEW.action_url,
      'notification_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_push ON public.notifications;
CREATE TRIGGER trg_notify_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_insert();

-- ---------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.notification_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_schedule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_categories_read ON public.notification_categories;
CREATE POLICY notif_categories_read ON public.notification_categories
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS notif_prefs_own ON public.notification_preferences;
CREATE POLICY notif_prefs_own ON public.notification_preferences
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS notif_settings_own ON public.notification_settings;
CREATE POLICY notif_settings_own ON public.notification_settings
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

-- Users see their own queued items; admins see everything in their org
DROP POLICY IF EXISTS notif_schedule_read ON public.notification_schedule;
CREATE POLICY notif_schedule_read ON public.notification_schedule
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
  );

DROP POLICY IF EXISTS notif_schedule_write ON public.notification_schedule;
CREATE POLICY notif_schedule_write ON public.notification_schedule
  FOR ALL USING (public.has_any_permission(ARRAY['announcements.manage', 'members.manage']))
  WITH CHECK (public.has_any_permission(ARRAY['announcements.manage', 'members.manage']));

DROP POLICY IF EXISTS notif_deliveries_read ON public.notification_deliveries;
CREATE POLICY notif_deliveries_read ON public.notification_deliveries
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.has_any_permission(ARRAY['announcements.manage', 'members.manage'])
  );

NOTIFY pgrst, 'reload schema';


-- FILE: 41_services_cleanliness.sql
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


-- FILE: 42_register_service_modules.sql
-- =====================================================================
-- 42. REGISTER IM SERVICES + CLEANLINESS NAV MODULES; RETIRE TASKS
-- =====================================================================
-- Adds two catalogue modules that both ride on the task_* engine:
--   'service'      IM Services   /services
--   'cleanliness'  Cleanliness   /cleanliness
-- and disables the generic 'tasks' module (its schema stays, only the nav
-- entry is retired) so the sidebar shows the two focused modules instead.
--
-- Both reuse the existing tasks.* permission family, so no role reseed is
-- needed. Idempotent.
-- =====================================================================

-- 1. Catalogue entries
INSERT INTO public.modules
  (key, name, description, icon, route, category, required_permission, is_core, default_enabled, sort_order)
VALUES
  ('service',     'IM Services', 'Individual service assignments and rosters', 'ListChecks', '/services',    'operations', 'tasks.view_own',      FALSE, TRUE, 60),
  ('cleanliness', 'Cleanliness', 'Cleaning duties, areas and verification',    'Sparkles',   '/cleanliness', 'operations', 'tasks.view_own',      FALSE, TRUE, 65),
  ('broadcast',   'Broadcasts',  'Send and schedule notifications to members', 'Megaphone',  '/broadcast',   'comms',      'announcements.manage', FALSE, TRUE, 135)
ON CONFLICT (key) DO UPDATE
  SET name                = EXCLUDED.name,
      description         = EXCLUDED.description,
      icon                = EXCLUDED.icon,
      route               = EXCLUDED.route,
      category            = EXCLUDED.category,
      required_permission = EXCLUDED.required_permission,
      sort_order          = EXCLUDED.sort_order;

-- 2. Enable them for every org; leave any label_override intact
INSERT INTO public.organization_modules (org_id, module_key, enabled, sort_order)
SELECT o.id, m.key, TRUE, m.sort_order
FROM public.organizations o
CROSS JOIN public.modules m
WHERE m.key IN ('service', 'cleanliness', 'broadcast')
ON CONFLICT (org_id, module_key) DO NOTHING;

UPDATE public.organization_modules
SET enabled = TRUE, updated_at = NOW()
WHERE module_key IN ('service', 'cleanliness', 'broadcast')
  AND enabled IS DISTINCT FROM TRUE;

-- 3. Retire the generic Tasks nav entry (schema + permissions remain)
UPDATE public.organization_modules
SET enabled = FALSE, updated_at = NOW()
WHERE module_key = 'tasks';

NOTIFY pgrst, 'reload schema';


-- FILE: 43_notifications_admin_read.sql
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


-- FILE: 44_fix_join_ambiguity.sql
-- =====================================================================
-- 44. FIX AMBIGUOUS org_id IN ORG JOIN FLOW
-- =====================================================================
-- The join-code flow occasionally raised "column reference 'org_id' is
-- ambiguous". That happens when a planner/join in a query (or a trigger it
-- fires) has two `org_id` columns in scope and an `org_id` is written without
-- a table alias. This migration defensively aliases every `org_id` reference
-- in join_organization_by_code and the membership trigger it fires.
--
-- Idempotent: safe to re-run.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_org          RECORD;
  v_requires     BOOLEAN;
  v_status       TEXT;
  v_membership   UUID;
  v_default_role UUID;
  v_existing     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join an organization';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Join code is required';
  END IF;

  SELECT o.id, o.name, o.status INTO v_org
  FROM public.organizations o
  WHERE o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Already connected? Report the existing state instead of duplicating.
  SELECT m.status INTO v_existing
  FROM public.memberships m
  WHERE m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO v_requires
  FROM public.organization_settings s
  WHERE s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant the org's default role so the member has baseline permissions
  SELECT r.id INTO v_default_role
  FROM public.roles r
  WHERE r.org_id = v_org.id AND r.is_default
  LIMIT 1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Only focus the org if the member can actually use it now
  IF v_status = 'active' THEN
    UPDATE public.profiles p
    SET active_org_id = v_org.id,
        org_id        = COALESCE(p.org_id, v_org.id),
        is_approved   = TRUE,
        updated_at    = NOW()
    WHERE p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- Also harden the trigger that fires on INSERT INTO memberships
CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_role_id UUID;
BEGIN
  SELECT r.id INTO v_role_id
  FROM public.roles r
  WHERE r.org_id = NEW.org_id AND r.is_default
  LIMIT 1;

  IF v_role_id IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (NEW.id, v_role_id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';


-- FILE: 45_fix_admin_autologin.sql
-- =====================================================================
-- 45. FIX ADMIN AUTO-LOGIN
-- =====================================================================
-- Problem: admins/owners who created their org before migration 24/30
-- ran have profiles.active_org_id = NULL. On every fresh login the
-- orgStore cannot resolve which org to open, falls through to the
-- onboarding screen, and asks them to enter the join code again.
--
-- This migration:
--   1. Backfills active_org_id for every profile that has an active
--      membership but a NULL (or stale) active_org_id.
--   2. Hardens current_org_id() so it ALWAYS returns something for a
--      user with at least one active membership — even if active_org_id
--      and org_id are both NULL.
--   3. Adds an after-login trigger: when a session starts (auth.uid()
--      changes inside a transaction), auto-repair active_org_id if it
--      is NULL but the user has exactly one active membership.
--   4. Tightens join_organization_by_code so it always writes
--      active_org_id when the member is already active (covers the
--      "already joined, code re-entered" path).
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ─── 1. ONE-TIME BACKFILL ────────────────────────────────────────────────────
-- For every profile where active_org_id is NULL *but* the user has an
-- active membership, set active_org_id to the most recently joined org.
UPDATE public.profiles p
SET   active_org_id = (
        SELECT m.org_id
        FROM   public.memberships m
        WHERE  m.user_id = p.id
          AND  m.status  = 'active'
        ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
        LIMIT  1
      ),
      -- keep legacy org_id column in sync too
      org_id = COALESCE(
        p.org_id,
        (SELECT m.org_id
         FROM   public.memberships m
         WHERE  m.user_id = p.id AND m.status = 'active'
         ORDER  BY m.joined_at DESC NULLS LAST, m.created_at DESC NULLS LAST
         LIMIT  1)
      ),
      is_approved = TRUE,
      updated_at  = NOW()
WHERE p.active_org_id IS NULL
  AND EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = p.id AND m.status = 'active'
      );

-- ─── 2. HARDEN current_org_id() ─────────────────────────────────────────────
-- The previous version could return NULL when active_org_id was NULL
-- (profiles.org_id was null too). The new version always falls through
-- to "most recent active membership" and never returns NULL for a
-- member who genuinely belongs to an org.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1. Explicitly chosen active org (and membership still valid)
    (SELECT p.active_org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.active_org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.active_org_id
                AND  m.status  = 'active'
            )
    ),
    -- 2. Legacy org_id column
    (SELECT p.org_id
     FROM   public.profiles p
     WHERE  p.id = auth.uid()
       AND  p.org_id IS NOT NULL
       AND  EXISTS (
              SELECT 1 FROM public.memberships m
              WHERE  m.user_id = auth.uid()
                AND  m.org_id  = p.org_id
                AND  m.status  = 'active'
            )
    ),
    -- 3. Any single active membership (most recently joined first)
    (SELECT m.org_id
     FROM   public.memberships m
     WHERE  m.user_id = auth.uid()
       AND  m.status  = 'active'
     ORDER  BY m.joined_at DESC NULLS LAST
     LIMIT  1
    )
  );
$$;

-- ─── 3. AUTO-REPAIR FUNCTION ─────────────────────────────────────────────────
-- Called explicitly from the client after login (see below). Writes
-- active_org_id into the profile if it is missing.  Returns the org_id
-- that is now active, or NULL if the user has no active memberships.
CREATE OR REPLACE FUNCTION public.ensure_active_org()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_org_id UUID;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  -- Already set and valid? Done.
  SELECT p.active_org_id INTO v_org_id
  FROM   public.profiles p
  WHERE  p.id = v_uid
    AND  p.active_org_id IS NOT NULL
    AND  EXISTS (
           SELECT 1 FROM public.memberships m
           WHERE m.user_id = v_uid AND m.org_id = p.active_org_id AND m.status = 'active'
         );

  IF v_org_id IS NOT NULL THEN RETURN v_org_id; END IF;

  -- Pick the best active membership
  SELECT m.org_id INTO v_org_id
  FROM   public.memberships m
  WHERE  m.user_id = v_uid AND m.status = 'active'
  ORDER  BY m.joined_at DESC NULLS LAST
  LIMIT  1;

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  -- Write it back so future calls are fast
  UPDATE public.profiles
  SET    active_org_id = v_org_id,
         org_id        = COALESCE(org_id, v_org_id),
         is_approved   = TRUE,
         updated_at    = NOW()
  WHERE  id = v_uid;

  RETURN v_org_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_active_org() TO authenticated;

-- ─── 4. HARDEN join_organization_by_code ────────────────────────────────────
-- When re-entering a code for an org the user is already active in,
-- still write active_org_id so the session picks it up.
CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_code         TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_org          RECORD;
  v_requires     BOOLEAN;
  v_status       TEXT;
  v_membership   UUID;
  v_default_role UUID;
  v_existing     TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join an organization';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Join code is required';
  END IF;

  SELECT o.id, o.name, o.status INTO v_org
  FROM   public.organizations o
  WHERE  o.join_code = v_code;

  IF v_org.id IS NULL THEN
    RAISE EXCEPTION 'No organization found for that join code';
  END IF;

  IF v_org.status <> 'active' THEN
    RAISE EXCEPTION 'That organization is not currently accepting members';
  END IF;

  -- Check existing membership
  SELECT m.status INTO v_existing
  FROM   public.memberships m
  WHERE  m.org_id = v_org.id AND m.user_id = v_uid;

  IF v_existing = 'active' THEN
    -- Already a member — just make sure active_org_id is set
    UPDATE public.profiles p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;
    RETURN QUERY SELECT v_org.id, v_org.name, 'active'::TEXT;
    RETURN;
  ELSIF v_existing = 'pending' THEN
    RETURN QUERY SELECT v_org.id, v_org.name, 'pending'::TEXT;
    RETURN;
  ELSIF v_existing = 'suspended' THEN
    RAISE EXCEPTION 'Your membership of that organization has been suspended';
  END IF;

  -- New join
  SELECT COALESCE((s.features->>'requireApproval')::boolean, TRUE)
  INTO   v_requires
  FROM   public.organization_settings s
  WHERE  s.org_id = v_org.id;

  v_requires := COALESCE(v_requires, TRUE);
  v_status   := CASE WHEN v_requires THEN 'pending' ELSE 'active' END;

  INSERT INTO public.memberships (org_id, user_id, status, joined_at)
  VALUES (v_org.id, v_uid, v_status,
          CASE WHEN v_status = 'active' THEN NOW() ELSE NULL END)
  ON CONFLICT (org_id, user_id)
    DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_membership;

  -- Grant default role
  SELECT r.id INTO v_default_role
  FROM   public.roles r
  WHERE  r.org_id = v_org.id AND r.is_default
  LIMIT  1;

  IF v_default_role IS NOT NULL THEN
    INSERT INTO public.membership_roles (membership_id, role_id)
    VALUES (v_membership, v_default_role)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Set active org if now active
  IF v_status = 'active' THEN
    UPDATE public.profiles p
    SET    active_org_id = v_org.id,
           org_id        = COALESCE(p.org_id, v_org.id),
           is_approved   = TRUE,
           updated_at    = NOW()
    WHERE  p.id = v_uid;
  END IF;

  RETURN QUERY SELECT v_org.id, v_org.name, v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

