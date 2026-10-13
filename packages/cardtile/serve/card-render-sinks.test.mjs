// Every place card-render.mjs writes a URL-bearing attribute / url() must go through the registry.
// run: node --test card-render-sinks.test.mjs
//
// 🔴 tile#127 round 4 (review v3 #3): the old completeness test scanned ONE rendered fixture, so a
// new output point the fixture did not use was invisible. This reads the renderer's SOURCE: every
// line that writes `href=` / `src=` / `url(` / `poster=` / `data-url=` must, on that line, call
// `attrUrl(` / `cssAttrUrl(` / `esc(cssColor(` — or be listed in FIXED below as an output that is a
// fixed string / not author-selected. Identify entries by a SNIPPET of the line, never a line number.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// `url(` not preceded by a letter/dot (so `cssUrl(` and `new URL(` are not sinks); `x.src=` in the
// inline click-to-load / onerror scripts is JS assignment on fixed hosts or local paths, not markup.
const SINK = /(?<![\w.])(?:href|src|poster|data-url)=|(?<![\w.]|new )url\(/i;
const GUARDED = /\battrUrl\(|\bcssAttrUrl\(|\besc\(cssColor\(/;

// Output points that are NOT author-selected fetches. [snippet of the line, why]
export const FIXED = [
  ['href="${prev}"', 'in-page #anchor of the slider'],
  ['href="${next}"', 'in-page #anchor of the slider'],
  ['href="#${uid}-${i}"', 'in-page #anchor of a slider dot'],
  ['href="#" class="dc-drawer-scrim"', 'in-page anchor, fixed'],
  ['href="#" class="dc-drawer-close"', 'in-page anchor, fixed'],
  ['href="https://feelreef.com/signup${ref}"', 'fixed host, handle-derived query only'],
  ['<script src="${esc(ctx.qrScriptSrc)}"', 'caller-supplied script path, fixed by card-worker to a local path'],
  ['<script src="${esc(ctx.drawerScriptSrc)}"', 'caller-supplied script path, fixed by card-worker to a local path'],
  ['src="${esc(src)}" alt="" width="22" height="22"', 'IMG_ICON: author image registered at its call site (attrUrl) or a local iconPath'],
  ['href="#${id}" data-drawer', 'in-page drawer anchor'],
  ['<img src="${esc(src)}" alt="" loading="lazy"', 'slider / bubbles frames: `imgs` came through attrUrl at its definition (asserted below)'],
  ['url("${img}")', 'BACKDROP_CSS: its argument comes through cssAttrUrl at the call site (asserted below)'],
  ['<link rel="${esc(l.rel)}"', 'icon <link>s: local icon routes, or the avatar already registered as the profile image'],
  ['<link rel="canonical" href="${esc(share.canonical)}"', "the card's own address"],
  ['PICTURE_GLYPH = "url(', 'fixed data: URI'],
];
const isFixed = (line) => FIXED.some(([snip]) => line.includes(snip));

export function unguardedSinks(src) {
  const out = [];
  for (const line of stripComments(src).split('\n')) {
    if (!SINK.test(line)) continue;
    if (GUARDED.test(line) || isFixed(line)) continue;
    out.push(line.trim().slice(0, 160));
  }
  return out;
}

const SRC = readFileSync(new URL('../card-render.mjs', import.meta.url), 'utf8');

test('sinks: every href= / src= / url( / poster= / data-url= in card-render.mjs is guarded or listed as fixed', () => {
  assert.deepEqual(unguardedSinks(SRC), []);
});

test('sinks: the scan has something to scan, and every FIXED entry still exists (a stale entry is a hole)', () => {
  const body = stripComments(SRC);
  const hits = body.split('\n').filter((l) => SINK.test(l));
  assert.ok(hits.length >= 15, `saw ${hits.length} sink lines`);
  assert.ok(hits.filter((l) => GUARDED.test(l)).length >= 8);
  for (const [snip] of FIXED) assert.ok(body.includes(snip), `FIXED entry no longer in the renderer: ${snip}`);
});

test('sinks: the two indirect cases are guarded where the value is made', () => {
  const body = stripComments(SRC).split('\n');
  const defs = body.filter((l) => /const imgs = /.test(l));
  assert.equal(defs.length, 2, 'slider and bubbles each define imgs');
  for (const l of defs) assert.match(l, /attrUrl\(ctx,/, l);
  const calls = body.filter((l) => /BACKDROP_CSS\(/.test(l) && !/const BACKDROP_CSS/.test(l));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /BACKDROP_CSS\(cssAttrUrl\(ctx,/);
});

test('sinks: the guard is live — a bare src="${x}" line is reported, in any case', () => {
  const planted = SRC + '\nconst leak = (x) => `<img src="${x}">`;\nconst leak2 = (x) => `<IMG SRC="${x}">`.toLowerCase();\n';
  const found = unguardedSinks(planted).filter((l) => !unguardedSinks(SRC).includes(l));
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.ok(found[0].includes('<img src="${x}">') && found[1].includes('<IMG SRC="${x}">'));
});
