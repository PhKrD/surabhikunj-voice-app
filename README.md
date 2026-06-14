# SurabhiKunj VOICE

Modern multi-tenant devotional community management platform for VOICE setups.

## Tech Stack

- React + Vite
- TailwindCSS v4
- Supabase (Auth + PostgreSQL + RLS)
- React Router + Zustand
- Framer Motion + Recharts

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env
```

3. Set your Supabase values in `.env`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_DEFAULT_VOICE_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

4. Run SQL setup in the Supabase SQL editor, in this order:

Required (schema + policies):
- `supabase/01_schema.sql`
- `supabase/02_bootstrap.sql`
- `supabase/04_events_soft_delete.sql`
- `supabase/05_app_policies.sql`
- `supabase/07_department_members_policies.sql`
- `supabase/08_announcements.sql`
- `supabase/10_sadhana_config.sql`
- `supabase/11_notifications_triggers.sql`
- `supabase/12_realtime.sql`

After your first sign-up (promote yourself to admin):
- `supabase/06_make_first_admin.sql` (edit the email first, run once)

Optional demo data:
- `supabase/03_seed_demo.sql` — departments, services, cleaning areas, events, today's prasadam menu, announcements
- `supabase/09_seed_demo_personal.sql` — run after residents sign up; adds today's service/cleaning + 7 days of sadhana per resident

5. Promote first admin user:

- First, sign up once with your intended admin email.
- Then run the block in `supabase/06_make_first_admin.sql` after replacing email.

6. Start app:

```bash
npm run dev
```

## Supabase Bootstrap Flow

- New users are created in `auth.users`.
- Trigger creates `profiles` row.
- On first sign-in, app calls `bootstrap_current_user_to_default_voice()` to attach user to default VOICE if `voice_id` is missing.

## Scripts

- `npm run dev` — local dev server
- `npm run lint` — eslint
- `npm run build` — production build
- `npm run preview` — preview build output

## Smoke-test the daily loop

1. Apply the required SQL (`01`, `02`, `04`, `05`, `07`, `08`) and optionally `03_seed_demo.sql`.
2. Sign up your admin account in the app, then run `06_make_first_admin.sql` (with your email) once.
3. Sign up 2–3 more accounts to act as residents (they appear under **Residents**).
4. Run `09_seed_demo_personal.sql` to populate today's services/cleaning + sadhana history for everyone.
5. Verify in the app:
   - **Dashboard** — today's sadhana, services, cleanliness, prasadam, upcoming events, announcements, your counsellor.
   - **Residents** — directory with search + role/status/department filters; open a profile to edit (admin).
   - **Sadhana → Analytics** — streak banner + weekly/monthly rollups.
   - **Announcements** — leadership can post/pin/delete.

## Notes

- This repo is frontend + SQL setup pack.
- Never commit real Supabase keys.
- For WhatsApp notifications in production, add an Edge Function + provider (Twilio/WATI).
