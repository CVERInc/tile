#!/bin/bash
# modaltile-w build — the web host for the tile family's FULL-SCREEN SINGLE-POST editor.
#
# modaltile owns ONLY the modal surface (modaltile-core.js + editabilize.js + htmlmd.js, all
# hand-authored); the shared editor engine (vendor/editor-core.js) is VENDORED from the public
# canonical repo CVERInc/tile via scripts/fetch-tile.sh, exactly like pagetile-w and tugtile-w.
# This script copies the shared root assets the surface needs.
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DIR="$(cd "$(dirname "$0")" && pwd)"

# modaltile-core.js / editabilize.js / htmlmd.js are the hand-authored surface — modaltile's
# reason to exist. Nothing here is generated.
echo "surface: modaltile-core.js + editabilize.js + htmlmd.js (hand-authored, not generated)"

# Real tile stylesheet, verbatim, so the editor chrome matches the family. Note the file name:
# unlike pagetile.css / tugtile.css this is NOT "modaltile.css" — modaltile.css is the surface's
# OWN chrome (the .ej-* modal shell + the Obsidian CSS-variable shim), which is hand-authored and
# must not be clobbered by a copy of styles.css.
cp "$ROOT/styles.css" "$DIR/tile-family.css"
echo "copied tile-family.css (verbatim styles.css)"

# i18n — the same locale JSON, so editor strings match exactly.
mkdir -p "$DIR/i18n"
cp "$ROOT/i18n/"*.json "$DIR/i18n/"
echo "copied i18n/*.json"


# 🔴 The engine is COPIED from this repo, not fetched from it. Until these surfaces graduated they
# lived in the private lab and pulled the engine across a repo boundary via fetch-tile.sh — which
# is why three surfaces once carried two different builds while all of them said "latest". They are
# in the same repo as their engine now, so the copy is local, unconditional, and checked by
# scripts/test.sh's "generated artifacts in sync" gate. There is no version left to disagree about.
mkdir -p "$DIR/vendor"
cp "$ROOT/dist/editor-core.js" "$DIR/vendor/editor-core.js"
echo "copied vendor/editor-core.js (from this repo's dist/)"

echo "build complete — vendor/editor-core.js is copied from this repo's dist/;"
echo "  obsidian-shim.js and host.js are committed static glue."
echo
echo "  run it:  (cd \"$ROOT\" && python3 -m http.server 8731)  →  http://localhost:8731/hosts/web/modaltile/"
