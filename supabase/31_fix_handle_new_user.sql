CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spiritual TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'spiritual_name'), ''),
    split_part(NEW.email, '@', 1)
  );
  v_display   TEXT := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    v_spiritual
  );
BEGIN
  -- Write only the columns that actually exist so sign-ups survive partial migrations.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='profiles' AND column_name='display_name')
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, display_name, spiritual_name, email, role)
    VALUES (NEW.id, v_display, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='profiles' AND column_name='email')
  THEN
    INSERT INTO public.profiles (id, spiritual_name, email, role)
    VALUES (NEW.id, v_spiritual, NEW.email, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, spiritual_name, role)
    VALUES (NEW.id, v_spiritual, 'devotee')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- Drop the pre-RBAC create_organization(TEXT,TEXT,TEXT,TEXT) overload from
-- migration 20. Migration 30 defined a new create_organization(TEXT,TEXT,TEXT)
-- (different arg count/names) but Postgres treats that as an overload, not a
-- replacement, so both now exist. PostgREST cannot pick between them when the
-- app calls create_organization with only p_name, and fails with PGRST203
-- ("Could not choose the best candidate function"). The 20_platform_core
-- version also predates memberships/roles/join_code, so it must not win.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_organization(TEXT, TEXT, TEXT, TEXT);
