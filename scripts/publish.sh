#!/usr/bin/env bash
# Assemble a thin Obsidian publish-repo payload for ONE plugin from the monorepo build.
#
# 🩸 This said "the tile monorepo stays private" until 2026-08-05. It was true when written and
# stopped being true when the MIT packages graduated to the PUBLIC CVERInc/tile — so the one line
# here describing the topology was telling every later reader the opposite of the truth. The mirrors
# exist because Obsidian requires one repo = one plugin (manifest.json at the root, main.js +
# styles.css beside it, and a Release), not because the source is hidden.
#
# Usage:  scripts/publish.sh <tugtile|marktile> <dest-dir>
# Produces in <dest-dir>: main.js · manifest.json · styles.css · versions.json · LICENSE
# (README is maintained per publish-repo, not overwritten here.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
plugin="${1:?usage: publish.sh <tugtile|marktile> <dest-dir>}"
dest="${2:?usage: publish.sh <tugtile|marktile> <dest-dir>}"
mkdir -p "$dest"

# 1. fresh build from the monorepo
case "$plugin" in
  tugtile)  bash "$ROOT/hosts/obsidian/tugtile/build.sh" >/dev/null; styles="$ROOT/styles.css" ;;
  marktile) bash "$ROOT/hosts/obsidian/marktile/build-marktile.sh" >/dev/null; styles="$ROOT/hosts/obsidian/marktile/styles.css" ;;
  *) echo "unknown plugin: $plugin" >&2; exit 1 ;;
esac

# 2. copy the three install assets + license
cp "$ROOT/packages/$plugin/main.js"      "$dest/main.js"
cp "$ROOT/packages/$plugin/manifest.json" "$dest/manifest.json"
cp "$styles"                              "$dest/styles.css"
cp "$ROOT/LICENSE"                        "$dest/LICENSE"

# 3. versions.json (version -> minAppVersion), read straight from the manifest
ver="$(grep -oE '"version"[^"]*"[0-9.]+"' "$dest/manifest.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
min="$(grep -oE '"minAppVersion"[^"]*"[0-9.]+"' "$dest/manifest.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
printf '{\n  "%s": "%s"\n}\n' "$ver" "$min" > "$dest/versions.json"

echo "assembled $plugin v$ver (minApp $min) -> $dest"
