# Platform Limitations — Parental Control Module

Honest capability matrix. A feature is only marked FULL when UI + API +
enforcement + a passing test exist together. Never trust a checkmark you
cannot find code for.

| Feature                        | Android | iOS | Windows | macOS | Web (browser) |
|---------------------------------|:-------:|:---:|:-------:|:-----:|:--------------:|
| App block / allow                | FULL, no reset required (Accessibility soft-block; Device Owner adds a harder OS-level suspend as an optional bonus — see below) | NONE | NONE | NONE | NONE |
| App daily time limit (same every day OR per weekday) | FULL, no reset required (same mechanism as app block; needs Usage access) | NONE | NONE | NONE | NONE |
| "Alert me when this app is used" | FULL, no reset required (Accessibility foreground events → `app_opened` alert, rate-limited 30 min/app) | NONE | NONE | NONE | NONE |
| Routines / schedules (block_all / allow-list) | SOFT LOCK, no reset required — see "Soft lock vs. hard kiosk" below | NONE | NONE | NONE | NONE |
| Routines (internet-only block)    | FULL, no reset required (one-time VPN consent — see below) | NONE | NONE | NONE | NONE |
| Restricted times (weekly hour grid) | SOFT LOCK, no reset required — same mechanism as routines; `lock_device` additionally calls `lockNow()` once on entry | NONE | NONE | NONE | NONE |
| Daily screen-time limit (per weekday, lock navigation / lock device / alert only) | FULL, no reset required — enforced natively (`PolicyEnforcer.kt`); needs Usage access | NONE | NONE | NONE | NONE |
| Device lock ("Lock now")          | FULL, no reset required — PERSISTENT: every app except dialer/VOICE is kept off-screen until "Unlock" (Accessibility soft-lock) + one `lockNow()` (Device Admin). The screen-off part is a real deterrent only if the child device has NO lock-screen PIN/pattern set | NONE | NONE | NONE | NONE |
| Device unlock (remote)            | FULL for releasing OUR lock, no reset required. Dismissing an EXISTING PIN/pattern the child set is ADVANCED MODE ONLY (Device Owner, factory reset) — see below | NONE | NONE | NONE | NONE |
| Internet pause / resume           | FULL, no reset required (local VPN + one-time consent). Persistent until resumed — a routine ending never silently undoes a manual pause | NONE | NONE | NONE | NONE |
| Extra time ("Give extra time")    | FULL, no reset required — pauses every limit/routine/restriction/parent lock until it expires | NONE | NONE | NONE | NONE |
| Parent push notifications for alerts | FULL (DB trigger → `notify()` backbone → push/in-app; migration 70) | n/a | n/a | n/a | n/a |
| Website allow/block/alert (categories + individual sites) | BEST-EFFORT enforcement (DNS-filtering VPN, no reset required — see below); bypassable by hardwired DoH resolvers outside the mitigated list. 'Alert' resolves normally and raises a rate-limited `website_alert` | NONE | NONE | NONE | NONE |
| Website visit / search monitoring | BEST-EFFORT (Accessibility Service, requires a manual one-time grant — see below) | NONE | NONE | NONE | NONE |
| Location tracking                 | FULL    | PARTIAL (native MDM/Screen Time API would be required) | NONE | NONE | NONE |
| Geofencing                        | FULL    | NONE | NONE | NONE | NONE |
| App usage reporting               | FULL    | NONE | NONE | NONE | NONE |
| SOS / panic button                | FULL    | NONE | NONE | NONE | NONE |
| Bonus time requests               | FULL    | NONE | NONE | NONE | NONE |
| Factory reset (remote wipe)       | FULL, no reset required (`wipeData()` works under plain Device Admin) | NONE | NONE | NONE | NONE |
| Remote device diagnostics         | FULL (this release) | NONE | NONE | NONE | NONE |
| Tamper detection (Accessibility/Device Admin turned off) | DETECTION + ALERT + AUTO-LOCK, no reset required — see below. Cannot PREVENT it, only react. | NONE | NONE | NONE | NONE |
| Child device can also use org features (Sadhana, cleanliness, etc.) | FULL, when the child is linked to a real VOICE member account — see below | N/A | N/A | N/A | N/A |

## Where enforcement decisions are made (read this first)

`android/.../dpc/PolicyEnforcer.kt` is THE policy engine. It runs inside
`VoiceKidsMonitorService` every 4 seconds regardless of whether the WebView is
alive, reads every `pc_*` policy table (cached until `pc_children.policy_version`
changes — one cheap GET per pass), and writes the desired state into
`VoiceKidsPrefs` for `VoiceKidsAccessibilityService` to enforce. Lock priority
(mirrors `src/lib/screenTimePolicy.js resolveLockState`):

  bonus/extra time  >  parent "Lock now"  >  active routine  >  restricted-time
  cell  >  daily limit reached

The JS layer (`src/lib/ruleEngine.js`, `screenTimeEngine.js`) no longer makes
enforcement decisions — it only detects revocation/reassignment, nudges the
native engine (`dpc.enforceNow()`) after a command, and reads
`dpc.getEnforcementSnapshot()` to show the matching child-facing screen
("Time's up for today" / "Not now" / "Screen time paused" / "Locked by your
parents"). The earlier JS engine still ran the pre-rewrite Device-Owner-only
model and kept reporting `last_error: not_device_owner` on healthy Device
Admin devices — that was the red "Enforcement error" parents used to see.

**Qustodio parity (as of migration 70), what is NOT covered:** Calls & SMS
monitoring, YouTube in-app monitoring, and AI/social content alerts are not
implemented. Everything else in Qustodio's Android rule set (daily limits per
weekday with lock navigation/lock device/alert-only, restricted-times grid,
routines, games & apps with per-app limits + "alert when used", web filtering
categories with allow/alert/block + safe search + unsupported/unknown-site
blocking, places/geofences with arrive/leave alerts, panic button, extra time,
pause internet, lock device, activity summary/timeline, parent push
notifications) has an equivalent here, enforced without a factory reset.

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

- **Usage access** (`UsageStatsHelper.hasUsageAccess`) — Settings > Apps >
  Special app access > Usage access. Required for the daily screen-time
  limit and per-app time limits (they fail OPEN without it — never lock a
  child out because a permission is missing). Listed as required in the
  setup checklist.

All four are ordinary Android permission grants a parent can complete
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

## Website filtering — browser-level by default, VPN optional

There are two independent enforcement paths. Both ask the same question
through the same code (`android/.../dpc/WebPolicy.kt`, mirrored and
unit-tested as `src/lib/webPolicy.js` — keep the two in sync).

### 1. Browser address-bar blocking — the DEFAULT, no VPN

`VoiceKidsAccessibilityService` already reads the browser's own address
bar for activity logging; it now also evaluates the host against
`WebPolicy` and, on a block, sends the child straight back out of the page
(`GLOBAL_ACTION_BACK`) with a `BlockOverlay` explaining why.

- **Needs no VPN, no VPN consent, and does not touch the device's DNS.**
  Nothing else on the phone can break as a side effect.
- Works in incognito/private browsing — it reads what's on screen.
- Blocking a domain blocks its subdomains (`youtube.com` covers
  `www.youtube.com`, `m.youtube.com`, ...).
- **Limits:** only the browsers in `BROWSER_URL_BAR_IDS` (Chrome, Firefox,
  Samsung Internet, Edge, Opera, Brave, Mi Browser, DuckDuckGo) — turn on
  "Block unsupported browsers" to close that. It cannot see inside a
  non-browser app, and a browser UI redesign can silently break the
  address-bar read. There is a sub-second window between the page starting
  to load and the block firing.

### 2. Local DNS-filtering VPN — OPT-IN, off by default

`pc_website_filter_settings.use_vpn` (migration 71). Same technique
consumer DNS filters like DNS66/AdGuard use without root:

- Only DNS-port (53) UDP traffic — plus a short list of known public DoH
  resolver IPs, for the mitigation below — is routed into the tunnel.
  Every other packet bypasses it entirely.
- A blocked domain gets an immediate synthetic NXDOMAIN. Everything else
  is forwarded to the **underlying network's own resolvers** (read from
  the non-VPN network's `LinkProperties`), falling back to 1.1.1.1 /
  8.8.8.8 / 9.9.9.9 in turn, with SERVFAIL — never silence — if they all
  fail.
- Also covers non-browser apps, which path 1 cannot.
- Never runs at the same time as a `block_internet` schedule or an
  internet pause (only one VPN mode can hold the single tunnel Android
  allows an app); `PolicyEnforcer` coordinates this.

**Why it is off by default.** It puts *every* DNS lookup on the phone
through this app, so a bug here breaks unrelated browsing rather than
just the blocked sites — which is exactly what happened: the Safe Search
host matcher used a substring test, so every `*.google.com` host (mail,
drive, play, accounts, photos) was answered with
`forcesafesearch.google.com`'s address and stopped loading, and
`ytimg.com` — YouTube's image CDN — was pointed at `restrict.youtube.com`,
killing every thumbnail. `src/lib/webPolicy.test.js` now pins that
behaviour. Only turn the VPN on knowingly, for the app-coverage it adds.

**Honest limitation — DNS-over-HTTPS bypass (path 2 only):** a browser
hardwired to its own DoH resolver ignores the system DNS server entirely.
We mitigate by routing the well-known public DoH resolver IPs into the
tunnel and dropping their non-port-53 traffic, which forces that
connection closed so a well-behaved browser falls back to system DNS. The
list is short and best-effort. **Never present this as "guaranteed"
blocking.** Note that path 1 is unaffected by DoH — it reads the address
bar, not the network.

**Never blocked, whatever the rules say** (`WebPolicy.NEVER_BLOCK_SUFFIXES`):
our own Supabase project, Google APIs/CDN hosts and the connectivity-check
endpoints. Blocking those bricks supervision or makes Android declare the
network dead.

### Website filtering categories (`pc_website_category_rules`, `pc_website_filter_settings`)

See `supabase/69_website_categories_and_filter_settings.sql`,
`src/lib/webCategories.js` / `android/.../dpc/WebCategories.kt`,
`WebsiteRulesTab.jsx`. Per-child category allow/block (Educational,
Entertainment, Pornography, Gambling, ... — full list in
`webCategories.js`) resolves to a domain set that's unioned with the
per-domain `pc_website_rules` and enforced by the same DNS filter above.

**Honest limitation — seed list, not a classifier.** Each category is a
*curated list of well-known domains*, not a real-time content-classification
service. A blocked category catches every domain in its seed list (and any
custom domain added under "Websites"); it will NOT catch an unlisted site
hosting the same kind of content. Additional settings close some of that
gap, each with its own trade-off:

- **Block unsupported browsers** — kicks to home any installed browser app
  outside the short list `VoiceKidsAccessibilityService` can actually read
  the address bar of (Chrome, Firefox, Samsung Internet, Edge, Opera,
  Brave, Mi Browser, DuckDuckGo). Catches browsers in our seed list
  (`WebCategories.OTHER_KNOWN_BROWSER_PACKAGES`) only — not literally every
  APK that could exist.
- **Block unknown websites** — default-denies any domain outside
  `WebCategories.ALL_CATEGORY_DOMAINS` (every category seed list, unioned
  with an `ESSENTIAL_DOMAINS` list of OS/CDN/app-store infrastructure the
  phone stops working without). Closes most of the "unlisted site" gap, at
  the cost of blocking harmless uncategorized sites — a parent has to
  allow each one under "Websites". Genuinely strict; the UI says so.
- **Enforce Safe Search** — VPN-only (path 2). DNS-answers the search
  front-end with its provider's documented "strict" alias
  (`forcesafesearch.google.com`, `strict.bing.com`, `safe.duckduckgo.com`,
  `restrictmoderate.youtube.com`). Matching is **exact-host only** — see
  the regression note above; never reintroduce suffix/substring matching
  here. AAAA queries for a Safe Search host are answered NODATA so the
  client falls back to the filtered IPv4 answer instead of racing to an
  unfiltered v6 address.
- **Blocked-website alerts** — a rate-limited (15 min per domain)
  `pc_alerts` row with `alert_type = 'website_blocked'` whenever a block
  actually fires, if enabled.

**Search-engine category caveat.** Its seed list holds the search HOSTS
(`www.google.com`), not the apexes. Domain rules are parent-matched, so a
rule on `google.com` would also block Gmail, Drive, Play and every Google
sign-in — not what "block search engines" means to a parent. The trade-off
is that a bare `google.com` typed without a subdomain isn't caught.

## Tamper detection — Accessibility / Device Admin turned off

Android gives no app a way to truly PREVENT a determined user from
disabling Accessibility or Device Admin outside of full Device Owner
mode (see "Optional Advanced mode" above) — this is detection + reaction,
not prevention, same honest limit as every non-Device-Owner parental
control app on Android.

`TamperGuard.kt`, driven from `VoiceKidsMonitorService`'s enforcement tick
plus a `ContentObserver` on `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`
for a near-instant reaction to that specific toggle, and
`VoiceKidsDeviceAdminReceiver.onDisabled()` for Device Admin — detects the
moment either permission flips from ON to OFF on a device that had
completed setup (never fires just for not having finished the setup
checklist yet) and reacts:

1. Writes a critical `pc_alerts` row (`alert_type = 'tamper_detected'`) so
   the parent is notified immediately, independent of the WebView.
2. Shows a persistent, hard-to-dismiss notification on the child's device
   explaining supervision was disabled and it's been reported.
3. Immediately locks the screen (`lockDevice()`) as a deterrent — the
   parent's explicit choice (alert + auto-lock, not alert-only). May fail
   if Device Admin itself is what just got disabled, since `lockNow()`
   needs it; that failure is expected and not itself re-reported.

Repeated reminders for a still-off permission are capped at once every 15
minutes per kind, so a device sitting with Accessibility off doesn't spam
`pc_alerts` forever.

## Stopping the child turning permissions off — parent PIN + Settings guard

Android gives no ordinary app a way to FORBID revoking Accessibility,
Device Admin, VPN consent or Usage access. Only a Device Owner (factory
reset / adb provisioning) can. Everything below is deterrence, not an
OS-level lock — say so to parents.

`SettingsGuard.kt` + `PinGateActivity.kt`, driven from the accessibility
service's window-state events:

- **Trigger.** The foreground package looks like a Settings / package
  installer / OEM security-centre app (prefix match, `GUARDED_PACKAGE_HINTS`)
  AND the visible window text mentions this app's own label AND one of
  `DANGER_PHRASES` (device admin, accessibility, usage access, VPN,
  uninstall, force stop, ...). Requiring our own name is what keeps a child
  changing the wallpaper or Wi-Fi from being interrupted.
- **Reaction.** `GLOBAL_ACTION_HOME`, then `PinGateActivity` asks for the
  parent PIN, and a rate-limited (5 min) `tamper_detected` alert goes to
  the parent.
- **Getting past it.** A correct PIN opens a 5-minute grace window
  (`VoiceKidsPrefs.settingsGraceUntil`) during which the guard stands down,
  so a parent can actually finish what they came to do.
- **PIN storage.** `pc_children.parent_pin_hash` =
  `sha256('<pin>:<child_id>')`, lower-case hex, computed identically by
  `src/lib/parentPin.js` and `SettingsGuard.hashPin()`. The raw PIN never
  leaves the parent's device. A 4–6 digit space is brute-forceable offline
  by anyone who can read the hash — this is a UI gate on a phone the child
  physically holds, exactly as strong as the same feature in every
  mainstream competitor and no stronger. Don't reuse it for anything else.
- **Self-lockout protection.** The guard is inert until a PIN exists
  (otherwise there'd be no way through it, and the PARENT could not grant
  permissions), and every Settings screen the app opens itself
  (`SettingsGuard.allowAppInitiatedVisit`, called by the setup wizard's
  request methods) opens a grace window first.
- **Still bypassable by:** safe mode, adb, a factory reset, or a second
  user profile. Device Owner is the only real answer to those.

## Battery optimization exemption (recommended, not required)

Android can silently kill `VoiceKidsMonitorService` in the background on
stricter OEM battery savers even while it's a foreground service — which
looks identical to tampering from the parent's side (enforcement just
stops) but isn't malicious. `DpcActions.isIgnoringBatteryOptimizations` /
`requestIgnoreBatteryOptimizations` (one normal system dialog, no reset)
is offered as an optional, recommended item in `SetupChecklistCard.jsx`.

## Child device can also use org features — optional identity link

By default, a device paired as a supervised child device authenticates
as a throwaway device-only account with no org membership at all, so it
could never see Sadhana, cleanliness, or any other VOICE feature — by
design, for children with no org account (e.g. too young for duties).

`pc_children.linked_profile_id` (see `68_child_org_link_and_tamper.sql`)
lets a parent optionally link a child profile to a REAL VOICE org member
account (an existing resident's own login) when creating or editing the
child in Parental Control. When linked:

- Pairing (`pc-generate-pairing-code` / `pc-redeem-pairing-code`) signs
  the device in AS that member's own account instead of minting a
  throwaway one — there is exactly one Supabase session on the device,
  valid for both org RLS (`profiles.id = auth.uid()`) and parental-control
  device RLS (`pc_devices.auth_user_id = auth.uid()`) simultaneously, with
  no special-casing needed anywhere in the org auth stack.
- `src/App.jsx` renders the FULL normal org app (Sadhana, cleanliness,
  Dashboard, etc.) instead of the isolated child shell, plus a "Family"
  nav item (`/family`, `/family/sos`, `/family/bonus`, `/family/request`)
  and a global lock overlay (`FamilySupervision.jsx`) that appears over
  whatever page is open when the parent locks the device or a blocking
  schedule is active.
- Native enforcement (Accessibility soft-block, Device Admin lock/wipe,
  `PolicyEnforcer`, tamper detection, website filtering) is completely
  unaffected either way — it already ran off its own independently
  persisted session in Android SharedPreferences (`VoiceKidsPrefs`), not
  whatever the WebView's active Supabase session happens to be.
- Leaving `linked_profile_id` unset preserves today's fully-isolated
  device-only experience exactly, unchanged — this is purely additive.

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

1. Website filtering: DNS-based enforcement now exists (see "Website
   filtering" above) — remaining gap is SNI/TLS-level inspection for
   browsers that bypass system DNS via hardwired DoH resolvers outside
   the short mitigated list; closing that fully would need a local
   TLS-terminating proxy (far more invasive, would need the parent to
   install a CA certificate on the child's device — a much bigger ask,
   not recommended unless there's real demand for it).
2. iOS: separate Swift/SwiftUI companion app using `FamilyControls` +
   `ManagedSettings`, sharing the same Supabase backend and `pc_*` schema.
   This is a multi-week project requiring Apple's entitlement approval.
3. Windows/macOS: out of scope until there is demand; no credible free-tier
   API exists for either that isn't MDM-gated.
