# Platform Limitations — Parental Control Module

Honest capability matrix. A feature is only marked FULL when UI + API +
enforcement + a passing test exist together. Never trust a checkmark you
cannot find code for.

| Feature                        | Android | iOS | Windows | macOS | Web (browser) |
|---------------------------------|:-------:|:---:|:-------:|:-----:|:--------------:|
| App block / allow                | FULL (foreground + background) | NONE | NONE | NONE | NONE |
| App daily time limit              | FULL (foreground + background) | NONE | NONE | NONE | NONE |
| Schedules (block_all / kiosk)     | FULL (foreground + background) | NONE | NONE | NONE | NONE |
| Schedules (internet-only block)   | FULL (foreground + background) | NONE | NONE | NONE | NONE |
| Device lock                       | FULL — but only a real deterrent if the child device has NO lock-screen PIN/pattern set (see below) | NONE | NONE | NONE | NONE |
| Device unlock (remote)            | PARTIAL — cannot dismiss an existing PIN/pattern/password (see below) | NONE | NONE | NONE | NONE |
| Internet pause / resume           | FULL (local VPN) | NONE | NONE | NONE | NONE |
| Screen-time daily cap             | FULL (foreground + background) | NONE | NONE | NONE | NONE |
| Website allow/block list          | SCHEMA ONLY — no enforcement | NONE | NONE | NONE | NONE |
| Location tracking                 | FULL    | PARTIAL (native MDM/Screen Time API would be required) | NONE | NONE | NONE |
| Geofencing                        | FULL    | NONE | NONE | NONE | NONE |
| App usage reporting               | FULL    | NONE | NONE | NONE | NONE |
| SOS / panic button                | FULL    | NONE | NONE | NONE | NONE |
| Bonus time requests               | FULL    | NONE | NONE | NONE | NONE |
| Factory reset (remote wipe)       | FULL (Device Owner only) | NONE | NONE | NONE | NONE |
| Remote device diagnostics         | FULL (this release) | NONE | NONE | NONE | NONE |

## Why Android-only, and why Device Owner specifically

Every enforcement primitive here (`setPackagesSuspended`, `setLockTaskPackages`,
`lockNow`, `wipeData`, the local drop-all VPN) is a **Device Owner–only**
Android API. Under plain Device Admin these either throw `SecurityException`
or silently no-op. Device Owner can only be established at
factory-reset/first-boot time (QR provisioning) or via `adb shell dpm
set-device-owner` on a device with zero accounts — there is no way to grant
it after the fact without wiping the device. This is an Android platform
restriction, not a design choice we can work around.

**What happens when a device is NOT Device Owner:** every native call
degrades to `{ success: false, reason: 'not_device_owner' }` instead of
throwing or lying about success (`VoiceKidsDpcPlugin.runDeviceOwnerAction`).
`ruleEngine.js` reports this to `pc_devices.enforcement_state.last_error`,
which the parent Devices tab surfaces as "App blocking is not active on
this device" rather than showing a false "Rules active" state.

**Getting a device to actually become Device Owner is a manual, technical
step the app does NOT walk a parent through today.** `DeviceModeSetupPage.jsx`
lets a parent pick "This is my child's device" and enter a pairing code, but
that alone never grants Device Owner — Android requires either QR
provisioning at factory-reset time (not implemented — `getProvisioningPayload()`
still has a placeholder APK URL) or running, from a computer with adb, before
any account exists on the phone:
```
adb shell dpm set-device-owner com.surabhikunj.voice/.dpc.VoiceKidsDeviceAdminReceiver
```
Skipping this step is the single most common reason "nothing works" — every
lock/unlock/pause/resume/block command will fail with `not_device_owner` and
the Devices tab will show "Not enrolled", but a parent who doesn't know to
check that badge has no other signal until they read the failed-command
alert. This needs a much more prominent in-app setup flow; tracked as a TODO.

## Device lock / unlock — real Android constraints

`lockNow()` (Device Owner API) locks the screen using whatever lock-screen
security is *currently configured on the device*:
  - **If the child's phone has NO PIN/pattern/password set**, `lockNow()`
    only turns the screen off. Pressing power turns it back on with a plain
    swipe — there is no credential prompt, so the child can trivially
    dismiss the "lock" themselves. It is not a real restriction in this case.
  - **If the child's phone HAS a PIN/pattern/password set** (the normal
    state of almost every personal phone), `lockNow()` correctly requires
    that credential to dismiss — but then "Unlock Now" from the parent
    **cannot bypass it**. `setKeyguardDisabled(true)` (the only Device-Owner
    API that can disable the keyguard) only succeeds when the device has no
    secure lock screen to begin with; it cannot and must not be able to
    dismiss one that already exists — Android intentionally does not expose
    that capability to any app, Device Owner or not, since it would be a
    severe security hole.

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
