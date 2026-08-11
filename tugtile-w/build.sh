#!/bin/bash
# tugtile-w web preview build.
# board-core.js and vendor/tile-core.js are VENDORED from the public canonical repo
# CVERInc/tile via scripts/fetch-tile.sh (run that to refresh). This script only copies
# the shared root assets the preview needs. (The editor engine + tugtile source graduated
# to the public repo; this private repo no longer regenerates them here.)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Real tugtile stylesheet, verbatim (same CSS, not a re-implementation).
cp "$ROOT/styles.css" "$ROOT/tugtile-w/tugtile.css"
echo "copied tugtile.css (verbatim styles.css)"

# SortableJS — the same drag engine, so cards/lanes are draggable ("tug").
cp "$ROOT/Sortable.min.js" "$ROOT/tugtile-w/Sortable.min.js"
echo "copied Sortable.min.js"

# i18n — the same locale JSON, so strings match exactly.
mkdir -p "$ROOT/tugtile-w/i18n"
cp "$ROOT/i18n/"*.json "$ROOT/tugtile-w/i18n/"
echo "copied i18n/*.json"


# 🔴 The engine is COPIED from this repo, not fetched from it. Until these surfaces graduated they
# lived in the private lab and pulled tile-core.js across a repo boundary via fetch-tile.sh — which
# is why three surfaces once carried two different builds while all of them said "latest". They are
# in the same repo as their engine now, so the copy is local, unconditional, and checked by
# scripts/test.sh's "generated artifacts in sync" gate. There is no version left to disagree about.
mkdir -p "$ROOT/tugtile-w/vendor"
cp "$ROOT/tile-core/tile-core.js" "$ROOT/tugtile-w/vendor/tile-core.js"
echo "copied vendor/tile-core.js (from this repo's tile-core/)"

echo "build complete — board-core.js is vendored via scripts/fetch-tile.sh; vendor/tile-core.js is copied from tile-core/;"
echo "  obsidian-shim.js, host.js, icons.js are committed static glue."
