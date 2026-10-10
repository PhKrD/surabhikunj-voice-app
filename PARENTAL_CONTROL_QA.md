# Parental Control: QA Checklist (real phones)

Automated: `npm test` (JS reference engine, protection health, extra
time), `cd android && ./gradlew :app:testDebugUnitTest` (native time,
geofence and limit rules). These can't prove Android enforcement; this
list does.

**Phones to cover:** Samsung (One UI), Xiaomi/Redmi/POCO (HyperOS/MIUI),
Vivo, Oppo or Realme, OnePlus, and one Pixel/stock phone, across at least
Android 10, 13 and 15+.

**Tools:** child home screen, tap the name 7× → *Supervision diagnostics*.
Parent: child → Devices → *Protection* card.

Legend: ✅ passed on the Android 17 emulator (October 2026, build 1.2.0) ·
☐ to run on real phones.

## Setup
- ☐ Parent: Add child → generate code. Child: install VOICE → "I'm a child" → enter code → "linked" → wizard shows % progress.
- ☐ Expired code (wait 10 min) / reused code / wrong code each show a clear message.
- ☐ Protection card turns **Strong** once the wizard is done; switching any item off shows it with fix steps.
- ✅ Pairing gives native its own session (`pc-device-session` 200; another user's device 403).

## Critical scenarios
1. ✅ **Block app**: block Chrome → opening Chrome shows the VOICE block screen ("Chrome is blocked"); dialer still opens.
2. ✅ **Bedtime**: routine starts and ends at the set minutes with no parent action; screen shows its name and "Until …".
3. ✅ **Offline**: aeroplane mode → bedtime still starts and ends on time; blocked attempts are queued and arrive after reconnect.
4. ✅ **Lock while offline**: lock set while phone offline → applied 13 s after reconnect.
5. ✅ **Accessibility off**: critical "Supervision was turned off" alert in ~12 s; "Supervision is back on" after re-enabling.
6. ✅ **Reboot**: supervision returns after unlock (accessibility bind + BOOT_COMPLETED), limit still enforced.
7. ✅ **Internet pause**: pause applied in 2 s; internet apps blocked; VOICE still receives Resume (18 s).
8. ✅ **Extra time**: limit reached → extra time lifts it → limit returns when it expires.
9. ✅ **App update**: `MY_PACKAGE_REPLACED` restarts supervision without opening VOICE.

## Per-phone checks (☐ on every OEM)
- ☐ Bedtime with **allow-list**: Home button never loops/flickers; keyboard works; dialer + emergency call work.
- ☐ Block screen appears (not just Home) with and without "Display over other apps".
- ☐ Leave the phone idle 2+ hours with the screen off → a lock sent from the parent still lands within ~1 min of the screen turning on.
- ☐ Kill VOICE from Recents and with Settings → Force stop → supervision returns (note OEM behaviour; Force stop needs the parent PIN when the guard is on).
- ☐ Battery saver / "deep sleep" on → protection card shows Background operation missing with that brand's steps.
- ☐ Revoke Usage access / location / VPN → warning alert; restore → "back on".
- ☐ Ask for more time from the block screen → parent sees request → Approve 15 → phone relaxes → original rule returns after 15 min.
- ☐ Ask to unblock an app → Approve → the app opens.
- ☐ Hold for SOS (2 s) offline → parent gets the SOS after reconnect with the original time.
- ☐ Geofence: walk out of and back into Home → one "Left" and one "Arrived", no flapping at the edge.
- ☐ Website block in Chrome/Samsung Internet; Safe Search only with Web protection on (card says so otherwise).
- ☐ Two children, two phones: a rule for one never affects the other.
- ☐ Remove device in parent app → child phone releases every restriction.
- ☐ Battery: 24 h with supervision vs. without; record drain on each OEM.

## Known Android limits to confirm, not "fix"
Safe mode, a second user profile, adb from a computer, or a factory reset
bypass standard-mode supervision. Confirm that each one that is detectable
raises an alert.
