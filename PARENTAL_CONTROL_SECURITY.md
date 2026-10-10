# Parental Control: Security Review (October 2026)

Scope: pairing, identities, RLS on every `pc_*` table, edge functions,
commands, location, tokens, on-device storage. "Fixed" items ship in this
release; migration **74** must be applied for the database fixes.

## Trust model

- **Parent**: an org account; owns `pc_children.parent_id`.
- **Child device**: its own auth user (`pc_devices.auth_user_id`), or, for
  a child linked to a VOICE member, that member's account. It may read
  only its own child's policy and write only its own child's telemetry.
- The child physically holds the phone. Anything stored on it (tokens,
  the PIN hash) must be assumed readable by a determined child with root.
  Server-side RLS, not the app, is the boundary.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | `pc_schedules_device_select` didn't compare the schedule's child with the device's child: any paired device could read every family's routines | High | **Fixed (74)** |
| S2 | Device insert policies checked only `device_id`, not `child_id`: a paired device could write alerts (fake SOS/tamper/"arrived home"), locations, usage, SOS events, time requests, web activity and audit rows into another family's child | High | **Fixed (74)**: `pc_device_owns_child()` |
| S3 | A device could insert a time request already marked approved | Medium | **Fixed (74)**: insert must be `pending`, unresolved |
| S4 | SECURITY DEFINER helpers without a pinned `search_path` | Low | **Fixed (74)** |
| S5 | WebView and native shared one refresh token; rotation-reuse made Supabase revoke the session (reliability, and a linked member could be logged out) | High (availability) | **Fixed**: `pc-device-session` gives native its own session |
| S6 | `android:allowBackup="true"`: cloud backup copied the child phone's session and device identity to other phones | Medium | **Fixed**: backup disabled |
| S7 | `MainActivity` had `showWhenLocked`/`turnScreenOn`: VOICE (members, Sadhana, parent controls) could show over the lock screen | Medium | **Fixed**: removed |
| S8 | Concurrent token refresh from three native threads | Low | **Fixed**: serialised |
| S9 | Push flood (every alert = push) | Low (abuse) | **Fixed (74)**: cool-down per alert kind |

## Verified as already correct

- **Parent A cannot control Parent B's child**: every parent policy uses
  `pc_is_parent_of(child_id)` / `parent_id = auth.uid()`; command inserts
  join device → child → `parent_id = auth.uid()`.
- **A child cannot forge parent commands**: devices have no INSERT on
  `pc_device_commands`; they can only update status on their own rows.
- **A child cannot approve its own requests**: no device UPDATE policy on
  `pc_bonus_time_requests` / `pc_child_requests`; approval also re-checks
  `status = 'pending'`, so two taps can't grant twice.
- **A device cannot re-point itself** at another child or org
  (`trg_pc_devices_lock_identity`, migration 63).
- **Commands can't be replayed indefinitely**: 90 s `expires_at`; lock,
  pause and extra time are durable desired state, idempotent by design.
- **Pairing codes**: 6 characters × 32 symbols (≈ 1.07 × 10⁹), stored only
  as SHA-256, 10-minute expiry, single use (atomic claim), expired codes
  burned on first try.
- **`pc-device-session`**: requires a valid JWT; mints a session only for
  the caller's own user, and only if the caller owns an active device row
  (tested live: 401 without auth, 403 for another user's device, 200 for
  the paired device).
- Native logs never print tokens; the diagnostics screen exposes none.

## Accepted / residual risks

- **Parent PIN hash** (`sha256(pin:child_id)`) is readable by the child's
  device, so a 4–6 digit PIN can be brute-forced offline by someone who
  extracts it from a rooted phone. It's a deterrent at the Settings screen,
  as in competing apps. Don't reuse the PIN elsewhere.
- **Redeem endpoint has no rate limit**. Brute-forcing a live code means
  ~10⁹ guesses inside 10 minutes; infeasible over HTTP, but a server-side
  limit would be defence in depth.
- **Location history** is retained until the child is deleted; there is no
  automatic retention window yet.

## Privacy

Collected: app usage durations, installed app list, browser domains and
search terms from known browsers (best-effort), location fixes, alerts. Not
collected, and must never be added: message/chat content, keystrokes,
microphone, camera, credentials, call/SMS content. The child sees a
permanent "VOICE supervision is on" notification. Nothing is hidden from the
child.
