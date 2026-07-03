-- =====================================================================
-- 17. MEMBER APPROVAL & ADMIN ROLE ASSIGNMENT
-- =====================================================================
-- New sign-ups are PENDING until an admin approves them and assigns a role.
-- Email is denormalised onto profiles so admins can find & manage members
-- by email from inside the app.
-- =====================================================================

-- 1. New columns ------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email       TEXT;

-- 2. Backfill email from auth.users -----------------------------------
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND (p.email IS DISTINCT FROM u.email);

-- 3. Keep CURRENT users working: approve everyone who already exists.
--    New sign-ups from now on start PENDING (see trigger in step 5).
--    >>> If instead you want EVERY existing devotee to be re-approved by an
--        admin, comment out this UPDATE and run:
--            UPDATE public.profiles SET is_approved = FALSE
--            WHERE role NOT IN ('admin','vmc','oc');
UPDATE public.profiles SET is_approved = TRUE WHERE is_approved = FALSE;

-- 3b. Admins / leaders are always approved
UPDATE public.profiles SET is_approved = TRUE
WHERE role IN ('admin', 'vmc', 'oc');

-- 4. Index for fast email lookups -------------------------------------
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (lower(email));

-- 5. Recreate signup trigger: capture email, start PENDING ------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, spiritual_name, role, email, is_approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'spiritual_name', 'New Devotee'),
    'devotee',
    NEW.email,
    FALSE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. SECURITY: users may update their own profile (settings), but must
--    NOT be able to change their own role or approval. RLS WITH CHECK
--    cannot see the OLD row, so we clamp those columns here for anyone
--    who is not an admin. Admins (admin/vmc/oc) are unaffected.
CREATE OR REPLACE FUNCTION public.protect_privileged_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.role        := OLD.role;
    NEW.is_approved := OLD.is_approved;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_privileged_profile_columns();

-- 7. Ensure a user can ALWAYS read their own profile row (even before a
--    voice_id is assigned / while pending). Complements profiles_select.
DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (id = auth.uid());
