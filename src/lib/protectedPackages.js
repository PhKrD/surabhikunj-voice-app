// =====================================================================
// protectedPackages.js — client-side mirror of the lockout-protection
// list enforced authoritatively by:
//   • the database:  pc_is_protected_package() in supabase/61_policy_integrity.sql
//   • the device:    PROTECTED_PACKAGES in surabhikunj-voice-kids/src/lib/policy.js
//
// This copy exists ONLY so the parent UI can reject a dangerous rule
// instantly, with a clear explanation, instead of round-tripping to
// Postgres and showing a raw constraint-violation error. It is NOT the
// security boundary — a client can be bypassed, so the database trigger
// is what actually prevents a protected package from ever being blocked.
// If you change one list, change all three and keep the comment above
// each in sync.
// =====================================================================

export const PROTECTED_PACKAGES = Object.freeze([
  'com.android.server.telecom',
  'com.android.phone',
  'com.android.dialer',
  'com.google.android.dialer',
  'com.android.emergency',
  'com.android.incallui',
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.providers.settings',
  'com.android.launcher3',
  'com.google.android.apps.nexuslauncher',
  'com.surabhikunj.voice.kids',
])

const PROTECTED_SET = new Set(PROTECTED_PACKAGES)

export function isProtectedPackage(pkg) {
  return PROTECTED_SET.has(pkg)
}

export const PROTECTED_PACKAGE_EXPLANATION =
  'This app cannot be blocked or time-limited because it provides emergency calling or core device functions. Blocking it could prevent the child from calling for help or make the device unusable.'
