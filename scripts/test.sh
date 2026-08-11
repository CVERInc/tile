#!/usr/bin/env bash
# Single entry point for the whole check: syntax + i18n validity + build both plugins + run
# the full test suite. Used by BOTH the pre-push git hook and GitHub Actions CI, so "what runs
# automatically" is defined in exactly one place. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ syntax check"
node --check packages/tugtile/plugin.src.js
node --check packages/core/editor-core.js
node --check packages/marktile/marktile.src.js

echo "→ i18n JSON valid"
for f in i18n/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" || { echo "BAD JSON: $f"; exit 1; }
done

echo "→ build (inlines core + i18n; needs python3 + bash)"
bash packages/tugtile/build.sh >/dev/null
bash packages/marktile/build-marktile.sh >/dev/null
bash build-tile-core.sh >/dev/null            # web core emit — guard it so a core move can't silently break it
node --check tile-core/tile-core.js

# The three build outputs are committed (so consumers — incl. external web hosts — fetch them without rebuilding).
# Assert each committed artifact still equals a fresh build: edit a source and forget to rebuild → CI/pre-push fails
# instead of pushing a stale artifact that silently feeds downstream old code.
echo "→ generated artifacts in sync (committed == fresh build)"
# The two web surfaces' vendored engines are in this list for the reason the list exists. They used
# to be FETCHED across a repo boundary, and three surfaces once carried two different builds while
# every one of them was nominally "latest". Same repo now, so their build.sh copies tile-core/ in,
# and this is what stops the copies drifting from it again.
bash tugtile-w/build.sh >/dev/null
bash modaltile-w/build.sh >/dev/null
git diff --exit-code -- packages/tugtile/main.js packages/marktile/main.js tile-core/tile-core.js \
  tugtile-w/vendor/tile-core.js modaltile-w/vendor/tile-core.js \
  || { echo "✗ a committed build artifact is stale — run the builds and commit the result"; exit 1; }

echo "→ tests"
for t in test/*.cjs; do
  echo "  · $t"
  node "$t"
done

# The site renderer's own suite, which arrived with sitetile/pagetile/pwa. Globbed rather than
# listed: the private repo these came from keeps a hand-written list, and that list silently
# stopped covering five real test files — a test nothing runs is indistinguishable from a test
# that passes. Here the glob IS the list, so a new file cannot be orphaned by forgetting to add it.
#
# 🩸 …within a directory. The DIRECTORIES are still hand-kept, and that is the same defect one level
# up: drop a `foo.test.mjs` into pagetile-w/ or packages/core/ and it is silently never run. The
# guard below closes it by asking the TREE instead of the list — which matters most right now,
# because the next thing that happens to this repo is that several of these directories move.
SUITE_GLOBS=(packages/sitetile/*.test.mjs packages/sitetile/*.test.js packages/pwa/*.test.mjs
             flowtile-w/*.test.mjs test/*.test.mjs)

echo "→ every test file in the tree is actually run"
shopt -s nullglob
covered=$(printf '%s\n' test/*.cjs "${SUITE_GLOBS[@]}" | sort -u)
shopt -u nullglob
# `test/*.cjs` is deliberately non-recursive: test/golden/corpus.cjs is a fixture another test
# requires, not a suite. Anything matching *.test.* IS a suite, wherever it sits.
#
# `--others --exclude-standard` as well as tracked: a test file you wrote thirty seconds ago and
# have not staged is EXACTLY the one at risk of never being run, and `git ls-files` alone would
# say nothing until after it was committed. Ignored paths (node_modules, dist) stay out.
present=$( { git ls-files --cached --others --exclude-standard '*.test.mjs' '*.test.js'
             printf '%s\n' test/*.cjs 2>/dev/null; } | sort -u)
orphans=$(comm -23 <(echo "$present") <(echo "$covered") || true)
if [ -n "$orphans" ]; then
  echo "✗ these test files exist but nothing runs them — add their directory to SUITE_GLOBS:" >&2
  echo "$orphans" | sed 's/^/    /' >&2
  exit 1
fi

echo "→ site renderer tests"
shopt -s nullglob
for t in "${SUITE_GLOBS[@]}"; do
  echo "  · $t"
  node "$t"
done
shopt -u nullglob

# The astro smoke builds real pages and audits the emitted HTML/JS — the only gate here that does.
# It needs the renderer's dependencies, so it runs when they are present and SAYS SO by name when
# they are not, rather than passing quietly on a check that never ran.
if [ -d packages/sitetile/astro/node_modules ]; then
  echo "→ sitetile astro smoke"
  ( cd packages/sitetile/astro && node smoke-build.mjs )
else
  echo "  · sitetile astro smoke SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)"
fi

echo "✅ ALL GREEN"
