# surabhikunj-voice-app — Agent Notes

## Stack
- React 19 + Vite 8 + Tailwind CSS v4, Capacitor 8 (Android/iOS shells)
- Supabase Postgres + RLS, 60+ SQL migrations in `supabase/`
- Zustand, React Router v7, Framer Motion, Recharts

## Build & test
```bash
npm install
npm run build     # vite build → dist/
npm run lint      # must report 0 errors (React Compiler advisories are warnings)
npm test          # unit tests only (node --test src/**/*.test.js)
npm run test:smoke  # live Supabase smoke test (needs network + .env)
npm run apk       # signed RELEASE apk → ~/Desktop (needs android/keystore.properties)
npm run deploy:ota  # bump version, build, publish OTA bundle
```
See DEPLOYMENT.md for what needs an APK vs an OTA vs a settings change.

## Launch architecture (October 2026)
- **Remote control without reinstalling**: `src/store/configStore.js` reads
  `app_platform_config` (migration 73): min/recommended APK `versionCode`,
  maintenance mode, APK link, feature flags. `components/system/AppGate.jsx`
  shows forced-update / maintenance screens; `Banners.jsx` shows update,
  offline, admin notice (`organization_settings.content`) bars. Fail-open:
  missing table/offline = app runs normally. Platform admins
  (`platform_admins`) bypass maintenance.
- **Native calls must go through `src/lib/native.js` (`hasPlugin()`)**. OTA
  bundles reach OLD APKs; an unguarded call to a plugin an older APK lacks
  crashes it. APKs ≤ build 2 have no App plugin (treated as versionCode 2).
- **OTA** (`src/lib/liveUpdate.js`): manifest `minNativeVersionCode`
  (package.json `ota.minNativeVersionCode`), apply on next launch,
  `markBundleHealthy()` after first render (otherwise capgo rolls back).
- **Signing**: release APKs use the original debug certificate (copied to
  `~/Documents/VOICE-signing/voice-release.keystore`) so they install over
  the APKs users already have. Never change the key.
- **Zustand v5**: a selector that returns a new object/array each call causes
  an infinite render loop (React #185). Use `useShallow` (see `useGate()`).
- **Dates**: never `toISOString().split('T')[0]` for "today" — it is the UTC
  date (wrong before 05:30 IST). Use `src/lib/dates.js`.
- **Design system**: tokens in `src/index.css` (`--color-*`, `--surface*`,
  `--shadow-*`, `--radius-*`, `.text-title` …); components in
  `src/components/ui/` (Button/IconButton/buttonClass, Field: AppInput/
  AppSelect/AppTextarea, Card, Badge/StatusBadge, Avatar, Dialog +
  `confirm()` from `store/dialogStore`, States: EmptyState/ErrorState/
  LoadingState/Skeleton, DynamicIcon). Use `friendlyError()` for any error
  shown to a user. No `window.confirm`.
- **Icons by name** (nav, categories): `getIcon()`/`<DynamicIcon>` from the
  registry in `src/lib/icons.js` — never `import * as Icons from 'lucide-react'`
  (pulls 625 kB). Add new names to the registry.
- Errors are reported to `client_errors` (`src/lib/errorReporter.js`); never
  paint stack traces over the UI.

## Database migrations
No automated migration runner exists. Every `supabase/NN_*.sql` file is
applied manually by pasting into the Supabase SQL Editor, in numeric order.
This repo does not store a DB password or Supabase access token locally —
do not attempt to run DDL via the JS client (service-role key only grants
PostgREST access, not raw SQL execution). Live status (probed October 2026):
everything through 72 is applied EXCEPT 49 (and the optional 50, which
overwrites configured Sadhana marks — do not run it casually); 73 is new.

## Parental Control module (`pc_*` schema)
See:
- `supabase/ARCHITECTURE_PARENTAL_CONTROL.md` — enforcement data flow,
  conflict-resolution priority order, why block/unblock used to fail and
  how it's fixed, policy versioning.
- `PLATFORM_LIMITATIONS.md` — capability matrix by OS; what is real vs.
  best-effort, and the "Where enforcement decisions are made" section —
  read it before touching anything under `dpc/` or `src/lib/*Engine.js`.
- **The policy engine is native**: `android/.../dpc/PolicyEnforcer.kt`
  (mirrors the pure, unit-tested `src/lib/policy.js` +
  `src/lib/screenTimePolicy.js`). Keep the three in sync. The JS
  `ruleEngine.js`/`screenTimeEngine.js` only detect revocation, nudge the
  native engine (`dpc.enforceNow()`) and read its snapshot
  (`dpc.getEnforcementSnapshot()`, polled by
  `src/lib/useEnforcementSnapshot.js`) — they must never re-derive
  enforcement decisions or publish `enforcement_state` themselves.
- `supabase/70_qustodio_parity.sql` — per-weekday daily limits +
  `limit_action`, `pc_restricted_times` (weekly hour grid),
  `pc_app_rules.alert_on_use`/`daily_limits_by_dow`, web 'alert' action,
  `app_opened`/`website_alert` alert types, `device_owner_mode` derived from
  the device's own `enforcement_state` report, policy-version bump triggers
  for the 69 tables, and the `pc_alerts` → `notify()` parent push bridge.
  Parent UI: `src/pages/parental-control/tabs/{SummaryTab,UsageTab,
  RestrictedTimesTab,RulesTab,SchedulesTab}.jsx`.
- `supabase/61_policy_integrity.sql` — policy versioning, duplicate-rule
  prevention, lockout protection (dialer/settings/launcher/agent can never
  be blocked), device self-heal RLS. Additive only; migrations 52–60 stay
  valid. Applied to the live database (confirmed October 2026). The app
  still degrades gracefully on a database without it (see
  `src/lib/policySync.js` `isMigrationApplied()`).
- Companion app: `../surabhikunj-voice-kids` (child Android agent, Device
  Owner). Its `AGENTS.md` documents the on-device policy engine.

## Single-app architecture (Parent mode / Child mode)
There is only ONE installable app (`com.surabhikunj.voice`). The former
standalone "VOICE Kids" child agent (`surabhikunj-voice-kids/`) was merged
into this repo:
- Native: `android/app/src/main/java/com/surabhikunj/voice/dpc/` — all
  Device Owner enforcement code, repackaged from `com.surabhikunj.voice.kids`
  to `com.surabhikunj.voice.dpc`. Registered in `MainActivity.java`.
  `AndroidManifest.xml` carries the merged permission/receiver/service set.
- JS: `src/lib/{policy,ruleEngine,commandPoller,deviceIdentity,
  enforcementStore,dpcPlugin,usageStatsPlugin,locationPlugin,deviceStore,
  screenTimeEngine,bonusTimeApi,sosApi,requestApi}.js` — the on-device
  policy engine, ported verbatim (see `surabhikunj-voice-kids/AGENTS.md`
  for its own internals, which still apply).
- UI: `src/pages/child-device/*.jsx` (full-screen, no AppLayout nav by
  design — a "locked" screen with visible navigation would not actually be
  locked) + `src/components/child-device/ChildDeviceShell.jsx`.

**Device Mode** (`src/store/deviceModeStore.js`, localStorage-only) decides
which experience THIS physical device boots into: `'unset'` (default —
behaves exactly like the org app always has), `'parent'`, or `'child'`.
This is a UX routing hint ONLY — it grants no privilege. Every actual
read/write is still authorized server-side by the same `pc_*` RLS policies
regardless of what this flag says. Setting mode to `'child'` makes
`App.jsx` mount `ChildDeviceShell` instead of the normal org `<Routes>`
tree, permanently (until `useDeviceModeStore.getState().reset()`), so a
supervised child's device never shows org login again.

**IMPORTANT — Device Owner re-provisioning**: any device previously
provisioned as Device Owner for the OLD `com.surabhikunj.voice.kids`
package must be re-provisioned for `com.surabhikunj.voice` — Android ties
Device Owner status to the exact package name at provisioning time. See
`PLATFORM_LIMITATIONS.md`.

`surabhikunj-voice-kids/` still exists on disk as the pre-merge reference
implementation. It is NOT deleted (data-safety default) but is superseded
— do not add new features there.

## Emulator smoke-testing the native engine
The emulator needs a real device session in `VoiceKidsPrefs`
(`shared_prefs/voice_kids_session.xml`: supabase_url, anon_key, device_id,
child_id, org_id, access_token, refresh_token). Create a throwaway child +
device + pairing code with the service-role key (mirror
`pc-generate-pairing-code`), redeem it via the `pc-redeem-pairing-code`
edge function, write the XML with `adb shell run-as com.surabhikunj.voice`,
then start the app once and `adb shell am broadcast -a
android.intent.action.BOOT_COMPLETED -p com.surabhikunj.voice` to start
`VoiceKidsMonitorService`. Grant the three permissions from adb:
`settings put secure enabled_accessibility_services
com.surabhikunj.voice/com.surabhikunj.voice.dpc.VoiceKidsAccessibilityService`,
`settings put secure accessibility_enabled 1`,
`appops set com.surabhikunj.voice GET_USAGE_STATS allow`. Watch
`logcat -s VoiceKidsPolicy VoiceKidsA11y VoiceKidsMonitor`. Delete the temp
child (cascades) + its auth user afterwards. Note `adb install -r` can reset
the accessibility toggle; the emulator clock also drifts, so device-written
timestamps are unreliable there.

## Sadhana scoring, sheet model & export
- **Scoring rule types** (`src/lib/trackerScoring.js`): `boolean`, `band`,
  `threshold`, `range`, `penalty`, `formula`. Editor UI in
  `src/pages/trackers/TrackerSettings.jsx`.
  - `band` — explicit `From–To → marks` windows
    (`config.bands: [{from, to, pts}]`). Both ends INCLUSIVE, first match
    wins, blank bound = unbounded that side, `config.default_pts` when
    nothing matches. This is the type to use for "3:30 to 3:45 → 25".
  - `threshold` — legacy ordered cutoffs; still supported. The editor has
    a "Switch to From–To bands" button (`tiersToBands()`) that converts
    tiers to equivalent bands.
  - **Comparison is type-aware, never lexicographic.** `parseComparable()`
    coerces "04:30"/"4:30" to minutes and numerics to numbers. This fixed
    a real bug where tiers typed without a leading zero ("4:30") sorted
    after "04:15" as strings and scored 0 instead of full marks. Do NOT
    reintroduce a raw string `<=` on rule bounds.
  - `config.midnight_pivot` (hours, default off) pushes times before the
    pivot into the next day so a bed time of 00:30 orders AFTER 23:00.
    Exposed as the "times after midnight are later" checkbox on time
    fields.
- **`src/lib/trackerSheet.js` — the shared LAYOUT model.**
  `buildSheetModel()` returns `{ groupHeader, columns, maxRow, rows,
  totals }`. `TrackerSpreadsheet.jsx` renders it AND the exporters emit
  it, so an exported file can never drift from what is on screen. Row
  objects carry `fieldTotals/groupTotals/columnTotals` because that shape
  is persisted verbatim as `tracker_entries.score_detail`.
  Uses relative (not `@/`) imports so it runs under `node --test`.
- **`src/lib/trackerExport.js`** — CSV / `.xlsx` / PDF emitters over one or
  more "sections" (1 = a devotee's own sheet, N = a counsellor's whole
  group, which become N worksheets / N PDF chapters plus a comparison
  summary). `write-excel-file` and `jspdf` are **dynamically imported** so
  they stay out of the initial bundle — keep it that way.
  - jspdf: use the NAMED `jsPDF` export; its `default` is a namespace
    object under some interop paths.
  - write-excel-file rejects a numeric `format` on a `String` cell, so
    empty cells must drop the format (see `numCell()`).
- **`src/lib/fileShare.js`** — writes to `Directory.Documents` then opens
  the native share sheet; falls back to Web Share API / `<a download>` on
  web. A plain blob download silently does nothing in the Android WebView.
- **`src/lib/haptics.js`** — `tap/select/heavy/success/warning/error`.
  Fire-and-forget, never throws, respects `prefers-reduced-motion`.
  `components/ui/Button.jsx` calls `tap()` (or `heavy()` for
  `variant="danger"`) on every click, so most of the app gets haptics for
  free; pass `haptic={false}` to opt out.
- **Native plugin caveat**: `@capacitor/filesystem`, `@capacitor/share`
  and `@capacitor/haptics` are NATIVE. An OTA-only bundle ships the JS
  shim but not the native half, so both modules guard with
  `Capacitor.isPluginAvailable(...)`. Export needs a **new APK**, not just
  an OTA push.

## Known gaps
- Website "block"/"alert" rules (`pc_website_rules`, categories) ARE
  enforced on-device now, via accessibility service (browser URL blocking)
  and optionally via a local DNS-filtering VPN
  (`InternetBlockVpnService`'s `MODE_DNS_FILTER` + `DnsFilterEngine.kt`,
  driven by `PolicyEnforcer.kt`) — best-effort, bypassable by a browser
  hardwired to a DoH resolver outside the short mitigated IP list. "Allow"
  rules override category blocks and are the exception list for "block
  unknown websites". See PLATFORM_LIMITATIONS.md "Website filtering"
  before presenting this as guaranteed.
- Not implemented vs. Qustodio: calls & SMS monitoring, YouTube in-app
  monitoring, AI content alerts.
- iOS/Windows/macOS parental control: not implemented (Apple/Microsoft MDM
  entitlements required; see PLATFORM_LIMITATIONS.md).
- A child device can optionally be linked to a real org member account
  (`pc_children.linked_profile_id`, see `68_child_org_link_and_tamper.sql`)
  so the same device gets both the full org app (Sadhana, cleanliness,
  etc.) AND parental-control supervision — see PLATFORM_LIMITATIONS.md
  "Child device can also use org features" and `src/App.jsx`. Unlinked
  children keep the original fully-isolated device-only experience.

## Parental control production hardening (October 2026)
Read `PARENTAL_CONTROL_ARCHITECTURE.md` (engine, precedence, offline,
lifecycle), `PARENTAL_CONTROL_SECURITY.md`, `PARENTAL_CONTROL_QA.md`.
- Native tests: `cd android && ./gradlew :app:testDebugUnitTest` —
  `PolicyRules.kt` holds the pure time/geofence logic; keep it in sync with
  `src/lib/policy.js` / `screenTimePolicy.js` (cross-midnight routines belong
  to the night they START; parent "Lock now" beats extra time).
- Never hard-code launcher/dialer/keyboard packages: use `EssentialApps.kt`.
- Device-written rows go through `Outbox.kt` (UUID id, idempotent, queued
  offline). Don't call `SupabaseRest.insert` directly for alerts/SOS/requests.
- Native has its OWN Supabase session (`pc-device-session` edge function,
  deployed). Never push WebView tokens over an independent native session.
- Approving time = `grantExtraTime()` (desired state). A bare
  `grant_bonus_time` command is cancelled by the next pass.
- Migration **74_parental_control_hardening.sql** (RLS child_id checks,
  schedule read leak, push cool-downs) — dry-run verified, NOT yet applied.
- Hidden child diagnostics: tap the name on the child home screen 7×.
- Emulator: Android 17 refuses `am broadcast BOOT_COMPLETED` from adb;
  enabling Accessibility starts the monitor service by itself now. The
  display sleeps → engine uses its idle cadence (60 s reads); wake it with
  `input keyevent KEYCODE_WAKEUP` before timing anything.

## Lock / pause / extra time are DESIRED STATE, not commands (migration 72)
`pc_children.parent_lock_active`, `internet_pause_active` and
`bonus_expires_at` hold the parent's INTENT. `PolicyEnforcer.loadInputs()`
reads the child row on every pass and `applyDesiredState()` mirrors these
into `VoiceKidsPrefs`, so the device converges whenever it is next online.

This replaced a fire-and-forget model where those four controls existed
only as `pc_device_commands` rows with a 90s `expires_at`. If the device
was offline/asleep/force-stopped when the parent tapped the button, the
command was never applied and — because the resulting bit lived only in
SharedPreferences — nothing could reconcile it afterwards. Devices got
stuck locked with "Unlock" appearing to do nothing.

Rules when touching this:
- `setParentLock`/`setInternetPause`/`grantExtraTime`/`revokeExtraTime` in
  `parentalControlApi.js` write the child row FIRST (durable), then send
  the command as a fast path. Never send only the command.
- The parent UI must read lock/pause from the CHILD ROW, not from
  `pc_devices.enforcement_state` — the report is stale while a device is
  offline. Only automatic locks (`daily_limit`, `restricted_time`,
  `schedule`) come from the report.
- `enforcement_state.internet_paused` is true whenever ANY lock is active
  (a parent lock's action is `lock_device`, whose `pausesInternet` is
  true). Only `manual_internet_pause` means the parent paused it.
- `applyDesiredState()` checks `childRow.has(...)` so a pre-72 database
  keeps the old command behaviour; `setDesiredState()` catches the missing
  column (42703/PGRST204) and falls back to command-only.

## Recent Parental Control Updates (Migration 71+)
- **Parent PIN protection**: `SettingsGuard.kt` + `PinGateActivity.kt` prevent
  children from disabling Device Admin, Accessibility, Usage Access, or VPN
  without entering the parent's PIN. The guard is triggered when the child
  opens protected Settings screens.
- **VPN opt-in**: VPN filtering is now off by default (`vpn_filtering_enabled`).
  Web filtering primarily works via the accessibility service (browser URL
  blocking). Parents can opt into VPN filtering for stronger DNS-level blocking.
- **Sequential permission onboarding**: `PermissionWizardPage.jsx` guides
  children through granting Device Admin, Accessibility, and Usage Access
  permissions after enrollment.
- **Redesigned UI**: Parent dashboard, child detail page, and all child-facing
  screens now use a modern design with gradient headers, rounded-3xl corners,
  and consistent spacing matching the child home screen aesthetic.
- **SOS button fix**: Fixed tap-swallowing issue where the progress SVG overlay
  prevented the HOLD button from responding.
- **Web policy engine**: Shared `WebPolicy.kt` for consistent DNS and browser-URL
  blocking logic across VPN and accessibility service.
