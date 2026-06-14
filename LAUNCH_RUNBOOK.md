# SurabhiKunj VOICE — Launch Runbook

## 1) Pre-Launch Checklist

- Supabase project is active and reachable.
- SQL setup completed in order (`01`, `02`, `04`, `05`; `03` optional).
- First admin created via `supabase/06_make_first_admin.sql`.
- `.env` and Vercel environment variables are set correctly.
- App smoke test passed (create/edit/archive/undo + notifications + sign in/out).

## 2) Deployment Source of Truth

- GitHub repo: `https://github.com/PhKrD/surabhikunj-voice-app`
- Current deployment URL: `https://surabhikunj-voice-99pncz93n-phkd-s-projects.vercel.app`

## 3) Vercel Deployment Settings

- Framework: `Vite`
- Build command: `npm run build`
- Output directory: `dist`
- Required env vars:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_DEFAULT_VOICE_ID`

## 4) Supabase Auth URL Configuration

- In `Authentication -> URL Configuration`:
  - Site URL: production app URL
  - Redirect URLs:
    - `https://<your-prod-domain>/*`
    - `http://localhost:5173/*`

## 5) Production Verification (After Each Deploy)

1. Open production URL.
2. Sign in with admin.
3. Create a department and archive/undo.
4. Create a service and archive/undo.
5. Create an event and archive/undo.
6. Open notifications and verify deep-link works.
7. Sign out and sign in again.

## 6) Backup Procedure

### A) Platform backup
- Check Supabase backup status in `Settings -> Database/Backups`.

### B) Manual CSV exports (recommended weekly)
Run and export each query result:

```sql
select * from public.profiles;
select * from public.departments;
select * from public.services;
select * from public.events;
select * from public.notifications;
```

## 7) Monitoring Procedure

- Supabase `Logs` saved views:
  - `auth` + `error`
  - `database` + `error`
- Review logs after every release and weekly.

## 8) Rollback Plan

If production breaks after deploy:

1. In Vercel, open previous successful deployment.
2. Click `Promote to Production` (or redeploy previous stable commit).
3. Re-run production verification checklist.

If issue is DB policy/function related:

1. Re-run known-good SQL scripts (`02`, `05`) carefully.
2. Re-test signup/signin and one CRUD flow.

## 9) Admin Safety Rules

- Maintain at least 2 admin accounts.
- Do not expose secret keys in frontend.
- Use only publishable/anon key in Vite env.
- Keep admin bootstrap SQL restricted to setup/maintenance.

## 10) Day-to-Day Operations

### Daily (2–5 minutes)
- Check app login works.
- Check latest `auth`/`database` errors in logs.

### Weekly (15–20 minutes)
- Export manual CSV backups.
- Validate one full CRUD + notification flow.
- Review admin users/roles in `profiles`.
