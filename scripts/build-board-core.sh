#!/bin/bash
# Emit tugtile-w/board-core.js — the BOARD model, sliced out of packages/tugtile/plugin.src.js.
#
# 🩸 WHY THIS FILE EXISTS. board-core.js was already generated, already carried a
# "AUTO-GENERATED … DO NOT EDIT" banner, and had NO GENERATOR IN THIS REPO. The slicing logic lived
# in the private lab's scripts/fetch-tile.sh, which fetched plugin.src.js from GitHub and cut the
# CORE section out of it. When tugtile-w graduated, the artifact came along and the generator did
# not — so tugtile-w/build.sh still says "board-core.js is vendored via scripts/fetch-tile.sh",
# naming a script that does not exist here and never will.
#
# It was still byte-identical to a fresh slice on 2026-08-11 (17,850 = 17,850), which is the only
# reason this is a cheap fix rather than an archaeology project. A generated file whose generator
# lives in another repo is not "vendored" — it is a copy with nobody minding it.
#
# The slice is deliberately IDENTICAL to the lab's, so the two repos cannot disagree about what the
# board model is. Once this is committed, the lab's fetch can take this file whole instead of
# re-cutting it, and there stops being a second implementation of the cut.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/tugtile/plugin.src.js"
OUT="$ROOT/tugtile-w/board-core.js"

node -e '
const fs = require("fs");
const [src, out] = process.argv.slice(1);
const text = fs.readFileSync(src, "utf8");

// The two markers the slice is defined by. Assert both, and assert the order: a marker that moved
// silently would otherwise yield a shorter — still plausible-looking — model file.
const i = text.indexOf("function tileRenderText");
const j = text.indexOf("/* ===================== /CORE");
if (i < 0) throw new Error("plugin.src.js: `function tileRenderText` not found — the CORE section moved or was renamed");
if (j < 0) throw new Error("plugin.src.js: the `/CORE` end marker not found — the CORE section moved or was renamed");
if (j <= i) throw new Error("plugin.src.js: the /CORE end marker is BEFORE the start — the slice would be empty");

const core = text.slice(i, j);
const EXPORTS = "parseFile, serializeFile, parseWip, tileRenderText, foldStateFrom, nextFold, "
  + "foldTargets, foldIcon, FOLD_ICONS, extractMeta, extractTags, tilePlainText, parseDateStr, formatDateTokens";
// Every name the export list promises must actually be defined in the slice. Without this, moving a
// function OUT of the CORE section produces a module that imports fine and throws at use.
for (const name of EXPORTS.split(",").map((s) => s.trim())) {
  if (!new RegExp(`(function|const|let|class)\\s+${name}\\b`).test(core)) {
    throw new Error(`the CORE slice does not define \`${name}\`, but the export list promises it`);
  }
}

fs.writeFileSync(out,
  "// AUTO-GENERATED from CVERInc/tile packages/tugtile/plugin.src.js CORE — board model, platform-free. DO NOT EDIT.\n"
  + "const t=(k)=>k;\n" + core + "\nexport { " + EXPORTS + " };\n");
console.log(`emitted ${out.replace(process.env.HOME, "~")} (${core.length} chars of CORE)`);
' "$SRC" "$OUT"
