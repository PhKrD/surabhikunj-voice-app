# Platform-First Refactor — Plan & Status

Turning this app from "the Surabhikunj VOICE app" into a generic multi-tenant
organization platform, where Surabhikunj is simply org #1.

Strategy: **expand–contract**. Every migration is additive or a rename.
Nothing is dropped until the frontend has moved over and been verified.
All migrations are idempotent — safe to re-run.

---

## Status

| # | Migration | Purpose | State |
|---|-----------|---------|-------|
| 20 | `20_platform_core.sql` | `voices`→`organizations`, `voice_id`→`org_id`, org settings (branding/terminology) | Written, **ready to apply** |
| 21 | `21_memberships.sql` | Users belong to many orgs; custom member fields | Written, **ready to apply** |
| 22 | `22_rbac.sql` | Kill `user_role` ENUM → permissions + custom roles | Written, **ready to apply** |
| 23 | `23_modules.sql` | Module registry + per-org enable/rename/reorder | Written, **ready to apply** |
| 24 | `24_rls_rewrite.sql` | All policies onto `has_permission()`; active-org switching | Written, **ready to apply** |
| 25 | `25_trackers.sql` | Generalise Sadhana → `tracker_definitions/fields/entries/scoring_rules` | **Written** |
| 26 | `26_tasks.sql` | Generalise Cleanliness + Services → `task_templates/areas/assignments/logs` | **Written** |
| 27 | `27_resources.sql` | Generalise Kitchen → `resource_types/plans/plan_items` | **Written** |
| 28 | `28_mentorship.sql` | Generalise Counsellor → `mentorship_types/relationships` | **Written** |
| 29 | Contract | Drop `user_role` enum, `profiles.role`, legacy columns | Pending frontend cutover |

### Frontend layer — status
- `src/store/orgStore.js` — OrgStore with `initialize`, `switchOrg`, `hasPermission`, `t()` **Done**
- `src/hooks/usePermission.js` — `usePermission()`, `usePermissions()`, `useTerm()` hooks **Done**
- `src/components/Can.jsx` — `<Can permission="…">` render guard **Done**
- `src/components/layout/Sidebar.jsx` — Dynamic nav from `my_navigation()`, org branding **Done**
- `src/components/layout/Header.jsx` — Org name from store, nav-label lookup **Done**
- `src/components/ProtectedRoute.jsx` — Permission-based guards, no more ADMIN_ROLES **Done**
- `src/store/authStore.js` — Boots orgStore after login; removes legacy bootstrap RPC **Done**
- `src/App.jsx` — Routes for all 5 primitives + legacy aliases **Done**
- `src/pages/trackers/TrackersPage.jsx` — Generic tracker list **Done**
- `src/pages/tasks/TasksPage.jsx` — My daily tasks **Done**
- `src/pages/resources/ResourcesPage.jsx` — Resource plan viewer **Done**
- `src/pages/mentorship/MentorshipPage.jsx` — Mentor/mentee view **Done**
- `src/pages/reports/ReportsPage.jsx` — Reports stub **Done**

---

## Apply order

Run **in order**, one at a time, in the Supabase SQL editor. Verify after each.

```
20_platform_core.sql
21_memberships.sql
22_rbac.sql
23_modules.sql
24_rls_rewrite.sql
```

Take a database backup first (Supabase Dashboard → Database → Backups).

---

## Verification

After all five, run this. Every row should report `PASS`.

```sql
-- 1. organizations exists, every org has a slug and settings
SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS orgs_have_slug_and_settings
FROM organizations o
LEFT JOIN organization_settings s ON s.org_id = o.id
WHERE o.slug IS NULL OR s.org_id IS NULL;

-- 2. every profile with an org became a membership
SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS all_profiles_migrated
FROM profiles p
WHERE p.org_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM memberships m
                  WHERE m.user_id = p.id AND m.org_id = p.org_id);

-- 3. every membership holds at least one role
SELECT CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS all_members_have_roles
FROM memberships m
WHERE NOT EXISTS (SELECT 1 FROM membership_roles mr WHERE mr.membership_id = m.id);

-- 4. every org has exactly one owner-equivalent and one default role
SELECT o.name,
       COUNT(*) FILTER (WHERE rp.permission_key = '*') AS owner_roles,
       COUNT(*) FILTER (WHERE r.is_default)            AS default_roles
FROM organizations o
JOIN roles r ON r.org_id = o.id
LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_key = '*'
GROUP BY o.name;

-- 5. previous admins retained full access
SELECT p.email, p.role AS legacy_role, r.name AS new_role
FROM profiles p
JOIN memberships m      ON m.user_id = p.id
JOIN membership_roles mr ON mr.membership_id = m.id
JOIN roles r             ON r.id = mr.role_id
WHERE p.role::text IN ('admin','vmc','oc')
ORDER BY p.email;

-- 6. navigation resolves (run as an authenticated user, not service role)
SELECT * FROM my_navigation();
```

### Spot-check permissions as a real user

```sql
-- impersonate: Supabase SQL editor runs as service_role by default, which
-- bypasses RLS. Test from the app instead, or use:
SELECT my_permissions();     -- should be non-empty for a logged-in member
SELECT has_permission('members.manage');
```

---

## Rollback

Migrations 21–24 only add tables/policies; dropping the new tables reverts them.
Migration 20 performs renames, so rollback is:

```sql
-- reverse of 20
ALTER TABLE organizations RENAME TO voices;
-- ... plus rename org_id back to voice_id on each table
```

Prefer restoring the pre-migration backup over hand-rolling this.

---

## Key design decisions

**Permissions, not roles, at the security layer.** Every RLS policy tests
`has_permission('events.create')`. A role is just a named bundle of
permissions that an org owns and can rename or delete. This is what makes
custom roles actually mean something to the database.

**`my_permissions()` is `STABLE`** so Postgres evaluates it once per
statement rather than per row. If RLS becomes a bottleneck at scale, move
the permission set into a JWT claim via a Supabase custom access token hook
— `has_permission()` then reads the claim with no query at all.

**Wildcard `*`** is the owner permission. It satisfies every check,
including permissions that do not exist yet, so new features never lock
owners out.

**Guards prevent self-lockout:** system roles cannot be deleted, core
modules cannot be disabled, and the last `*` holder cannot be demoted.

**Terminology is data.** `organization_settings.terminology` maps platform
nouns to an org's vocabulary (`member`→`Devotee`, `tracker`→`Sadhana`).
`organization_modules.label_override` does the same for navigation. The
platform ships generic; Surabhikunj's wording is seeded as *their* config.

**Signup no longer auto-joins an org.** `handle_new_user()` creates a global
identity only. `bootstrap_current_user_to_default_voice()` is now a no-op.
Joining is explicit: invite, join code, or founding an org.

---

## Breaking changes for the frontend

These land when 20–24 are applied. The current bundle will partially break;
that is expected and is fixed in the frontend phase.

- `voices` table → `organizations` (a compat **view** keeps reads working)
- `voice_id` → `org_id` on all tenant tables
- `profiles.role` still exists but is no longer authoritative — read roles
  from `membership_roles`
- `profiles.is_approved` superseded by `memberships.status = 'active'`
- `profiles.spiritual_name` now nullable; use `display_name`, with
  `spiritual_name` available as an org custom field
- `is_admin()` still works but now resolves via permissions

Frontend replacements to build:
- `ADMIN_ROLES` / `PRIVILEGED_ROLES` in `src/lib/utils.js` → `usePermission()`
- hardcoded `navItems` in `src/components/layout/Sidebar.jsx` → `my_navigation()`
- `"SurabhiKunj" / "VOICE"` strings → `organization_settings.branding`
- saffron theme constants → CSS variables from branding
