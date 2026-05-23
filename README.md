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

4. Run SQL setup in Supabase SQL editor:

- `supabase/01_schema.sql`
- `supabase/02_bootstrap.sql`
- optional: `supabase/03_seed_demo.sql`
- `supabase/04_events_soft_delete.sql`
- `supabase/05_app_policies.sql` (required)
- `supabase/06_make_first_admin.sql` (required once)

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

## Notes

- This repo is frontend + SQL setup pack.
- Never commit real Supabase keys.
- For WhatsApp notifications in production, add an Edge Function + provider (Twilio/WATI).
