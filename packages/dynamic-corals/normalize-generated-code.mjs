// The one normalisation build.mjs applies when comparing a freshly generated coral artifact
// against one already on disk: strip build.mjs-OWNED PROVENANCE — the first line's `+<commit>`
// and the version-registration trailer (see build.mjs's `reg` and its long comment above the
// immutability check) — so the comparison is about the coral's CODE, not about which commit or
// which trailer spelling produced it.
//
// Exported as its own module, not inlined in build.mjs and not duplicated in a test: build.mjs
// throws at import time when it finds no esbuild (see its ESBUILD resolution) and runs its whole
// build loop as a module-level side effect, so anything that only wants this pure helper — a
// freshness gate comparing a rebuild to a committed artifact — must not import build.mjs itself to
// get it.
//
// The trailer pattern matches BOTH the pre-2026-08-29 unguarded spelling and the guarded one
// build.mjs writes today (see build.mjs's own comment on why both are correct), and is pinned to
// THIS coral's own name and version — a stored trailer naming some OTHER version is a real defect
// and must still fail to strip, so it falls through as a difference rather than being silently
// swallowed.
export function normalizeGeneratedCode(text, name, version) {
  const v = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trailer = new RegExp(
    "\\n(?:if \\(typeof window !== 'undefined'\\) )?"
    + '\\(window\\.__coralVersions=window\\.__coralVersions\\|\\|\\{\\}\\)'
    + `\\['${name}'\\]='${v}';\\n$`);
  return text.split('\n').slice(1).join('\n').replace(trailer, '');
}
