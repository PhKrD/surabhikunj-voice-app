-- CHUNK 0: RESET (drop all public objects)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', 'public', r.tablename);
  END LOOP;
  FOR r IN (
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND (t.typtype = 'e' OR t.typtype = 'c')
  ) LOOP
    EXECUTE format('DROP TYPE IF EXISTS %I.%I CASCADE', 'public', r.typname);
  END LOOP;
  FOR r IN (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname NOT LIKE 'pg_%'
      AND p.proname NOT IN ('gen_random_uuid','uuid_generate_v4','uuid_generate_v1','uuid_nil','uuid_ns_dns','uuid_ns_url','uuid_ns_oid','uuid_ns_x500')
  ) LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;
