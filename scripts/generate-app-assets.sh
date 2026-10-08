#!/usr/bin/env bash
# Generates the Android launcher icons and splash images from the brand
# mark (white flame on VOICE purple). macOS only: uses the built-in `sips`
# to rasterise SVG, so no extra tools are needed.
#
#   bash scripts/generate-app-assets.sh
#
# Re-run after changing BRAND or the flame path; then rebuild the APK.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RES="$ROOT/android/app/src/main/res"
BRAND="#6845e0"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Lucide "flame" (24-unit viewBox), centred on (12,12).
FLAME='M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'

# flame <canvas-w> <canvas-h> <glyph-height-px>  → a <g> with the flame centred
flame() {
  local w=$1 h=$2 size=$3
  local scale; scale=$(echo "scale=4; $size / 20" | bc)
  local tx; tx=$(echo "scale=4; $w / 2 - 12 * $scale" | bc)
  local ty; ty=$(echo "scale=4; $h / 2 - 12 * $scale" | bc)
  echo "<g transform=\"translate($tx $ty) scale($scale)\" fill=\"none\" stroke=\"#ffffff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"$FLAME\"/></g>"
}

render() { # <svg-file> <out.png> <w> <h>
  sips -s format png "$1" --out "$2" >/dev/null
  sips -z "$4" "$3" "$2" >/dev/null
}

# ---- Adaptive-icon foreground (108dp canvas, glyph inside the safe zone) ----
for pair in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  d=${pair%%:*}; px=${pair##*:}
  glyph=$(echo "$px * 40 / 100" | bc)
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s">%s</svg>' "$px" "$px" "$(flame "$px" "$px" "$glyph")" > "$WORK/fg.svg"
  render "$WORK/fg.svg" "$RES/mipmap-$d/ic_launcher_foreground.png" "$px" "$px"
done

# ---- Legacy icons (Android 7.x and launchers without adaptive icons) ----
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; px=${pair##*:}
  glyph=$(echo "$px * 55 / 100" | bc)
  r=$(echo "$px * 22 / 100" | bc)
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s"><rect width="%s" height="%s" rx="%s" fill="%s"/>%s</svg>' \
    "$px" "$px" "$px" "$px" "$r" "$BRAND" "$(flame "$px" "$px" "$glyph")" > "$WORK/ic.svg"
  render "$WORK/ic.svg" "$RES/mipmap-$d/ic_launcher.png" "$px" "$px"
  half=$(echo "$px / 2" | bc)
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s"><circle cx="%s" cy="%s" r="%s" fill="%s"/>%s</svg>' \
    "$px" "$px" "$half" "$half" "$half" "$BRAND" "$(flame "$px" "$px" "$glyph")" > "$WORK/round.svg"
  render "$WORK/round.svg" "$RES/mipmap-$d/ic_launcher_round.png" "$px" "$px"
done

# ---- Splash images (pre-Android-12 launch background) ----
splash() { # <dir> <w> <h>
  local w=$2 h=$3
  local short=$(( w < h ? w : h ))
  local glyph=$(( short * 22 / 100 ))
  printf '<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s"><rect width="%s" height="%s" fill="%s"/>%s</svg>' \
    "$w" "$h" "$w" "$h" "$BRAND" "$(flame "$w" "$h" "$glyph")" > "$WORK/splash.svg"
  sips -s format png "$WORK/splash.svg" --out "$RES/$1/splash.png" >/dev/null
}
splash drawable 480 320
for spec in mdpi:320:480 hdpi:480:800 xhdpi:720:1280 xxhdpi:960:1600 xxxhdpi:1280:1920; do
  IFS=: read -r d w h <<< "$spec"
  splash "drawable-port-$d" "$w" "$h"
  splash "drawable-land-$d" "$h" "$w"
done

cat > "$RES/values/ic_launcher_background.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$BRAND</color>
</resources>
EOF

echo "App icons and splash images regenerated in $RES"
