#!/usr/bin/env bash
# Assemble the public tilecore package payload from the monorepo build.
# The tile monorepo stays private (SSOT); this produces the public distribution mirror
# (CVERInc/tilecore) — same "publish mirror, not fork" pattern as publish.sh.
#
# Usage:  scripts/publish-tilecore.sh <dest-dir>
# Produces in <dest-dir>: tile-core.js · obsidian-shim.js · styles.css · LICENSE
# NOT touched (no source of truth in this monorepo — hand-maintained in the public repo):
#   package.json, README.md, example.html, host.js (a tiny web-host stub that originated in
#   the external web host, not here — see the public repo's README).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:?usage: publish-tilecore.sh <dest-dir>}"
mkdir -p "$dest"

bash "$ROOT/build-tile-core.sh" >/dev/null

cp "$ROOT/tile-core/tile-core.js"           "$dest/tile-core.js"
cp "$ROOT/packages/core/obsidian-shim.js"       "$dest/obsidian-shim.js"
cp "$ROOT/packages/marktile/styles.css"     "$dest/styles.css"
cp "$ROOT/LICENSE"                           "$dest/LICENSE"
node --check "$dest/tile-core.js"

echo "assembled tilecore -> $dest (review the diff, bump package.json's version yourself, then commit+push from $dest)"
