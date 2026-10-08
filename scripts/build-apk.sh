#!/usr/bin/env bash
# Builds the signed RELEASE APK for SurabhiKunj VOICE.
#
#   npm run apk
#
# Output: ~/Desktop/VOICE-<versionName>-<versionCode>.apk
#
# Signing uses android/keystore.properties (gitignored). It must point at
# the SAME key every time, or installed apps cannot be updated in place.
# Resolves the JDK and Android SDK automatically.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Toolchain resolution -------------------------------------------------
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
fi
if [ -z "${JAVA_HOME:-}" ]; then
  JAVA_HOME="$(find "$HOME/Library/Java" -maxdepth 3 -name Home -path '*Contents*' 2>/dev/null | head -1)"
fi
export JAVA_HOME
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "ERROR: JDK not found. Set JAVA_HOME or install a JDK 21." >&2
  exit 1
fi
if [ ! -d "$ANDROID_HOME/platform-tools" ]; then
  echo "ERROR: Android SDK not found at $ANDROID_HOME. Set ANDROID_HOME." >&2
  exit 1
fi
if [ ! -f android/keystore.properties ]; then
  echo "ERROR: android/keystore.properties is missing — release signing is not configured." >&2
  echo "       See DEPLOYMENT.md (\"Android signing\")." >&2
  exit 1
fi

echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# --- Build ----------------------------------------------------------------
npm run build
npx cap sync android
( cd android && ./gradlew assembleRelease --no-daemon )

APK="android/app/build/outputs/apk/release/app-release.apk"
VERSION_NAME=$(grep -m1 -E '^\s*versionName "' android/app/build.gradle | sed -E 's/.*"(.*)".*/\1/')
VERSION_CODE=$(grep -m1 -E '^\s*versionCode [0-9]+' android/app/build.gradle | sed -E 's/[^0-9]*([0-9]+).*/\1/')
DEST="$HOME/Desktop/VOICE-${VERSION_NAME}-${VERSION_CODE}.apk"
cp "$APK" "$DEST"

# Prove the APK is signed with the expected certificate before anyone installs it.
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)
if [ -n "$APKSIGNER" ]; then
  "$APKSIGNER" verify --print-certs "$DEST" | grep -E "SHA-256 digest" | head -1
fi

echo ""
echo "Release APK ready: $DEST"
ls -lh "$DEST"
