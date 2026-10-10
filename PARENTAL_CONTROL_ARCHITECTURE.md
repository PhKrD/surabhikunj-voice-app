# Parental Control: Architecture (Android, standard mode)

Standard mode needs **no factory reset, no computer, no Device Owner**: the
child installs the same VOICE APK, picks "I'm a child", enters the pairing
code and completes the permission wizard. Device Owner ("advanced mode")
remains an optional extra layer and is never part of onboarding.

Companion docs: `PLATFORM_LIMITATIONS.md` (what is full vs best-effort),
`PARENTAL_CONTROL_SECURITY.md`, `PARENTAL_CONTROL_QA.md`,
`supabase/ARCHITECTURE_PARENTAL_CONTROL.md` (policy versioning history).

## Data flow

```
Parent app (React)                Supabase (pc_* + RLS)                 Child phone (native, no WebView needed)
──────────────────                ─────────────────────                 ───────────────────────────────────────
Rules / Routines / Websites  ──▶  pc_app_rules, pc_schedules, …   ─┐
                                  trigger bumps                     │   VoiceKidsMonitorService (foreground)
                                  pc_children.policy_version        │     adaptive tick ─▶ PolicyEnforcer.enforce()
Lock / Pause / Extra time    ──▶  pc_children.parent_lock_active,   ├──▶    reads child row (8 s screen-on / 60 s off)
  (DESIRED STATE, durable)        internet_pause_active,            │       refetches policy tables only on version change
                                  bonus_expires_at                  │       evaluates locally EVERY tick (also offline)
  + fast-path command        ──▶  pc_device_commands (90 s expiry) ─┘       writes desired state ─▶ VoiceKidsPrefs
                                                                         VoiceKidsAccessibilityService
Alerts tab / push      ◀── notify() ◀── pc_alerts ◀── Outbox ◀─────────     window change ─▶ allowed? ─▶ BlockedActivity
Devices tab (health)   ◀──────────── pc_devices.enforcement_state ◀────     InternetBlockVpnService (pause / DNS filter)
                                                                         TamperGuard / SettingsGuard / SosReporter
```

## One policy engine

`android/.../dpc/PolicyEnforcer.kt` is the only place that decides what the
child may do. Its pure time/place logic lives in `PolicyRules.kt`
(JVM-tested in `android/app/src/test/.../PolicyRulesTest.kt`); the JS
`src/lib/policy.js` + `screenTimePolicy.js` are the unit-tested reference
mirrors used by the UI. The WebView never makes enforcement decisions.

### Precedence (highest first)

1. **System-essential apps are never blocked**: every launcher, dialer,
   in-call/emergency screen, keyboard, permission dialog and VOICE itself,
   resolved **on the device** (`EssentialApps.kt`), not a Pixel-only list.
   Emergency calling always works.
2. **Parent "Lock now"**: beats everything below, including extra time.
3. **Extra time**: suspends routines, restricted hours, the daily limit
   and app time limits. It does **not** lift an explicit app block.
4. **Routines** (most restrictive wins: block_all > allow_list_only >
   block_internet). A cross-midnight routine belongs to the night it
   starts ("Mon–Fri 22:00–06:00" is on at 02:00 Saturday, off at 02:00
   Monday).
5. **Restricted-time grid** (hour cells).
6. **Daily screen-time limit** (per weekday; lock apps / lock phone /
   alert only).
7. **App rules**: allow overrides block; time limits block once reached
   (0 min on a weekday = blocked that day; no rule = no limit).
8. **Internet pause** (manual, persists until resumed) keeps internet apps
   off screen; with VPN consent the tunnel also stops background traffic.
   VOICE is excluded from the tunnel, so it always hears "Resume".

Usage is counted from the resume/pause **event stream since local
midnight** (`UsageStatsHelper.tallyEvents`), the same source as Digital
Wellbeing; the daily aggregate API it replaced leaked yesterday's evening
into the morning on many phones. Fails **open** without Usage access.

## Offline-first

- The last successfully fetched policy is persisted (`policy_inputs_v1`)
  and enforced when the network is down, so blocks, bedtime start/end,
  limits and extra-time expiry all happen offline. Verified on the
  emulator in aeroplane mode.
- Lock / pause / extra time are durable rows on `pc_children`; a phone that
  was offline converges on its next read (measured: lock applied 13 s after
  reconnect).
- Alerts, SOS, geofence events and child requests go through `Outbox.kt`:
  client-generated UUID, sent now or queued, retried on reconnect,
  idempotent (a 409 on the id counts as delivered), `created_at` stamped at
  the moment it happened.

## Lifecycle and reliability

| Event | What restarts supervision |
|---|---|
| Reboot | Accessibility service bind → `onServiceConnected` starts the monitor; `BOOT_COMPLETED` (+ OEM quick-boot) as backup |
| VOICE updated | `MY_PACKAGE_REPLACED` |
| Process killed | `START_STICKY` + accessibility rebind; VPN rebuilds its mode from prefs (it used to restart in block-all and cut the internet) |
| Network back | `NetworkCallback` → fresh read + outbox flush |
| Screen on | fresh read immediately |
| Extra time / routine ends | tick scheduled exactly at that moment |

Foreground-service type falls back location → dataSync, because Android
refuses some types depending on how the service was started.

## Battery / network budget

| | Before | Now |
|---|---|---|
| Network calls while screen off | ~3 every 4 s, all day (~65 k/day) | 1 read/min + 1 heartbeat/min |
| Enforcement report | PATCH every 4 s | on change, else every 3 min |
| Location rows | same fix re-inserted every minute | new fix that moved ≥ max(25 m, accuracy), else every 15 min |
| Usage recount | every 4 s | cached 15 s |

## Sessions

At pairing, the WebView and native layer used to share one refresh token.
Supabase rotates refresh tokens, so whichever side refreshed second reused
a spent token and Supabase revoked the session; the phone then went quiet.
Now native gets its **own** session from `pc-device-session` (edge
function), and `VoiceKidsLocationPlugin.updateSession` ignores the WebView's
tokens once native is independent. Refresh is serialised across threads; a
rejected refresh token is flagged (`session_invalid_since`) and the app
re-provisions on next open.

## Child experience

`BlockedActivity` (native, instant): reason (app blocked, app limit,
daily limit, routine with its name, restricted time, internet paused,
website, locked), "until 6:00 AM", today's usage, then **Ask for more
time** (15/30/60) or **Ask to unblock** (structured app/site, approval adds
the allow rule), **Hold for SOS** (2 s, so a pocket tap can't fire it),
**Emergency call**, **Go home**. Closes itself when the restriction
lifts. 15- and 5-minute warnings before each limit, once per day each.

## Parent experience

- Durable controls with honest offline wording (Command Center).
- Extra time +5/+10/+15/+30/+60 or custom; adds to time still running.
- Approving a request grants time as desired state (previously the next
  pass cancelled it within seconds).
- `ProtectionHealthCard`: score, Strong / Needs attention / Critical /
  Not confirmed, built only from the phone's own recent report; each gap
  explains why, what stops, how to fix, plus manufacturer steps
  (Xiaomi/Redmi/POCO, Vivo, Oppo, Realme, OnePlus, Samsung).
- Pushes for repeated alerts are rate-limited server-side (migration 74);
  every alert still appears in the Alerts list.

## Diagnostics

Child home screen → tap the name 7 times → **Supervision diagnostics**:
permissions, foreground service, last evaluation, policy source
(live/cached), foreground app, active restriction and its end, queued
reports, session state, last command, last location. Read-only, no tokens.
