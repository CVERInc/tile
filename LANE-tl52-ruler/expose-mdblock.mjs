// tile-lab#52 ruler — an ESM load hook that makes card-render.mjs's private `mdBlock` reachable.
//
// card-render.mjs exports `mdInline` (as `__mdInline`) but not `mdBlock`. Reaching mdBlock through
// the public API (renderGrid → a `text` cell) would measure `mdBlock((cell.body||'').trim())`, i.e.
// add a trim the function itself does not do — a confound on exactly the whitespace rows this
// ruler exists for. So instead, in memory only, this hook appends ONE line to that one module's
// source: `export { mdBlock as __mdBlockProbe };`. No file on disk changes; the body below is
// append-only by construction (src + PROBE_LINE). measure.mjs cross-checks the probe against the
// public path (renderGrid text cell) on inputs that have no outer whitespace.
export const PROBE_LINE = '\nexport { mdBlock as __mdBlockProbe };\n';

export async function load(url, context, nextLoad) {
  const r = await nextLoad(url, context);
  if (url.endsWith('/packages/cardtile/card-render.mjs')) {
    const src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8');
    return { ...r, source: src + PROBE_LINE, shortCircuit: true };
  }
  return r;
}
