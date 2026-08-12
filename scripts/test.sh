#!/usr/bin/env bash
# Single entry point for the whole check: syntax + i18n validity + build both plugins + run
# the full test suite. Used by BOTH the pre-push git hook and GitHub Actions CI, so "what runs
# automatically" is defined in exactly one place. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "→ syntax check"
node --check hosts/obsidian/tugtile/plugin.src.js
node --check packages/core/editor-core.js
node --check hosts/obsidian/marktile/marktile.src.js

echo "→ i18n JSON valid"
for f in i18n/*.json; do
  node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" || { echo "BAD JSON: $f"; exit 1; }
done

echo "→ build (inlines core + i18n; needs python3 + bash)"
bash hosts/obsidian/tugtile/build.sh >/dev/null
bash hosts/obsidian/marktile/build-marktile.sh >/dev/null
bash scripts/build-editor-core.sh >/dev/null            # web core emit — guard it so a core move can't silently break it
node --check dist/editor-core.js

# The three build outputs are committed (so consumers — incl. external web hosts — fetch them without rebuilding).
# Assert each committed artifact still equals a fresh build: edit a source and forget to rebuild → CI/pre-push fails
# instead of pushing a stale artifact that silently feeds downstream old code.
echo "→ generated artifacts in sync (committed == fresh build)"
# The two web surfaces' vendored engines are in this list for the reason the list exists. They used
# to be FETCHED across a repo boundary, and three surfaces once carried two different builds while
# every one of them was nominally "latest". Same repo now, so their build.sh copies dist/ in,
# and this is what stops the copies drifting from it again.
# 🩸 The BUILT plugins were never syntax-checked, only their sources were. On 2026-08-11 an edit to
# a comment on the //#core-inline marker line made build-marktile.sh emit a main.js with a bare
# `(build replaces this line …)` in it — invalid JavaScript — and this script's next word about it
# was "a committed build artifact is stale", which reads like bookkeeping. It got committed.
# marktile survives only because test/marktile-load.test.cjs requires main.js; NOTHING loads
# tugtile's, so the same break there would have shipped in silence.
echo "→ built plugins parse"
node --check hosts/obsidian/marktile/main.js
node --check hosts/obsidian/tugtile/main.js

bash hosts/web/tugtile/build.sh >/dev/null
bash hosts/web/modaltile/build.sh >/dev/null
bash hosts/web/pagetile/build.sh >/dev/null
# 🩸 pagetile-w was NOT in this list, and its build.sh did not copy the engine at all — it still
# claimed the copy came from the other repo's fetch script. Its vendor/editor-core.js was 33 KB behind
# the canonical one, on a preview that reported nothing wrong. Two of the three surfaces were
# localised at graduation; this one was missed, and only a list that nobody diffed said otherwise.
bash scripts/build-board-core.sh >/dev/null
# 🩸 board-core.js carried a DO-NOT-EDIT banner with no generator in this repo — the slicing lived
# in the private lab's fetch script and did not graduate with the artifact. It was still identical
# to a fresh slice, which is luck, not a mechanism.
ARTIFACTS=(hosts/obsidian/tugtile/main.js hosts/obsidian/marktile/main.js dist/editor-core.js
           hosts/web/tugtile/vendor/editor-core.js hosts/web/modaltile/vendor/editor-core.js hosts/web/pagetile/vendor/editor-core.js
           packages/tugtile/board-core.js)

# 🩸 `git diff --exit-code -- <path that does not exist>` exits 0, silently. This list is typed by
# hand, so a typo, a deletion, or a file that MOVED turns the gate green instead of red — and the
# next thing that happens to this repo is that several of these move. Measured 2026-08-12:
#   git diff --exit-code -- this/does/not/exist.js  →  0
# So assert the subjects exist before asking whether they differ. A gate must fail closed on a
# question it cannot ask.
for a in "${ARTIFACTS[@]}"; do
  [ -f "$a" ] || { echo "✗ the freshness gate names \`$a\`, which does not exist — it moved, or the"; \
                   echo "  path is a typo. Either way this gate has been passing without checking it."; exit 1; }
done
git diff --exit-code -- "${ARTIFACTS[@]}" \
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
# up: drop a `foo.test.mjs` into hosts/web/pagetile/ or packages/core/ and it is silently never run. The
# guard below closes it by asking the TREE instead of the list — which matters most right now,
# because the next thing that happens to this repo is that several of these directories move.
SUITE_GLOBS=(packages/sitetile/*.test.mjs packages/sitetile/*.test.js packages/pwa/*.test.mjs
             packages/flowtile/*.test.mjs test/*.test.mjs)
# 🩸 …and within a NAMING CONVENTION. The guard below asked the tree for `*.test.*` and nothing else,
# so hosts/web/modaltile/ could hold TWO browser harnesses that nothing has ever run and the check
# designed to catch exactly that stayed green — they were invisible to it because of what they are
# called. (Both pass, as of 2026-08-12. Unrun is not the same as broken, and you cannot tell which
# one you have without running them: seven harnesses in the sibling repo were found dead the same
# day, and every one of them had also been "fine" right up until somebody looked.)
SMOKE_GLOBS=(hosts/web/*/*.smoke.mjs hosts/web/*/smoke.mjs)

echo "→ every test file in the tree is actually run"
shopt -s nullglob
covered=$(printf '%s\n' test/*.cjs "${SUITE_GLOBS[@]}" "${SMOKE_GLOBS[@]}" | sort -u)
shopt -u nullglob
# `test/*.cjs` is deliberately non-recursive: test/golden/corpus.cjs is a fixture another test
# requires, not a suite. Anything matching *.test.* IS a suite, wherever it sits.
#
# `--others --exclude-standard` as well as tracked: a test file you wrote thirty seconds ago and
# have not staged is EXACTLY the one at risk of never being run, and `git ls-files` alone would
# say nothing until after it was committed. Ignored paths (node_modules, dist) stay out.
present=$( { git ls-files --cached --others --exclude-standard '*.test.mjs' '*.test.js' '*smoke.mjs'
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

# The browser smokes drive a real page in a real engine — the only gates here that touch the DOM the
# way a person does. They need Playwright, which this repo does not depend on, so they run when
# PLAYWRIGHT points at one and SAY SO by name when it does not.
#
# 🩸 They were listed in SMOKE_GLOBS before this block existed, which made the orphan guard above go
# green on the strength of a declaration. That is the same defect the guard is for, one level up:
# "covered" has to mean "run", not "mentioned". If you add a smoke, add it here too.
if [ -n "${PLAYWRIGHT:-}" ] && [ -f "${PLAYWRIGHT}" ]; then
  echo "→ browser smokes"
  _port=8749
  python3 -m http.server "$_port" --bind 127.0.0.1 >/dev/null 2>&1 &
  _srv=$!
  trap 'kill "$_srv" 2>/dev/null || true' EXIT
  # 🔴 Wait for it to answer rather than sleeping a guessed amount. A smoke that fails because the
  # server was not up yet is a red about this script.
  for _i in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$_port/" >/dev/null 2>&1 && break
    sleep 0.1
    [ "$_i" = 40 ] && { echo "✗ the static server never answered on $_port" >&2; exit 1; }
  done
  shopt -s nullglob
  for _s in "${SMOKE_GLOBS[@]}"; do
    _dir=$(dirname "$_s")
    echo "  · $_s"
    node "$_s" "http://127.0.0.1:$_port/$_dir/"
  done
  shopt -u nullglob
  kill "$_srv" 2>/dev/null || true
  trap - EXIT
else
  echo "  · browser smokes SKIPPED — set PLAYWRIGHT to a playwright index.js to run them"
  echo "    (they are the only gates that drive a real DOM; a green run without them is narrower)"
fi

echo "✅ ALL GREEN"
