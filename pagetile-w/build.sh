#!/bin/bash
# pagetile-w build — the web host for the tile family's PAGED essence (comics / e-books).
# pagetile owns ONLY the paged-content MODEL (book-core.js, hand-authored here); the shared
# editor engine (vendor/tile-core.js) is VENDORED from the public canonical repo CVERInc/tile
# via scripts/fetch-tile.sh. This script copies the shared root assets the preview needs.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/pagetile-w"

# book-core.js is the hand-authored model (no codegen) — pagetile's reason to exist.
echo "model: book-core.js (hand-authored, not generated)"

# Real tile stylesheet, verbatim, so the editor chrome matches the family.
cp "$ROOT/styles.css" "$DIR/pagetile.css"
echo "copied pagetile.css (verbatim styles.css)"

# i18n — the same locale JSON, so editor strings match exactly.
mkdir -p "$DIR/i18n"
cp "$ROOT/i18n/"*.json "$DIR/i18n/"
echo "copied i18n/*.json"

echo "build complete — vendor/tile-core.js is vendored via scripts/fetch-tile.sh;"
echo "  obsidian-shim.js, host.js, icons.js are committed static glue."
