# Shared build helper: splice the cssmd primitive into already-core-inlined plugin source.
# The editor core (packages/core/editor-core.js) carries a `//#cssmd-inline` marker; after a build
# inlines the core, this replaces that marker with cssmd's body so the core's delegated inline marks
# (markBoldItalic / markCode / mk) resolve in the single-file plugin. cssmd's ESM `export {…}` footer
# and its duplicate `escHtml` def are stripped (the core already defines escHtml — keep exactly one).
# Used by build.sh / build-marktile.sh / build-tile-core.sh so "how cssmd is inlined" lives in ONE place.
import re

def inline_cssmd(src, root):
    if "//#cssmd-inline" not in src:
        raise SystemExit("build: //#cssmd-inline marker not found (expected in the inlined editor core)")
    cm = open(root + "/packages/cssmd/cssmd.js", encoding="utf-8").read()
    cm = re.sub(r"export\s*\{[\s\S]*?\};?\s*$", "", cm)                                  # drop ESM export footer
    cm = re.sub(r"^function escHtml\(s\)\s*\{[\s\S]*?\n\}\n", "", cm, count=1, flags=re.M)  # drop dup escHtml
    # Replace the WHOLE marker line (marker token + its trailing explanatory comment) so no dangling
    # prose survives as live code. Fall back to the bare token if the comment text ever changes.
    src2 = re.sub(r"^//#cssmd-inline.*$", lambda _m: cm, src, count=1, flags=re.M)
    if src2 == src:
        src2 = src.replace("//#cssmd-inline", cm, 1)
    return src2
