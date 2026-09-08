# Platform Limitations — Parental Control Module

Honest capability matrix. A feature is only marked FULL when UI + API +
enforcement + a passing test exist together. Never trust a checkmark you
cannot find code for.

| Feature                        | Android | iOS | Windows | macOS | Web (browser) |
|---------------------------------|:-------:|:---:|:-------:|:-----:|:--------------:|
| App block / allow                | FULL, no reset required (Accessibility soft-block; Device Owner adds a harder OS-level suspend as an optional bonus — see below) | NONE | NONE | NONE | NONE |
| App daily time limit              | FULL, no reset required (same mechanism as app block) | NONE | NONE | NONE | NONE |
| Schedules (block_all / kiosk)     | SOFT LOCK, no reset required — see "Soft lock vs. hard kiosk" below | NONE | NONE | NONE | NONE |
| Schedules (internet-only block)   | FULL, no reset required (one-time VPN consent — see below) | NONE | NONE | NONE | NONE |
| Device lock                       | FULL, no reset required (`lockNow()` works under plain Device Admin) — real deterrent only if the child device has NO lock-screen PIN/pattern set | NONE | NONE | NONE | NONE |
| Device unlock (remote)            | ADVANCED MODE ONLY — requires the optional Device Owner setup (factory reset); unavailable in the default setup at all (see below) | NONE | NONE | NONE | NONE |
| Internet pause / resume           | FULL, no reset required (local VPN + one-time consent) | NONE | NONE | NONE | NONE |
| Screen-time daily cap             | FULL, no reset required | NONE | NONE | NONE | NONE |
| Website allow/block list          | SCHEMA ONLY — no enforcement | NONE | NONE | NONE | NONE |
| Website visit / search monitoring | BEST-EFFORT (Accessibility Service, requires a manual one-time grant — see below) | NONE | NONE | NONE | NONE |
| Location tracking                 | FULL    | PARTIAL (native MDM/Screen Time API would be required) | NONE | NONE | NONE |
| Geofencing                        | FULL    | NONE | NONE | NONE | NONE |
| App usage reporting               | FULL    | NONE | NONE | NONE | NONE |
| SOS / panic button                | FULL    | NONE | NONE | NONE | NONE |
| Bonus time requests               | FULL    | NONE | NONE | NONE | NONE |
| Factory reset (remote wipe)       | FULL, no reset required (`wipeData()` works under plain Device Admin) | NONE | NONE | NONE | NONE |
| Remote device diagnostics         | FULL (this release) | NONE | NONE | NONE | NONE |

## Enforcement model: Device Admin + Accessibility (default), Device Owner (optional "Advanced" mode)

**As of this rewrite, no factory reset is required to set up parental
control at all.** The default enforcement model is:

- **Device Admin** (`DpcActions.isDeviceAdmin`) — a normal one-tap "Activate
  this device admin app?" grant on an already-set-up phone (Settings →
  triggered by the in-app setup checklist's "Activate device admin"
  button). This alone makes `lockNow()` and `wipeData()` genuinely work
  (`res/xml/device_admin_policies.xml` declares `force-lock`/`wipe-data` —
  these are legacy Device Admin policies, NOT Device-Owner-only APIs,
  contrary to how this doc used to describe them).
- **Accessibility Service** (`VoiceKidsAccessibilityService.kt`) — the
  PRIMARY app-block/schedule-enforcement mechanism. It watches
  `TYPE_WINDOW_STATE_CHANGED` events for every app (not just browsers —
  `accessibility_service_config.xml` no longer restricts `packageNames`)
  and, the instant a disallowed app comes to the foreground, calls
  `performGlobalAction(GLOBAL_ACTION_HOME)` plus shows a brief "This app is
  blocked" overlay if the optional "Draw over other apps" permission is
  granted. `PolicyEnforcer.kt` writes the desired blocked/allow-list/
  block-all state into `VoiceKidsPrefs` every enforcement pass; this
  service reads it. **Verified for real** on an emulator provisioned as
  plain Device Admin (explicitly NOT Device Owner — confirmed via
  `dumpsys device_policy` showing `Device Owner Type: -1`): a package
  marked blocked was genuinely kicked back to the launcher the instant it
  opened, logged as `VoiceKidsA11y: Blocking foreground app: ...`.
- **One-time VPN consent** (`DpcActions.hasVpnConsent`/`requestVpnConsent`)
  — the standard system "Allow VOICE to set up a VPN connection?" dialog,
  needed once for internet-pause to work.

All three are ordinary Android permission grants a parent can complete
entirely within the app's setup checklist (`SetupChecklistCard.jsx`, shown
on the child device's home screen) — no computer, no adb, no factory
reset, no QR code.

### Soft lock vs. hard kiosk

Without Device Owner, `block_all`/`allow_list_only` schedules cannot use a
true OS-level lock-task (`startLockTask()`/`setLockTaskPackages()` are
Device-Owner-only). Instead, the same Accessibility mechanism above kicks
any disallowed app back to home the moment it's opened — functionally
similar to how real consumer apps like Qustodio/Bark implement "kiosk"
enforcement, but it is a **best-effort deterrent, not an unbypassable
lock**. A technically determined child could interrupt it for a second or
two before being kicked out again, or go disable Accessibility for VOICE
under Settings entirely (the same tamper vector every non-Device-Owner
parental control app on Android has — there is no way around this without
the optional Advanced mode below).

### Optional "Advanced" mode — Device Owner (still requires a factory reset)

The original Device-Owner-only code path (`setPackagesSuspended`,
`setLockTaskPackages`/real kiosk, `setKeyguardDisabled` for
`unlockDevice`) is kept working and covered, but is entirely OPTIONAL and
not part of the default setup flow — nothing prompts a parent to do this.
When a device happens to be Device Owner (set up the old way, via QR
provisioning or `adb shell dpm set-device-owner` on a device with zero
accounts), `PolicyEnforcer.kt` additionally applies the harder OS-level
suspend/lock-task calls as a bonus layer on top of the Accessibility
soft-block, and `unlockDevice` (dismissing an EXISTING PIN/pattern) becomes
available — that specific capability needs `setKeyguardDisabled()`, which
has no Device-Admin equivalent at all and is impossible under the default
setup. The parent Devices tab's diagnostic checklist reports Device Owner
status as informational only ("Standard mode" vs. "Advanced mode active")
— its absence is never treated as an error.

**What happens when a device is missing a REQUIRED permission (Device
Admin or Accessibility):** every native call/enforcement pass degrades to
a truthful `{ success: false, reason: 'not_device_admin' }` (or simply
skips the Accessibility-based block) instead of throwing or lying about
success. `PolicyEnforcer.kt` reports this to
`pc_devices.enforcement_state`, which the parent Devices tab surfaces as
specific actionable checklist rows ("Device Admin not activated",
"Accessibility not enabled") rather than a vague failure.

## Device lock / unlock — real Android constraints

`lockNow()` works under plain Device Admin (no Device Owner/reset needed —
see the enforcement model above) and locks the screen using whatever
lock-screen security is *currently configured on the device*:
  - **If the child's phone has NO PIN/pattern/password set**, `lockNow()`
    only turns the screen off. Pressing power turns it back on with a plain
    swipe — there is no credential prompt, so the child can trivially
    dismiss the "lock" themselves. It is not a real restriction in this case.
  - **If the child's phone HAS a PIN/pattern/password set** (the normal
    state of almost every personal phone), `lockNow()` correctly requires
    that credential to dismiss — but then "Unlock Now" from the parent
    **cannot bypass it** in the default setup at all. `setKeyguardDisabled(true)`
    (the only API that can disable the keyguard) is Device-Owner-only, so
    it's available exclusively in the optional Advanced mode above, and
    even then only succeeds when the device has no secure lock screen to
    begin with — it cannot and must not be able to dismiss one that
    already exists — Android intentionally does not expose that capability
    to any app, Device Owner or not, since it would be a severe security
    hole.

**There is no way to make "remote unlock past an existing real PIN" work**
via public Android APIs. The only two honest options are: (a) require the
child's device to have no lock-screen credential and treat our own
lock/unlock as the sole gate (works, but a technically savvy child can
always just swipe past "locked" — this is a soft/UI-level restriction, not
a hard one), or (b) accept that "Unlock Now" is a no-op whenever the device
already has its own secure lock screen and document this clearly to
parents instead of implying it always works.

## Background enforcement (fixed)

Previously, schedules and per-app rules (`ruleEngine.js`/`screenTimeEngine.js`)
were only evaluated inside the WebView's JS `setInterval` loop
(`commandPoller.js`), which Android suspends once the app is backgrounded.
A schedule boundary (e.g. bedtime starting at 22:00) or a parent revoking a
rule would not actually take effect until the child happened to reopen the
app. This is now also enforced natively: `PolicyEnforcer.kt` runs inside
`VoiceKidsMonitorService` (the same foreground service that already handles
lock/unlock/pause/resume in the background) on a 4-second cadence, fetching
schedules/app-rules directly via `SupabaseRest` and calling
`DevicePolicyManager` itself — independent of whether the WebView is alive.
Keep `PolicyEnforcer.kt`'s decision logic in sync with `policy.js` (protected
package list, schedule severity order, allow-overrides-block) if either
changes.

## Website filtering — schema exists, enforcement does not

`pc_website_rules` stores allow/block domain rules and the parent UI lets
you create them, but **no enforcement mechanism reads them on-device**.
Real domain-level filtering on Android requires either:
  - a system-wide VPN doing DNS/SNI inspection (`InternetBlockVpnService`
    already establishes a VPN for internet-pause — extending it to
    selectively filter by domain is the natural next step), or
  - Android's `DevicePolicyManager` DNS-over-HTTPS provider override
    (API 28+, coarser: whole-device DNS provider, not per-domain rules).

We did not implement either in this pass because doing it wrong (e.g. a
naive DNS blocklist that HTTPS SNI or DoH trivially bypasses) would be
worse than admitting it doesn't work yet. **Do not present this feature to
end users as functional** until enforcement lands. Recommended: hide or
label the Websites tab "Coming soon" in the parent UI until implemented.

## Website visit / search monitoring — best-effort, not exhaustive

`VoiceKidsAccessibilityService` (`android/app/.../dpc/VoiceKidsAccessibilityService.kt`)
reads the address-bar text of a small list of known browsers (Chrome,
Samsung Internet, Edge, Firefox, Opera, Brave, Mi Browser, DuckDuckGo)
via Android's Accessibility API — the same technique real consumer
parental-control apps use, since there is no official "give me the
child's browsing history" API on stock Android. Rows land in
`pc_web_activity` (migration `67_web_activity.sql`), surfaced in the new
"Web Activity" tab.

**What this genuinely gives you:** for a recognized browser, once the
address bar settles after navigation, we record either the visited
domain or — for Google/Bing/DuckDuckGo/Yahoo — the decoded search query.

**What this does NOT give you, and never claim it does:**
- Only the browsers explicitly listed are recognized at all. Any other
  browser (or a browser update that renames its address-bar view-id)
  produces nothing, silently.
- Incognito/private-browsing behavior is whatever that browser chooses
  to expose through its own UI — not guaranteed captured or hidden.
- It cannot see in-app browsers (e.g. a link opened inside Instagram's
  or TikTok's own in-app WebView) — those aren't in the recognized list
  and have no stable address-bar UI to read anyway.
- Like Usage Access, enabling this requires **the parent to manually
  turn it on** under Settings > Accessibility on the child device — no
  app, Device Owner or not, can grant this to itself.
- A determined technical user can turn the accessibility toggle back off
  on the device itself; this is a monitoring signal, not a tamper-proof
  control.

Label this "best-effort" everywhere it's shown to a parent — never as a
complete browsing history.

## iOS

Apple's Screen Time / Family Controls framework (`FamilyControls`,
`ManagedSettings`, `DeviceActivity`) is the only legitimate way to build
equivalent functionality on iOS, and it requires:
  - An Apple Developer account with the Family Controls entitlement
    (manual Apple approval, not self-service)
  - A companion iOS app built in Swift (this Capacitor/React codebase
    cannot host that framework directly — it would need a native Capacitor
    plugin wrapping Swift `ManagedSettings` APIs)
  - The **parent's** device to be the one authorizing restrictions via
    Apple's Family Sharing model — a child cannot self-enroll the way the
    Android pairing-code flow works

None of this exists yet. Do not advertise iOS support.

## Windows / macOS

No parental-control-grade OS API integration exists in this codebase for
either platform. A real implementation would need:
  - Windows: Microsoft Family Safety Graph API + a native agent (Win32/UWP)
  - macOS: Apple's Screen Time API (same entitlement gate as iOS) or MDM
    (`Managed Client` / declarative device management, enterprise-only)

## What full support actually requires going forward

1. Website filtering: extend `InternetBlockVpnService` to a selective
   DNS-filtering VPN (Android's `VpnService` + a userspace DNS proxy that
   resolves against `pc_website_rules`, refusing SNI/DoH bypass by also
   blocking known DoH resolver IPs — still imperfect, must be documented as
   "best-effort" to parents, never "guaranteed").
2. iOS: separate Swift/SwiftUI companion app using `FamilyControls` +
   `ManagedSettings`, sharing the same Supabase backend and `pc_*` schema.
   This is a multi-week project requiring Apple's entitlement approval.
3. Windows/macOS: out of scope until there is demand; no credible free-tier
   API exists for either that isn't MDM-gated.
