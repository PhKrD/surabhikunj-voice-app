-- Fix: my_assignments() had two overloads — my_assignments(text, text) from
-- 41_services_cleanliness.sql and my_assignments(text, text, uuid) from
-- 51_counsellor_management.sql (which was meant to replace it, since the
-- third param defaults to NULL). Postgres treats these as distinct functions
-- by signature, so both existed simultaneously. PostgREST's RPC resolver
-- can't disambiguate a 2-arg call between them, causing:
--   "Could not choose the best candidate function between
--    public.my_assignments(p_module => text, p_scope => text),
--    public.my_assignments(p_module => text, p_scope => text, p_user_id => uuid)"
-- on every page that calls my_assignments (Cleanliness, Services, etc).
--
-- Fix: drop the older 2-arg overload. The 3-arg version's p_user_id defaults
-- to NULL, so all existing 2-arg call sites keep working unchanged.

DROP FUNCTION IF EXISTS public.my_assignments(TEXT, TEXT);
