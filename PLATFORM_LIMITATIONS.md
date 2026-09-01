# Platform Limitations — Parental Control Module

Honest capability matrix. A feature is only marked FULL when UI + API +
enforcement + a passing test exist together. Never trust a checkmark you
cannot find code for.

| Feature                        | Android | iOS | Windows | macOS | Web (browser) |
|---------------------------------|:-------:|:---:|:-------:|:-----:|:--------------:|
| App block / allow                | FULL    | NONE | NONE | NONE | NONE |
| App daily time limit              | FULL    | NONE | NONE | NONE | NONE |
| Schedules (block_all / kiosk)     | FULL    | NONE | NONE | NONE | NONE |
| Schedules (internet-only block)   | FULL    | NONE | NONE | NONE | NONE |
| Device lock / unlock              | FULL    | NONE | NONE | NONE | NONE |
| Internet pause / resume           | FULL (local VPN) | NONE | NONE | NONE | NONE |
| Screen-time daily cap             | FULL    | NONE | NONE | NONE | NONE |
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
