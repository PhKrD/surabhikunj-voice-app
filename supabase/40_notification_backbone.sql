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
