-- =====================================================================
-- 73. LAUNCH PLATFORM: remote config, version control, crash reports,
--     admin-editable org content, and a configuration audit trail.
-- =====================================================================
-- Lets routine changes reach already-installed apps without a new APK:
--
--   app_platform_config   One row. Native version gating (minimum /
--                         recommended APK build), maintenance mode, APK
--                         download link, update message. Readable before
--                         sign-in — a device must learn it is too old, or
--                         that the service is under maintenance, even on
--                         the login screen. Editable by platform admins.
--
--   platform_admins       Who may edit the row above. Seed yourself once
--                         (see the bottom of this file).
--
--   organization_settings.content
--                         Per-organisation, editable by org admins in
--                         Settings: notice banner, support contacts,
--                         useful links.
--
--   client_errors         Crash/error reports from the app, so problems
--                         on a given app version are visible centrally.
--
--   config_audit_log      Who changed which configuration, and from what.
--
-- Idempotent: safe to run more than once. Additive only: no existing
-- table, column or row is modified or removed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Platform admins
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO anon, authenticated;

DROP POLICY IF EXISTS platform_admins_self_read ON public.platform_admins;
CREATE POLICY platform_admins_self_read ON public.platform_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_platform_admin());
-- No insert/update/delete policy: membership is granted with SQL only.

-- ---------------------------------------------------------------------
-- 2. Configuration audit trail (history, not just latest state)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.config_audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  row_key     TEXT NOT NULL,
  org_id      UUID,
  changed_by  UUID DEFAULT auth.uid(),
  old_value   JSONB,
  new_value   JSONB,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS config_audit_log_changed_at_idx ON public.config_audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS config_audit_log_org_idx ON public.config_audit_log (org_id, changed_at DESC);
ALTER TABLE public.config_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_audit_read ON public.config_audit_log;
CREATE POLICY config_audit_read ON public.config_audit_log
  FOR SELECT TO authenticated USING (
    public.is_platform_admin()
    OR (org_id IS NOT NULL AND org_id = public.current_org_id() AND public.has_permission('org.settings.manage'))
  );
-- Rows are written only by the trigger below (SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.log_config_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_org UUID;
BEGIN
  IF TG_TABLE_NAME = 'organization_settings' THEN
    v_key := NEW.org_id::text;
    v_org := NEW.org_id;
  ELSE
    v_key := NEW.id::text;
    v_org := NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) = to_jsonb(NEW) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.config_audit_log (table_name, row_key, org_id, old_value, new_value)
  VALUES (
    TG_TABLE_NAME, v_key, v_org,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Platform config (single row, id = 1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_platform_config (
  id                         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Android versionCode values (android/app/build.gradle). Below the
  -- minimum the app shows a blocking "update required" screen; below the
  -- recommended one, a dismissible banner.
  min_native_version_code          INTEGER NOT NULL DEFAULT 0 CHECK (min_native_version_code >= 0),
  recommended_native_version_code  INTEGER NOT NULL DEFAULT 0 CHECK (recommended_native_version_code >= 0),
  apk_download_url           TEXT,
  update_message             TEXT,

  maintenance_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message        TEXT,

  -- Platform-wide switches, e.g. { "pushPrompt": true }. Read with
  -- useFeatureFlag() in the app; unknown keys are ignored by old versions.
  feature_flags              JSONB NOT NULL DEFAULT '{}'::jsonb,

  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                 UUID DEFAULT auth.uid(),

  CONSTRAINT app_platform_config_url_ck CHECK (apk_download_url IS NULL OR apk_download_url ~* '^https://'),
  CONSTRAINT app_platform_config_msg_len CHECK (
    coalesce(length(update_message), 0) <= 500 AND coalesce(length(maintenance_message), 0) <= 500
  )
);
INSERT INTO public.app_platform_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.app_platform_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_platform_config_read ON public.app_platform_config;
CREATE POLICY app_platform_config_read ON public.app_platform_config
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS app_platform_config_write ON public.app_platform_config;
CREATE POLICY app_platform_config_write ON public.app_platform_config
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.touch_app_platform_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_platform_config_touch ON public.app_platform_config;
CREATE TRIGGER app_platform_config_touch
  BEFORE UPDATE ON public.app_platform_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_platform_config();

DROP TRIGGER IF EXISTS app_platform_config_audit ON public.app_platform_config;
CREATE TRIGGER app_platform_config_audit
  AFTER UPDATE ON public.app_platform_config
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

-- ---------------------------------------------------------------------
-- 4. Admin-editable organisation content
-- ---------------------------------------------------------------------
-- {
--   "notice":  { "enabled": true, "id": "2026-10-diwali", "text": "...",
--                "tone": "info|success|warning|danger",
--                "linkUrl": "https://...", "linkLabel": "Details",
--                "dismissible": true },
--   "support": { "email": "...", "phone": "...", "whatsapp": "...", "hours": "..." },
--   "links":   [ { "label": "Website", "url": "https://..." } ]
-- }
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS content JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP TRIGGER IF EXISTS organization_settings_audit ON public.organization_settings;
CREATE TRIGGER organization_settings_audit
  AFTER UPDATE ON public.organization_settings
  FOR EACH ROW EXECUTE FUNCTION public.log_config_change();

-- ---------------------------------------------------------------------
-- 5. Client error reports
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_errors (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID DEFAULT auth.uid(),
  message      TEXT NOT NULL CHECK (length(message) <= 1000),
  stack        TEXT CHECK (length(stack) <= 4000),
  route        TEXT CHECK (length(route) <= 300),
  context      JSONB CHECK (pg_column_size(context) <= 4000),
  app_version  TEXT CHECK (length(app_version) <= 40),
  platform     TEXT CHECK (length(platform) <= 20),
  user_agent   TEXT CHECK (length(user_agent) <= 300)
);
CREATE INDEX IF NOT EXISTS client_errors_created_idx ON public.client_errors (created_at DESC);
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

-- Reports may come from the login screen, so anon may insert — but never
-- impersonate someone else (user_id must be the caller or empty).
DROP POLICY IF EXISTS client_errors_insert ON public.client_errors;
CREATE POLICY client_errors_insert ON public.client_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS client_errors_read ON public.client_errors;
CREATE POLICY client_errors_read ON public.client_errors
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- Keep 60 days; the table is diagnostic, not a permanent record.
CREATE OR REPLACE FUNCTION public.purge_old_client_errors()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.client_errors WHERE created_at < now() - interval '60 days';
$$;

-- ---------------------------------------------------------------------
-- 6. Make yourself a platform admin (run once, with your email):
--
--   INSERT INTO public.platform_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'you@example.com'
--   ON CONFLICT DO NOTHING;
-- ---------------------------------------------------------------------
