# Members Import + Push Notifications — Setup Runbook

Two features were added:

1. **Admin can create profiles / bulk-import devotees** (as devotee, IM, OC, dept incharge, etc.)
2. **Mobile push notifications with sound** for every alert — via Web Push (iOS PWA + web) and FCM (Android APK).

Follow the steps below **once** to activate them.

---

## Part 1 — Member creation & bulk import

### A. Run the SQL (already present from earlier work)
Make sure `supabase/17_member_approval.sql` has been run (adds `is_approved` + `email`).

### B. Deploy the edge function
```bash
supabase functions deploy admin-create-user
```
This lets an admin create a devotee from **Members → Add member**.
The devotee's **initial password is their mobile number** (they change it in Settings).

### C. Bulk-import the 16 devotees from the Google Sheet
Requires in `.env`: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_DEFAULT_VOICE_ID`.
```bash
npm run import:devotees
```
Each devotee is created as an approved `devotee`, password = their mobile.
Re-runnable (existing users are updated, not duplicated).

---

## Part 2 — Push notifications

### A. Run the push migration
Run `supabase/19_push_notifications.sql` in the Supabase SQL editor.
Then enable the **pg_net** extension (Database → Extensions → search `pg_net`).

Store the two values the trigger needs to call the push function:
```sql
insert into private.app_secrets (key, value) values
  ('edge_base_url',   'https://<PROJECT_REF>.supabase.co/functions/v1'),
  ('service_role_key','<YOUR service_role KEY>')
on conflict (key) do update set value = excluded.value;
```

### B. Web Push (iOS PWA + any browser) — free, no account
```bash
npm run gen:vapid
```
Copy the printed values:
- Put `VITE_VAPID_PUBLIC_KEY=...` in `.env` (baked into the app at build time).
- Set the Supabase secrets it prints:
```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:admin@surabhikunj.org
```

### C. Android FCM
1. Create a **free Firebase project** → add an **Android app** with package `com.surabhikunj.voice`.
2. Download **`google-services.json`** and place it at `android/app/google-services.json`.
   (The Gradle wiring is already in place — it auto-applies when the file exists.)
3. In Firebase → Project settings → **Service accounts** → *Generate new private key* (downloads a JSON).
4. Set the FCM secrets for the push function:
```bash
supabase secrets set FCM_PROJECT_ID=<your-firebase-project-id> \
  FCM_SERVICE_ACCOUNT="$(cat /path/to/service-account.json)"
```

### D. Deploy the push function
```bash
supabase functions deploy send-push --no-verify-jwt
```

### E. Ship the apps
```bash
npm run deploy:ota      # pushes web/PWA changes (iOS + web) to installed apps
npm run apk             # rebuild Android APK (needed because a native plugin + google-services.json were added)
```

---

## How it works
- Anything that inserts a row into `notifications` (announcements, seva/cleanliness allotments, events, weekly-report reminders, etc.) fires the `trg_notify_push` trigger.
- The trigger calls `send-push`, which delivers to **all** of that user's devices:
  - Web Push subscriptions (`push_subscriptions`) → PWA/browser shows a system notification with sound.
  - FCM device tokens (`device_tokens`) → Android app shows a heads-up notification with sound.
- Users are auto-registered for push right after login (`src/lib/push.js`), prompting once for permission.

## Notes
- **iOS**: Web Push works only for a PWA **added to the Home Screen** on **iOS 16.4+**. Tell iOS users to "Add to Home Screen" via Safari, then allow notifications.
- Expired tokens/subscriptions are auto-pruned by `send-push`.
