#!/bin/bash
# pagetile-w build — the web host for the tile family's PAGED essence (comics / e-books).
# pagetile owns ONLY the paged-content MODEL (book-core.js, hand-authored here); the shared editor
# engine is COPIED from this repo's tile-core/, like every other surface here.
#
# 🩸 2026-08-11. This header used to say the engine was "VENDORED from CVERInc/tile via
# scripts/fetch-tile.sh" — a script that lives in the OTHER repo and was never going to run here.
# tugtile-w and modaltile-w had their copy localised when the surfaces graduated; this one was
# missed, so nothing in this repo had regenerated it since. Measured: vendor/tile-core.js was
# 193,714 bytes against the canonical 226,716 — 33 KB behind, on a preview that reported no
# problem at all, which is the exact failure tugtile-w/build.sh's own comment warns about ("three
# surfaces once carried two different builds while all of them said latest").
#
# It had been WRITTEN DOWN, too — the structure decision lists "手抄 diff 清單漏 pagetile-w 33 KB"
# as evidence that hand-kept lists rot. Writing it down changed nothing. The copy below plus the
# freshness gate in scripts/test.sh is what actually closes it.
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

mkdir -p "$DIR/vendor"
cp "$ROOT/tile-core/tile-core.js" "$DIR/vendor/tile-core.js"
echo "copied vendor/tile-core.js (from this repo's tile-core/)"

echo "build complete — vendor/tile-core.js is copied from tile-core/;"
echo "  obsidian-shim.js, host.js, icons.js are committed static glue."
