#!/bin/bash
# marktile build: pulls the shared editor core from ../packages/core/editor-core.js (single source)
# inlines it into marktile.src.js at //#core-inline, injects i18n, inlines Sortable, and copies the shared styles.
# Single source of truth stays ../plugin.src.js — marktile is derived, never a fork.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"           # packages/marktile
ROOT="$(cd "$DIR/../.." && pwd)"              # repo root (shared: packages/core, i18n, Sortable, styles.css)
OUT="${1:-$DIR/main.js}"
python3 - "$DIR" "$ROOT" "$OUT" <<'PY'
import sys, os, glob, json, re
d, root, out = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, root + "/packages/cssmd")
from inline import inline_cssmd

# 1. Extract the shared core blocks from tugtile's plugin source
core = open(root + "/packages/core/editor-core.js", encoding="utf-8").read()

# 2. Inline the core into marktile.src.js
src = open(d + "/marktile.src.js", encoding="utf-8").read()
if "//#core-inline" not in src:
    raise SystemExit("build: //#core-inline marker not found in marktile.src.js")
src = src.replace("//#core-inline   (build replaces this line with the shared core blocks from ../plugin.src.js)", core, 1)
src = src.replace("//#core-inline", core, 1)  # fallback if the comment text changed

# 2b. Inline the shared cssmd primitive at the core's //#cssmd-inline marker (delegated inline marks).
src = inline_cssmd(src, root)

# 3. Inject i18n (the same family JSON tugtile uses)
tr = {}
for f in sorted(glob.glob(root + "/i18n/*.json")):
    tr[os.path.basename(f)[:-5]] = json.load(open(f, encoding="utf-8"))
if "const TR = {};" not in src:
    raise SystemExit("build: i18n injection point `const TR = {};` not found in marktile.src.js")
src = src.replace("const TR = {};", "const TR = " + json.dumps(tr, ensure_ascii=False) + ";", 1)

# 3b. Inline SortableJS in the SAME isolated wrapper build.sh uses, so marktile has a global `Sortable`
# (the TOC drag-reorder needs it; the shared editor core itself doesn't, which is why it was missing before).
sort = open(root + "/Sortable.min.js", encoding="utf-8").read()
sortwrap = "const Sortable = (function () {\n  var module = { exports: {} }; var exports = module.exports;\n" + sort + "\n  return module.exports;\n})();\n\n"
open(out, "w", encoding="utf-8").write("'use strict';\n" + sortwrap + src)

# 4. Copy the shared styles (editor CSS lives there; board rules are harmless no-ops with no board present)
open(d + "/styles.css", "w", encoding="utf-8").write(open(root + "/styles.css", encoding="utf-8").read())
print("built ->", out, len(src), "bytes; core:", len(core), "bytes; i18n:", ",".join(tr))
PY
