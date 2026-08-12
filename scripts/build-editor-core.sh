#!/bin/bash
# Emit dist/editor-core.js — the SHARED editor core (single source = packages/core/editor-core.js),
# wrapped as a platform-agnostic ES module for EXTERNAL web consumers.
# Core is UNMODIFIED (no fork). Consumer must load an Obsidian-shim first (HTMLElement.prototype DOM sugar
# + globalThis.setIcon + globalThis.Modal). tugtile/marktile keep using the inlined core (build-marktile.sh).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/editor-core.js"
mkdir -p "$ROOT/dist"
python3 - "$ROOT" "$OUT" <<'PY'
import sys, os, glob, json, re
root, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, root + "/packages/cssmd")
from inline import inline_cssmd
core = open(root + "/packages/core/editor-core.js", encoding="utf-8").read()
# Inline the shared cssmd primitive at the core's //#cssmd-inline marker so this standalone ES module
# is self-contained (external consumers don't fetch cssmd separately). markBoldItalic/markCode/mk land here.
core = inline_cssmd(core, root)
tr = {os.path.basename(f)[:-5]: json.load(open(f, encoding="utf-8")) for f in sorted(glob.glob(root + "/i18n/*.json"))}
header = (
 "// AUTO-GENERATED from packages/core/editor-core.js — single source of truth, DO NOT EDIT.\n"
 "// Platform-agnostic ES module of the tile-family editor core. Consumer MUST load an Obsidian-shim first\n"
 "// (HTMLElement.prototype.{createEl,createDiv,createSpan,empty,addClass} + globalThis.setIcon + globalThis.Modal).\n"
 "// tugtile/marktile use the inlined core (build-marktile.sh); this emit is for external web consumers.\n\n"
 "const TR = " + json.dumps(tr, ensure_ascii=False) + ";\n"
 "const LOCALE = (globalThis.__TILE_LOCALE) || (typeof navigator!=='undefined' && /^zh/i.test(navigator.language||'') ? 'zh-TW' : (typeof navigator!=='undefined' && /^ja/i.test(navigator.language||'') ? 'ja-JP' : 'en-US'));\n"
 "function t(key, ...args){ let s=(TR[LOCALE]&&TR[LOCALE][key]); if(s==null) s=TR['en-US']&&TR['en-US'][key]; if(s==null) return key; if(typeof s==='string'&&args.length) s=s.replace(/\\{(\\d+)\\}/g,(m,i)=>(args[+i]!=null?args[+i]:m)); return s; }\n\n"
)
# `t` is exported too: buildEditorCtl localises the mode NAME itself, but leaves the brand/aria strings to the
# host. Without t() every external host hand-copies four languages' worth of strings and they drift on the first
# wording change — the shared i18n is right here, so hand it over.
footer = "\n\nexport { mountEditor, highlightMarkdown, highlightLineParts, listContinuation, renumberLists, tabEdit, tocHeadings, moveSection, escHtml, EDITOR_TOOLS, TileEditModal, decorateTables, decorateImages, wireToc, wireImagePaste, equipEditor, EDITOR_MODES, buildEditorCtl, saveVaultImage, pickVaultImage, videoEmbed, promptVideoEmbed, formatTables, isTableLine, parseTable, t };\n"
open(out, "w", encoding="utf-8").write(header + core + footer)
print("emitted ->", out, ";", len(core), "bytes core ; i18n:", ",".join(tr))
PY
