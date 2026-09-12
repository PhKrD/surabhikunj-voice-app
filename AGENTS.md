# surabhikunj-voice-app — Agent Notes

## Stack
- React 19 + Vite 8 + Tailwind CSS v4, Capacitor 8 (Android/iOS shells)
- Supabase Postgres + RLS, 60+ SQL migrations in `supabase/`
- Zustand, React Router v7, Framer Motion, Recharts

## Build & test
```bash
npm install
npm run build     # vite build → dist/
npm run lint
node --test $(find src -name "*.test.js" -not -path "*/node_modules/*")
```
`npm test` also runs `smoke_test.mjs`, which needs live network/Supabase
credentials and will fail offline — run the `node --test` glob above for a
pure unit-test signal.

## Database migrations
No automated migration runner exists. Every `supabase/NN_*.sql` file is
applied manually by pasting into the Supabase SQL Editor, in numeric order.
This repo does not store a DB password or Supabase access token locally —
do not attempt to run DDL via the JS client (service-role key only grants
PostgREST access, not raw SQL execution).

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
  valid. **Not yet applied to the live database as of this writing** — the
  app degrades gracefully without it (see `src/lib/policySync.js`
  `isMigrationApplied()`), but device diagnostics show `'unknown'` sync
  state until it's run.
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
