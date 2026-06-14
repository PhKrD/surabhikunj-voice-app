# SurabhiKunj VOICE — Mobile (iOS + Android) Guide

The app ships to the App Store and Play Store as a **Capacitor** native shell
that loads your existing React/Vite web app. Day-to-day web changes are pushed
**instantly and for free** via self-hosted OTA updates on Supabase Storage.

---

## 1. One-time prerequisites

### Accounts (your action — has costs)
- **Apple Developer Program** — $99/year → https://developer.apple.com/programs/
- **Google Play Console** — $25 one-time → https://play.google.com/console/signup

### Tools on your Mac
- **Xcode** (from the Mac App Store) — required for iOS builds.
- **Android Studio** — https://developer.android.com/studio (installs the Android SDK + JDK).

After installing Xcode once, run:
```bash
xcode-select --install
sudo xcodebuild -license accept
```

---

## 2. Project layout

| Path | What it is |
|------|-----------|
| `capacitor.config.ts` | App id (`com.surabhikunj.voice`), name, plugin config |
| `ios/` | Native Xcode project (commit this) |
| `android/` | Native Android Studio project (commit this) |
| `src/lib/liveUpdate.js` | OTA: marks bundle good + fetches new bundles |
| `scripts/deploy-ota.mjs` | Zips the build, uploads to Supabase, publishes `version.json` |

---

## 3. Run on a simulator / device (development)

```bash
# iOS — opens Xcode, then press the ▶ Run button
npm run ios

# Android — opens Android Studio, then press the ▶ Run button
npm run android
```

Both scripts run `vite build`, copy the web assets into the native project, then
open the IDE. Pick a simulator/emulator or a connected device and Run.

> Whenever you change web code during development, re-run `npm run cap:sync`
> (or the `ios` / `android` script) to copy the fresh build in.

---

## 4. App icon & splash screen

Your branded icon lives at `public/icon.svg`. To generate all native icon/splash
sizes, install the official asset tool and run it once (and again whenever the
icon changes):

```bash
npm install -D @capacitor/assets
# Put a 1024x1024 PNG at ./resources/icon.png and (optionally) ./resources/splash.png
npx capacitor-assets generate
```

---

## 5. Submitting to the stores (per release)

These are **store releases** — needed for the very first launch and any time you
add native capabilities. Routine web changes do NOT need this (see §6).

### iOS / App Store
1. `npm run ios` to open Xcode.
2. Select the **App** target → **Signing & Capabilities** → choose your Apple
   Developer **Team**. Xcode auto-manages signing.
3. Set the **Version** and **Build** numbers.
4. Top menu: **Product → Archive**.
5. In the Organizer window: **Distribute App → App Store Connect → Upload**.
6. Go to https://appstoreconnect.apple.com → create the app listing
   (name, description, screenshots, privacy policy URL) → submit for review.

### Android / Play Store
1. Create an upload keystore (once) and keep it safe:
   ```bash
   keytool -genkey -v -keystore surabhikunj-upload.keystore \
     -alias surabhikunj -keyalg RSA -keysize 2048 -validity 10000
   ```
2. `npm run android` to open Android Studio.
3. **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)** → select
   your keystore → build the release `.aab`.
4. Go to https://play.google.com/console → create the app → upload the `.aab` to
   a release track (Internal testing first, then Production) → complete the store
   listing → submit for review.

---

## 6. Push instant updates (free OTA)

For any change that is **web-only** (React components, styles, business logic,
content) you can ship to all installed apps in minutes — no store review.

### Setup (once)
Add your **service_role** key to `.env` (Supabase → Settings → API).
It is only used locally by the deploy script and is **never** bundled into the app:
```
SUPABASE_SERVICE_ROLE_KEY=eyJ...your service role key...
```
`VITE_OTA_BASE_URL` is already set in `.env` to your Supabase Storage bucket.

### Ship an update
```bash
npm run deploy:ota          # auto-bumps the patch version
# or pin a version:
npm run deploy:ota 1.4.0
```
This will:
1. Build the web app.
2. Zip `dist/` and upload it to the public `app-bundles` bucket on Supabase
   (the bucket is created automatically the first time).
3. Publish `version.json` pointing at the new bundle.

Installed apps check `version.json` on launch; if newer, they download the
bundle and activate it on the **next** launch.

### When you STILL need a store release
- Adding/updating a native plugin (camera, push, etc.)
- Changing app permissions, name, icon, or native config
- Bumping the Capacitor/native runtime

---

## 7. Common commands

```bash
npm run cap:sync     # build web + copy into both native projects
npm run ios          # build + open Xcode
npm run android      # build + open Android Studio
npm run deploy:ota   # build + publish a free OTA web update
```
