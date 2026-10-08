# VOICE — Deployment & Updates

How changes reach people's phones, and what each kind of change needs.

## What needs what

| Change | How it ships | Users reinstall? |
|---|---|---|
| Screens, text, styling, logic, new pages | OTA bundle (`npm run deploy:ota`) | No — applied on next app launch |
| Notice bar, support contacts, useful links | Settings → Notices & support | No — next time the app opens |
| Navigation, roles, permissions, modules, terminology, branding | Settings / database | No |
| Sadhana fields, marks, scoring, WhatsApp template | Sadhana settings | No |
| Feature on/off switches | `organization_settings.features` or `app_platform_config.feature_flags` (read with `useFeatureFlag`) | No |
| Maintenance mode, "please update" prompts | Settings → App & updates (platform admins) | No |
| New native plugin, Android permission, SDK/Capacitor upgrade, Kotlin/Java code, app icon | New APK (`npm run apk`) | Yes — installs **over** the old one, data kept |

## Over-the-air (OTA) updates

```bash
npm run deploy:ota            # bumps patch version, builds, uploads, publishes
npm run deploy:ota -- 1.4.0   # explicit version
```

- The app checks on launch and when returning to the foreground (at most
  every 30 min), downloads in the background, and switches on the **next launch**.
- A new bundle is marked healthy only after it renders. If it crashes first,
  the phone automatically rolls back to the previous bundle.
- **Rollback:** publish the previous version number again.
- `package.json → ota.minNativeVersionCode` is the oldest APK build the
  JavaScript supports. Raise it when a release *starts calling a native plugin
  older APKs don't have*; those APKs keep their current bundle instead of
  breaking. All native calls go through `src/lib/native.js` (`hasPlugin()`),
  so normally this stays at the oldest APK in use.

## Releasing a new APK

1. Bump `versionCode` (+1) and `versionName` in `android/app/build.gradle`.
2. `npm run apk` → `~/Desktop/VOICE-<version>-<code>.apk` (signed, verified).
3. Upload the APK somewhere with a stable **https** link.
4. Settings → App & updates: paste the link, set **Recommend updating below build**
   to the new `versionCode`. Only set **Require updating below build** when the
   old APK genuinely cannot work any more.

### Android signing — critical

Android installs an update over an existing app **only if it is signed with the
same key**. Lose the key and every user must uninstall and reinstall.

- Key: `~/Documents/VOICE-signing/voice-release.keystore` (the same certificate
  as every APK distributed so far, SHA-256 `67:91:BF:30:…:FB:1E`).
- Config: `android/keystore.properties` (gitignored).
- **Back the keystore up now** to at least two places that are not this Mac
  (password manager attachment, encrypted USB drive). Never commit it.

## Database migrations

There is no automatic migration runner: paste each file into the Supabase SQL
Editor, in order, once.

Status of the live database (checked October 2026):

| Migration | Status | Action |
|---|---|---|
| 01 – 48, 51 – 72 | Applied | — |
| **49_tracker_config_engine.sql** | **Not applied** | Apply. Sadhana field groups, calculated columns (Body/Soul/Total) and saved WhatsApp templates fail until it is. |
| 50_sadhana_config_upgrade.sql | Not applied | **Optional — read first.** It resets every org's Sadhana marks to the built-in defaults, overwriting your configured marks. Skip it unless you want that. |
| **73_launch_platform.sql** | **New** | Apply. Remote config, version gating, maintenance mode, notice bar, crash reports, config audit log. The app runs without it, but those features stay inactive. |

After 73, make yourself a platform admin (the bottom of the file has the SQL).

## Edge functions

Deploy with the Supabase CLI (`supabase login`, `supabase link`):

```bash
supabase functions deploy send-push --no-verify-jwt   # now requires the service-role key
supabase functions deploy notify-whatsapp             # now requires announcements.manage
```

After deploying `send-push`, send a test announcement and check a phone receives
it: the function now rejects any caller that does not present the service-role
key stored in `private.app_secrets` (that is how the database trigger calls it).

## Web app

The same build is served on Vercel (`surabhikunj-voice-app` project) for browser
and PWA users. Supabase → Authentication → URL Configuration must allow
`https://surabhikunj-voice-app.vercel.app/*` (password-reset links land on
`/reset-password`).

> The local `.vercel/project.json` in this folder is linked to the
> **youtube-content-publisher** project. Do not run `vercel --prod` here until
> it is re-linked (`vercel link`, choose `surabhikunj-voice-app`), or the other
> app's production site would be overwritten.

## Monitoring

- Crash reports: `select * from client_errors order by created_at desc;`
  (app version, route and stack for every unexpected error).
- Configuration history: `config_audit_log` (who changed what, before/after).
- Clean up old crash reports occasionally: `select purge_old_client_errors();`
