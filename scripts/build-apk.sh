#!/usr/bin/env bash
# Builds an installable debug APK for SurabhiKunj VOICE.
# Resolves the JDK and Android SDK automatically; falls back to the
# locally-installed Temurin 21 + ~/Library/Android/sdk if env vars are unset.
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
  echo "ERROR: JDK not found. Set JAVA_HOME or install a JDK 17+." >&2
  exit 1
fi
if [ ! -d "$ANDROID_HOME/platform-tools" ]; then
  echo "ERROR: Android SDK not found at $ANDROID_HOME. Set ANDROID_HOME." >&2
  exit 1
fi

echo "JAVA_HOME=$JAVA_HOME"
echo "ANDROID_HOME=$ANDROID_HOME"
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# --- Build ----------------------------------------------------------------
npm run build
npx cap sync android
( cd android && ./gradlew assembleDebug --no-daemon )

APK="android/app/build/outputs/apk/debug/app-debug.apk"
DEST="$HOME/Desktop/SurabhiKunj-VOICE-debug.apk"
cp "$APK" "$DEST"
echo ""
echo "APK ready: $DEST"
ls -lh "$DEST"
