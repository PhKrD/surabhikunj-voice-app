-- =====================================================================
-- 34. RESOLVE profiles / organizations RESOURCE-EMBEDDING AMBIGUITY
-- =====================================================================
-- PostgREST still sees more than one relationship between `profiles` and
-- `organizations`, so any `select('*, organizations(...)')` (or the legacy
-- `voices(...)` embed) fails with:
--   "Could not embed because more than one relationship was found
--    for 'profiles' and 'organizations'"
--
-- This migration makes the relationship unambiguous by keeping only the
-- primary `profiles.org_id -> organizations.id` FK and removing:
--   1. Any `profiles` FK to `organizations` that is NOT on `org_id`
--      (e.g. the leftover `active_org_id` FK).
--   2. The reverse `organizations.owner_id -> profiles.id` FK, which
--      also creates a `profiles` <-> `organizations` relation.
--
-- The columns themselves are kept; only the constraints are dropped so
-- PostgREST has a single, unambiguous path for resource embedding.
--
-- Idempotent: safe to re-run.
-- =====================================================================

DO $$
DECLARE
  c RECORD;
BEGIN
  -- 1. Drop any profiles -> organizations FK that is NOT on the org_id column
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class src     ON src.oid     = con.conrelid
    JOIN pg_namespace sns ON sns.oid     = src.relnamespace
    JOIN pg_class tgt     ON tgt.oid     = con.confrelid
    JOIN pg_namespace tns ON tns.oid     = tgt.relnamespace
    JOIN pg_attribute a   ON a.attrelid  = src.oid
                         AND a.attnum    = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND sns.nspname = 'public' AND src.relname = 'profiles'
      AND tns.nspname = 'public' AND tgt.relname = 'organizations'
      AND a.attname <> 'org_id'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;

  -- 2. Drop the reverse organizations -> profiles owner_id FK
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class src     ON src.oid     = con.conrelid
    JOIN pg_namespace sns ON sns.oid     = src.relnamespace
    JOIN pg_class tgt     ON tgt.oid     = con.confrelid
    JOIN pg_namespace tns ON tns.oid     = tgt.relnamespace
    JOIN pg_attribute a   ON a.attrelid  = src.oid
                         AND a.attnum    = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND sns.nspname = 'public' AND src.relname = 'organizations'
      AND tns.nspname = 'public' AND tgt.relname = 'profiles'
      AND a.attname   = 'owner_id'
  LOOP
    EXECUTE format('ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

-- 3. Force PostgREST to rebuild its schema cache so the changes take effect
NOTIFY pgrst, 'reload schema';
