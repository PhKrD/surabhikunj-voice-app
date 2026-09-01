# Parental Control — Architecture Notes

Companion to `PLATFORM_LIMITATIONS.md`. Describes how enforcement actually
works end-to-end, and the specific defects fixed by `61_policy_integrity.sql`
plus the corresponding app-layer changes. Read this before touching
`ruleEngine.js`, `policy.js`, or the `pc_*` RLS policies.

## Data flow

```
Parent app                     Supabase (pc_* schema)                Child app (Device Owner)
───────────                    ───────────────────────               ─────────────────────────
RulesTab.jsx                                                          
  createAppRule() ────insert──▶ pc_app_rules                          
                                   │ trigger: pc_reject_protected_app_rule
                                   │ trigger: pc_bump_policy_version
                                   ▼
                                pc_children.policy_version++
                                                                       ruleEngine.js (every 2s,
                                                                       mutex-guarded)
                                                                         │
                                                        ◀───select────── resolveDeviceIdentity()
                                                                         │  (re-reads pc_devices.child_id
                                                                         │   — self-heals reassignment)
                                                        ◀───select────── fetchSchedules() / fetchAppRules()
                                                                         │
                                                                         ▼
                                                                       policy.js: resolvePolicy()
                                                                         (pure — desired state)
                                                                         │
                                                        enforcementStore.js: loadEnforcementState()
                                                                         │ (persisted applied state)
                                                                         ▼
                                                                       policy.js: diffSuspension()
                                                                         (pure — minimal native calls)
                                                                         │
                                                                         ▼
                                                                       dpc.suspendPackages() /
                                                                       dpc.unsuspendPackages()
                                                                         │
DevicesTab.jsx                 pc_devices.applied_policy_version ◀──update── reportEnforcementState()
  diagnosticChecklist()        pc_devices.enforcement_state
  derivePolicySyncState()      pc_devices.last_enforcement_at
```

## Policy resolution — conflict priority (authoritative)

Implemented in `surabhikunj-voice-kids/src/lib/policy.js`, unit-tested in
`policy.test.js`. This is the ONLY place conflict resolution should live —
do not duplicate this logic in the native layer or the parent UI.

1. **Bonus time** (parent-granted, time-boxed) overrides ALL schedules and
   app `time_limit` rules. It does not override a hard `block` rule — a
   bonus grant is "you get your normal time limits waived", not "every
   restriction is gone".
2. Among schedules active at the same moment, the most **restrictive**
   wins: `block_all` > `allow_list_only` > `block_internet`. Restrictiveness
   beats recency/creation-order so two overlapping schedules can never
   leave a device less restricted than intended.
3. An explicit `allow` app rule overrides a `block` rule for the same
   package (the parent added the allow more specifically/later).
4. A `time_limit` rule is **inert** (not blocking) whenever usage data is
   unavailable (Usage Access permission revoked) or bonus time is active.
   Fail-open here is deliberate: fail-closed would lock a child out of
   every limited app the instant a permission is revoked, which is worse
   than the limit temporarily not being enforced.
5. Protected packages (`PROTECTED_PACKAGES` in `policy.js`, mirrored in
   `protectedPackages.js` on the parent and `pc_is_protected_package()` in
   the database) can never appear in a block list, regardless of any rule.

## Reconciliation — why block/unblock used to fail

Three separate defects combined to produce "parent says blocked, device
says not blocked" and the inverse "parent deleted the rule, app stays
blocked forever":

1. **No persisted applied-state.** The old `ruleEngine.js` tracked
   `previouslyBlockedApps` in a module-level array. Every app restart lost
   it, so `diffSuspension`-equivalent logic believed nothing was suspended
   and never issued the unsuspend call for apps that actually were.
   Fixed by `enforcementStore.js` (localStorage-persisted).

2. **Stale child identity.** Enrollment wrote `childId` into localStorage
   once. `reassignDevice()` in the parent API updates `pc_devices.child_id`
   but the device never re-read it, so it kept querying the WRONG child's
   rules — finding none, and therefore enforcing none. Fixed by
   `deviceIdentity.js`, which re-reads `pc_devices` (now with a device-scoped
   `SELECT` RLS policy on `pc_children` too) every 60s and self-heals the
   local cache on mismatch.

3. **No authoritative reconcile.** Even with persisted state, if the OS-level
   suspension list ever drifted from our belief (app data cleared,
   reinstall, a build upgrade), there was no way to notice. Fixed by the
   `getInstalledPackages()` native bridge + `diffSuspension(applied, desired,
   installed)`: periodically (every 10 min, or immediately on `sync_rules`)
   we sweep the FULL installed-package list and release anything suspended
   that isn't in the desired block list, regardless of what our cache says.

Every one of these has a regression test in `policy.test.js` — see tests
named `REGRESSION: *`.

## Policy versioning

`pc_children.policy_version` is a monotonic counter, bumped by trigger on
any write to `pc_app_rules`, `pc_schedules`, `pc_screen_time_rules`, or
`pc_website_rules`. The device reports the version it actually applied to
`pc_devices.applied_policy_version`. This is what lets the parent dashboard
show a truthful `in_sync` / `syncing` / `error` / `offline` badge (see
`src/lib/policySync.js`) instead of assuming a DB row equals device state.

**Before migration 61 is applied**, these columns don't exist. Every touch
point degrades explicitly to an `'unknown'` state (never a false `in_sync`):
`policySync.isMigrationApplied()`, `deviceIdentity.js`'s
`policyColumnsMissing` flag (detects PostgREST `PGRST204` and falls back to
heartbeat-only updates).

## Command lifecycle (unchanged from migration 58)

`pc_device_commands` still drives `pending → delivered → executed|failed`,
polled every 2s + a 45s heartbeat. `sync_rules` now additionally calls
`invalidateDeviceIdentity()` and `enforceRules({ force: true })`, which
forces both a fresh identity read AND a full installed-package sweep — this
is the parent-triggered equivalent of the periodic 10-minute reconcile, so
"I just changed a rule, why hasn't it applied" has an immediate remedy.

## Lockout protection

`pc_is_protected_package()` (database, authoritative) +
`PROTECTED_PACKAGES` (device, defense-in-depth) +
`protectedPackages.js` (parent UI, instant feedback only — NOT a security
boundary, a crafted API call bypasses it and hits the DB trigger instead).
Covers: emergency dialer/telecom, core system UI/settings, the launcher,
and the VOICE Kids agent package itself. A `block_all` or `allow_list_only`
schedule additionally has the dialer + agent auto-appended to
`always_allowed_packages` via `pc_ensure_emergency_allowed()`, so a parent
cannot accidentally lock a child out of emergency calling even by omission.

## What migration 61 does NOT change

No existing table is dropped, no column removed, no existing RLS policy
replaced (only new policies added). Migrations 52–60 remain valid and
unmodified. Existing protected-package rules created before this migration
are deleted by the migration itself (see its comments) because leaving a
1-minute limit on the dialer live would be actively dangerous.
