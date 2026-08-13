-- =====================================================================
-- 33. FIX PROFILE → ORGANIZATION AMBIGUITY
-- =====================================================================
-- profiles has TWO foreign-key columns pointing at organizations:
--   • org_id          – the member's primary / legacy org column
--   • active_org_id   – the currently-selected org for multi-org support
--
-- PostgREST 12 (shipped with newer Supabase projects) added automatic
-- relationship expansion in SELECT *. When two FKs on the same table
-- both point to the same foreign table, PostgREST cannot determine which
-- one to use and raises:
--   "Could not embed because more than one relationship was found
--    for 'profiles' and 'organizations'"
--
-- Fix: drop the FK *constraint* on active_org_id.
--   - The column is kept unchanged (still a UUID storing the active org).
--   - Data integrity is maintained by the memberships table + the
--     current_org_id() function that already validates the value.
--   - PostgREST sees only one FK path (org_id), so SELECT * on profiles
--     no longer errors.
-- =====================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_active_org_id_fkey;
