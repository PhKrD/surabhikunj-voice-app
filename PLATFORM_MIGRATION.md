# Surabhikunj VOICE — Platform-First Migration Guide

This document is the step-by-step playbook for taking the current codebase live on the new platform-first schema.

**Project ref:** `ssdymnmmmccwiiofgbyj`
**Supabase dashboard SQL editor:** https://supabase.com/dashboard/project/ssdymnmmmccwiiofgbyj/sql/new

---

## 0. BEFORE YOU START — CRITICAL

1. **Do this on a desktop/laptop.** Do not run these steps on the mobile build.
2. Make sure you have **Owner** or at least **Admin** role in the Supabase project.
3. The project may be paused if idle > 7 days. If the SQL editor shows "Project paused", resume it from the dashboard first.
4. This is a **destructive migration at step 29**. Data in legacy tables is expected to already be migrated into the new primitive tables in your application logic, or the contract phase will delete it.
5. Each migration is idempotent and must be run **in order, one at a time**.

---

## 1. Apply migrations 20-29 in the Supabase SQL editor

### How to run one migration
1. Go to https://supabase.com/dashboard/project/ssdymnmmmccwiiofgbyj/sql/new
2. Copy the entire contents of one migration file.
3. Paste it into the SQL editor.
4. Click **Run**.
5. Wait for the green success message.
6. Repeat for the next migration. **Do not skip or batch.**

### Order

Run in this exact order:

| #  | File                        | What it does                                                     |
|----|-----------------------------|------------------------------------------------------------------|
| 20 | `supabase/20_platform_core.sql`   | Rename `voices` → `organizations`, add `org_id`, settings table, views, `current_org_id()`, `my_organizations()`, `has_permission()` |
| 21 | `supabase/21_memberships.sql`     | Multi-org `memberships` table, custom `profile_fields`            |
| 22 | `supabase/22_rbac.sql`            | `roles`, `permissions`, `role_permissions`, `membership_roles`    |
| 23 | `supabase/23_modules.sql`         | `modules`, `module_configs`, `my_navigation()` RPC                |
| 24 | `supabase/24_rls_rewrite.sql`     | Active org switching `switch_organization()`, org-context RLS    |
| 25 | `supabase/25_trackers.sql`        | `tracker_definitions`, `tracker_fields`, `tracker_scoring_rules`, `tracker_entries`, `tracker_field_values`, `my_tracker_entries()` |
| 26 | `supabase/26_tasks.sql`           | `task_categories`, `task_templates`, `task_areas`, `task_assignments`, `task_logs`, `task_preferences` |
| 27 | `supabase/27_resources.sql`       | `resource_types`, `resource_plans`, `resource_plan_items`         |
| 28 | `supabase/28_mentorship.sql`      | `mentorship_types`, `mentorship_relationships`, `my_mentor()`, `my_mentees()` |
| 29 | `supabase/29_contract_phase.sql`  | **Drops legacy:** `voices` view, old functions, `profiles.counsellor_id`, `user_role` enum, `sadhana_reports`, `cleaning_*`, `service_*`, `meal_plans` |

### Verification after each migration

After every migration, run:

```sql
SELECT migration_name, success
FROM public.migrations
ORDER BY applied_at DESC
LIMIT 1;
```

If no `migrations` table exists, rely on the green success toast in the SQL editor.

If you see a **red error**, STOP. Paste the exact error in chat before continuing.

---

## 2. Deploy the updated edge function

This is run in your **local terminal** (NOT the SQL editor):

```bash
# Make sure you are in the project root
/Users/prajyottaur/CascadeProjects/surabhikunj-voice-app

# Log in if you haven't already
supabase login

# Deploy
supabase functions deploy admin-create-user
```

Expected output looks like:

```text
Deployed Function admin-create-user
```

If you get `command not found: supabase`, install the CLI first:
https://supabase.com/docs/guides/cli/getting-started

---

## 3. Verify the frontend build

After migrations + edge function are deployed:

```bash
npm run build
```

This must exit with code `0` and produce the `dist/` folder.

---

## 4. Push to installed apps via OTA (optional but recommended)

```bash
npm run deploy:ota
```

This uploads the web bundle to the `app-bundles` bucket on Supabase Storage. Capacitor apps will fetch it on next launch.

Only do a full APK rebuild (`npm run apk`) if you changed native plugins, permissions, icons, or app name.

---

## 5. Post-migration smoke test

1. **Create a test user** from the Members page with a real-looking email + phone.
2. **Login** with that user and check the Dashboard loads.
3. **Switch orgs** (if test user is in multiple) using the Sidebar dropdown.
4. **Submit a tracker entry** on `/trackers`.
5. **Mark a task** on `/tasks`.
6. **Check Reports** (`/reports`) shows data.
7. **As admin, add a resource plan** on `/resources`.
8. **Check Mentorship** (`/mentorship`) shows mentor/mentee.

---

## 6. Common failures and how to fix

| Error | Likely cause | Fix |
|-------|--------------|-----|
| `relation "organizations" does not exist` | Migration 20 not run | Run 20 first |
| `function "current_org_id" does not exist` | Migration 20 not run or failed | Re-run 20 |
| `column profiles.voice_id does not exist` | Migration 29 run before 20 | Restore from backup, re-run 20-29 in order |
| `type "user_role" does not exist` | Migration 29 run before `profiles.role` was migrated | Re-run 24 then 29; if still failing, migrate `profiles.role` from `user_role` to TEXT first |
| `Failed to fetch` / `NXDOMAIN` | Free-tier project is paused | Resume project from Supabase dashboard |
| `Cannot find module 'https://esm.sh/...'` | IDE lint only | Ignore — Deno runtime handles it at deploy time |
| `email rate limit exceeded` | Supabase built-in SMTP limit | Disable "Confirm email" in Auth → Sign In/Providers → Email |

---

## 7. Files you should not touch during this migration

- `.env` (already has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`)
- `supabase/config.toml` (CLI config)
- `src/lib/supabase.js` (connection setup)

---

## 8. Done checklist

- [ ] Migration 20 applied successfully
- [ ] Migration 21 applied successfully
- [ ] Migration 22 applied successfully
- [ ] Migration 23 applied successfully
- [ ] Migration 24 applied successfully
- [ ] Migration 25 applied successfully
- [ ] Migration 26 applied successfully
- [ ] Migration 27 applied successfully
- [ ] Migration 28 applied successfully
- [ ] Migration 29 applied successfully
- [ ] `supabase functions deploy admin-create-user` succeeded
- [ ] `npm run build` succeeded
- [ ] `npm run deploy:ota` ran (optional)
- [ ] Smoke tests passed

---

## 9. Still stuck?

Run the following diagnostics and paste the results:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

```sql
SELECT proname FROM pg_proc WHERE proname IN ('current_org_id','switch_organization','my_organizations','has_permission','my_mentor','my_mentees','my_tracker_entries');
```
