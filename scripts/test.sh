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
           # 🩸 the web host's own copy, which build.sh started writing on 2026-09-06 and nothing
           # tracked. An UNTRACKED file is a third silence this gate has: it exists, so the check
           # above passes, and `git diff` has nothing to say about it either. Committed now, which
           # is what makes this line ask a question.
           hosts/web/tugtile/board-core.js
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
# 🩸 nullglob AROUND THE ASSIGNMENTS, not only around the loops that read them. A bash array literal
# expands its globs AT ASSIGNMENT, so a directory listed here with no test file in it yet stored the
# PATTERN as a literal word — and the loop below then ran `node 'packages/…/*.test.mjs'` and died
# with MODULE_NOT_FOUND. The two `shopt -s nullglob` further down were guarding the wrong moment.
# Measured 2026-09-07, the first time a listed directory (drawer/) had no tests in it.
shopt -s nullglob
SUITE_GLOBS=(packages/sitetile/*.test.mjs packages/sitetile/*.test.js packages/pwa/*.test.mjs
             packages/flowtile/*.test.mjs test/*.test.mjs
             # dynamic-corals arrived 2026-09-07 — the corals, their build and the registry worker.
             # 🔴 One glob per DIRECTORY, which is the same hand-kept list this block complains about
             # one level up; the orphan guard below is what stops it going stale, and it is the
             # reason a new coral directory fails loudly here instead of never being run.
             packages/dynamic-corals/*.test.mjs
             packages/dynamic-corals/drawer/*.test.mjs packages/dynamic-corals/events/*.test.mjs
             packages/dynamic-corals/inbox-bubble/*.test.mjs packages/dynamic-corals/qr/*.test.mjs
             packages/dynamic-corals/registry/*.test.mjs packages/dynamic-corals/shared/*.test.mjs
             packages/dynamic-corals/sponsor/*.test.mjs packages/dynamic-corals/square-shop/*.test.mjs
             # cardtile arrived 2026-09-07 with dynamic-corals. Note `*.test.js` as well as .mjs:
             # card-core.test.js is the only one of its kind here, and a glob that quietly did not
             # match it would have dropped the parse/serialize suite the whole package rests on.
             packages/cardtile/*.test.mjs packages/cardtile/*.test.js
             packages/cardtile/cards/*.test.mjs packages/cardtile/serve/*.test.mjs
             packages/cardtile/w/*.test.mjs packages/cardtile/w2/*.test.mjs
             # build arrived 2026-09-06 — the page-generation half of a site build. Its end-to-end
             # test needs packages/sitetile/astro/node_modules and names itself SKIPPED without
             # them, exactly like the astro smoke further down.
             packages/build/*.test.mjs
             # real-render arrived with the per-site dynamic-coral CSS declaration. The matrix
             # itself needs a browser and is listed in MATRIX_GLOBS below; what is covered HERE is
             # its pure half — the mode-aware expectations, driven with synthetic facts, so the
             # rules are checked on every run and not only on the one run somebody does with
             # Playwright installed.
             packages/sitetile/real-render/*.test.mjs)
# 🩸 …and within a NAMING CONVENTION. The guard below asked the tree for `*.test.*` and nothing else,
# so hosts/web/modaltile/ could hold TWO browser harnesses that nothing has ever run and the check
# designed to catch exactly that stayed green — they were invisible to it because of what they are
# called. (Both pass, as of 2026-08-12. Unrun is not the same as broken, and you cannot tell which
# one you have without running them: seven harnesses in the sibling repo were found dead the same
# day, and every one of them had also been "fine" right up until somebody looked.)
SMOKE_GLOBS=(hosts/web/*/*.smoke.mjs hosts/web/*/smoke.mjs)
# 🔴 A SECOND browser list, because the two are invoked differently and merging them would break
# one of them silently. Every SMOKE_GLOBS entry is called `node <smoke> <base URL>` against the
# static python3 server the block further down starts. The real-render matrix takes no base URL —
# it builds real sites, emits their Worker and serves its own origin per arm — so putting it in
# that list would run it with an argument it ignores, from a directory it does not use, and call
# the result covered. It gets its own gated invocation instead, and it is named here so the orphan
# guard below still counts it.
MATRIX_GLOBS=(packages/sitetile/real-render/*.smoke.mjs)
shopt -u nullglob

echo "→ every test file in the tree is actually run"
shopt -s nullglob
covered=$(printf '%s\n' test/*.cjs "${SUITE_GLOBS[@]}" "${SMOKE_GLOBS[@]}" "${MATRIX_GLOBS[@]}" | sort -u)
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

# 🩸 packages/build's end-to-end test is the only one in this repo that proves "an IR directory in,
# a directory of static HTML out" — the sentence that package exists for. It needs the renderer's
# dependencies and names ITSELF skipped without them, which is the right shape; what was missing is
# anywhere that made the skip an actionable fact. It ran inside the loop below among 26 other
# greens, CI installed nothing, and so every green this gate has ever produced excluded it. The
# workflow now installs them; this says out loud which of the two runs you are looking at.
if [ -d packages/sitetile/astro/node_modules ]; then
  echo "→ packages/build end-to-end: the renderer's deps are here, so it builds real pages"
else
  echo "  · packages/build END-TO-END SKIPPED — no packages/sitetile/astro/node_modules"
  echo "    (this run did NOT prove IR in → static HTML out; run npm install there, or see"
  echo "     .github/workflows/ci.yml, which installs them)"
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

# The real-render matrix is the only gate that answers "where does this site's CSS actually land in
# the cascade" by building real sites, emitting their generated Worker and reading getComputedStyle
# in a browser. It needs BOTH Playwright and the renderer's dependencies, and it writes its work
# tree OUTSIDE this checkout — it rsyncs the source into that tree, so an --out inside would copy
# itself. Override the location with SITETILE_MATRIX_OUT to keep the facts/screenshots afterwards;
# narrow the run with SITETILE_MATRIX_ARMS (e.g. `custom,custom-layered`) when the full set is more
# than the machine has.
#
# 🩸 It is slow and memory-hungry by construction: one full renderer build per arm. That is why it
# is behind the same opt-in as the other browser gates rather than in the default run, and why the
# skip below names it instead of passing quietly.
if [ -n "${PLAYWRIGHT:-}" ] && [ -f "${PLAYWRIGHT}" ] && [ -d packages/sitetile/astro/node_modules ]; then
  echo "→ real-render matrix"
  _matrix_out="${SITETILE_MATRIX_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/sitetile-real-render.XXXXXX")}"
  shopt -s nullglob
  for _m in "${MATRIX_GLOBS[@]}"; do
    echo "  · $_m → $_matrix_out"
    _matrix_args=(--tile "$PWD" --out "$_matrix_out")
    if [ -n "${SITETILE_MATRIX_ARMS:-}" ]; then _matrix_args+=(--arms "$SITETILE_MATRIX_ARMS"); fi
    node "$_m" "${_matrix_args[@]}"
  done
  shopt -u nullglob
  # Green and nobody named a location: the work tree is an engine copy plus a built site per arm,
  # so leaving it in /tmp on every run is hundreds of MB nobody asked for. A FAILING run never
  # reaches this line — its facts/, shots/ and summary.md are exactly what the next person needs.
  if [ -z "${SITETILE_MATRIX_OUT:-}" ]; then rm -rf "$_matrix_out"; fi
else
  echo "  · real-render matrix SKIPPED — packages/sitetile/real-render/matrix.smoke.mjs needs BOTH"
  if [ -z "${PLAYWRIGHT:-}" ] || [ ! -f "${PLAYWRIGHT:-}" ]; then
    echo "    PLAYWRIGHT pointing at a playwright index.js — not set (or not a file)"
  fi
  if [ ! -d packages/sitetile/astro/node_modules ]; then
    echo "    packages/sitetile/astro/node_modules — absent (run npm install there)"
  fi
  echo "    (without it, nothing in this run proves where a site's coral CSS lands in the cascade)"
fi

echo "✅ ALL GREEN"
