# Supabase Setup Order

Run files in this order inside Supabase SQL Editor:

1. `01_schema.sql`
2. `02_bootstrap.sql`
3. `03_seed_demo.sql` (optional demo data)
4. `04_events_soft_delete.sql` (safe migration)
5. `05_app_policies.sql` (required app RLS fixes)
6. `06_make_first_admin.sql` (manual bootstrap for your first admin)

## Important Notes

- Your first admin user must sign up once before running `06_make_first_admin.sql`.
- Replace the email in `06_make_first_admin.sql` with the real email.
- `05_app_policies.sql` is required for:
  - service create/edit/archive from app
  - notification inserts from app
  - stricter event write checks

## Quick Verification Queries

```sql
-- check your role
select role, voice_id from public.profiles where id = auth.uid();

-- check policies exist
select schemaname, tablename, policyname
from pg_policies
where tablename in ('services', 'service_allocations', 'notifications', 'events')
order by tablename, policyname;
```
