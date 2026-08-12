#!/bin/bash
# tugtile build: Bundles Sortable (isolated wrapper), i18n/*.json, and plugin.src.js into a single main.js file
# i18n strings are defined in i18n/*.json (community edits JSON only) and injected into const TR = {}; in plugin.src.js during compilation
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"           # hosts/obsidian/tugtile
ROOT="$(cd "$DIR/../../.." && pwd)"               # repo root (shared assets: core, i18n, Sortable)
OUT="${1:-$DIR/main.js}"
python3 - "$DIR" "$ROOT" "$OUT" <<'PY'
import sys, os, glob, json
d,root,out=sys.argv[1],sys.argv[2],sys.argv[3]
sys.path.insert(0, root + "/packages/cssmd")
from inline import inline_cssmd
sort=open(root+"/Sortable.min.js",encoding="utf-8").read()
plug=open(d+"/plugin.src.js",encoding="utf-8").read()
# Inject the shared editor core (packages/core) at plugin.src.js's //#core-inline marker
core=open(root+"/packages/core/editor-core.js",encoding="utf-8").read()
# Whole-LINE replacement, same as build-marktile.sh: token replacement leaves anything else written
# on the marker line behind as bare JavaScript. plugin.src.js's marker line happens to be bare
# today, so this was never wrong here — it was one edit away from being wrong, which is the same
# thing a week later.
_lines = plug.split("\n")
_hits = [n for n, ln in enumerate(_lines) if "//#core-inline" in ln]
if len(_hits) != 1:
    raise SystemExit(f"build: expected exactly one //#core-inline line in plugin.src.js, found {len(_hits)}")
_lines[_hits[0]] = core
plug = "\n".join(_lines)
# Inline the shared cssmd primitive at the core's //#cssmd-inline marker (delegated inline marks).
plug=inline_cssmd(plug, root)
# Inject i18n: Reads i18n/*.json → builds the TR object → replaces the placeholder
tr={}
for f in sorted(glob.glob(root+"/i18n/*.json")):
    loc=os.path.basename(f)[:-5]
    tr[loc]=json.load(open(f,encoding="utf-8"))
if not tr:
    raise SystemExit("build: no i18n/*.json found")
if "const TR = {};" not in plug:
    raise SystemExit("build: i18n injection point `const TR = {};` not found in plugin.src.js")
plug=plug.replace("const TR = {};", "const TR = "+json.dumps(tr,ensure_ascii=False)+";", 1)
s="'use strict';\nconst Sortable = (function () {\n  var module = { exports: {} }; var exports = module.exports;\n"+sort+"\n  return module.exports;\n})();\n\n"+plug
open(out,"w",encoding="utf-8").write(s)
print("built ->",out,len(s),"bytes; i18n locales:",",".join(tr))
PY
