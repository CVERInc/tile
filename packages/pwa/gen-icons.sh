#!/usr/bin/env bash
# REEF with PWA — icon generator. One source PNG (a square-ish logo/mascot, transparent bg
# preferred) → the whole favicon + apple-touch + PWA (any + maskable) icon set. Trims excess
# transparency so the mark fills the frame, then composites the opaque icons on a brand colour.
#   usage: gen-icons.sh <source.png> <out-dir> [bg-hex]   (bg default: #000000)
set -euo pipefail
SRC="${1:?source png}"; OUT="${2:?out dir}"; BG="${3:-#000000}"
M="$(command -v magick || command -v convert)"
mkdir -p "$OUT"
TRIM="$OUT/.pwa-trim.png"
"$M" "$SRC" -trim +repage "$TRIM"                                   # drop transparent padding
# favicon — transparent, tight (mark fills ~92% of a square), 48px for the tab
"$M" "$TRIM" -resize 44x44 -background none -gravity center -extent 48x48 "$OUT/favicon.png"
# opaque brand-bg icons (apple-touch + PWA "any"): mark ~82% centred on the brand colour
for pair in 180:apple-touch-icon 192:icon-192 512:icon-512; do
  px="${pair%%:*}"; name="${pair##*:}"; inner=$(( px * 82 / 100 ))
  "$M" -size "${px}x${px}" "xc:${BG}" \( "$TRIM" -resize "${inner}x${inner}" \) -gravity center -composite "$OUT/${name}.png"
done
# maskable 512 — mark in the ~64% safe zone so platform circle/squircle masks never clip it
"$M" -size 512x512 "xc:${BG}" \( "$TRIM" -resize 328x328 \) -gravity center -composite "$OUT/icon-maskable-512.png"
rm -f "$TRIM"
echo "✓ wrote favicon.png apple-touch-icon.png icon-192.png icon-512.png icon-maskable-512.png → $OUT"
