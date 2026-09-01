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
  schema-only (website filtering has no enforcement yet — do not present
  it to users as functional).
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

## Known gaps
- Website allow/block rules (`pc_website_rules`) have a full parent UI but
  **no on-device enforcement**. See PLATFORM_LIMITATIONS.md before shipping
  this as a user-facing feature.
- iOS/Windows/macOS parental control: not implemented (Apple/Microsoft MDM
  entitlements required; see PLATFORM_LIMITATIONS.md).
