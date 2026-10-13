// Every place card-render.mjs writes a URL-bearing attribute / url() must go through the registry.
// run: node --test card-render-sinks.test.mjs
// 🔴 round 5: this file now scans CONSTRUCTS (see CONSTRUCT below), not lines — the paragraph below is the round-4 design it replaces.
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

// 🔴 tile#127 round 5 (review v4 P2): the guard scans CONSTRUCTS, not lines. A whole-line match let a second
// author-controlled sink ride on a line that already held a guarded one (a bare `src="${x}"` appended to the
// slider navigation line passed because `href="${prev}"` was listed). So one regex finds each URL-bearing
// construct on its own, the `${…}` it opens is read to its closing brace, and THAT content is what is judged.
//   attribute  : (src|href|srcset|data-src|xlink:href|action|formaction|poster|data-url) = ["']? <literal prefix> ${
//   css        : url( ["']? ${        @import ["']? ${        background[-image]: … ${
//   never allowed to appear at all : image-set(
// 🔴 round 6 (review v5 #2): the attribute branch no longer stops at the first whitespace. ATTR_START finds
// `src=` / `href=` / …; constructs() then reads the WHOLE value (quoted: to the closing quote, interpolations skipped over
// as units; bare: to whitespace or `>`), and every `${` inside it is judged — a leading space or newline after the
// quote (`src=" ${x}"`, which the browser trims and fetches) no longer hides it.
// NOT SCANNED, on purpose: the inline client script (VIDEO_JS — the click-to-load YouTube iframe). It builds a fixed
// youtube URL from an encoded id/channel/handle after the visitor clicks; it is renderer code, not an author-chosen destination.
const ATTR_START = /(?<![\w.-])(?:src|href|srcset|data-src|xlink:href|action|formaction|poster|data-url)\s*=\s*/gi;
const CONSTRUCT = new RegExp([
  String.raw`(?<![\w.]|new )url\(\s*["']?\$\{`,
  String.raw`@import\s+["']?\$\{`,
  String.raw`background(?:-image)?\s*:[^;` + '`' + String.raw`]*?\$\{`,
].join('|'), 'gi');
const IMAGE_SET = /image-set\(/i;
// what the `${…}` content must start with: the registry (optionally HTML-escaped on the way out) or a validated CSS value
const GUARDED = /^(?:esc\(\s*)?(?:attrUrl|cssAttrUrl)\(|^esc\(\s*(?:cssColor|cssPos)\(/;

// Output constructs that are NOT author-selected fetches: [construct text up to its closing `}`, how many times, why].
// "Construct + value", never a whole line; the COUNT makes a second identical construct a new, unlisted sink.
export const FIXED = [
  ['href="${prev}', 1, 'in-page #anchor of the slider'],
  ['href="${next}', 1, 'in-page #anchor of the slider'],
  ['href="#${uid}', 1, 'in-page #anchor of a slider dot'],
  ['href="#${uid}-${i}', 1, 'same slider dot: the second interpolation of one in-page #fragment value (round 6 judges every ${} in a value)'],
  ['href="https://feelreef.com/signup${ref}', 1, 'fixed host, handle-derived query only'],
  ['src="${esc(ctx.qrScriptSrc)}', 1, 'caller-supplied script path, fixed by card-worker to a local path'],
  ['src="${esc(ctx.drawerScriptSrc)}', 1, 'caller-supplied script path, fixed by card-worker to a local path'],
  ['src="${esc(src)}', 3, 'IMG_ICON (author image registered at its call site) and the slider / bubbles frames (`imgs` came through attrUrl at its definition, asserted below)'],
  ['data-url="${esc(qrUrl)}', 1, "the QR code encodes the card's own address"],
  ['href="#${id}', 1, 'in-page drawer anchor'],
  ['background-image:url("${img}', 1, 'the same BACKDROP_CSS url(), seen once more as a background declaration'],
  ['background:linear-gradient(180deg,color-mix(in srgb,var(--cp-ground,#0a1628) ${dim}', 1, 'BACKDROP_CSS: `dim` is a clamped number (colour.mjs), no URL in this declaration'],
  ['href="${esc(l.href)}', 1, 'icon <link>s: local icon routes, or the avatar already registered as the profile image'],
  ['href="${esc(share.canonical)}', 1, "the card's own address"],
];
const norm = (t) => t.replace(/\s+/g, ' ');

// the `${…}` that opens at `open` (index of `$`): its content, and the index just past its closing brace
function readInterpolation(src, open) {
  let depth = 0;
  for (let i = open + 1; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return { content: src.slice(open + 2, i).trim(), end: i + 1 }; }
  }
  return { content: src.slice(open + 2).trim(), end: src.length };
}

/** every URL-bearing construct in `src`: { text, content, guarded } */
export function constructs(src) {
  const body = stripComments(src);
  const out = [];
  for (const m of body.matchAll(CONSTRUCT)) {
    const { content, end } = readInterpolation(body, m.index + m[0].length - 2);
    out.push({ text: norm(body.slice(m.index, end)), content, guarded: GUARDED.test(content) });
  }
  for (const m of body.matchAll(ATTR_START)) {
    let i = m.index + m[0].length;
    const q = body[i] === '"' || body[i] === "'" ? body[i] : '';
    if (q) i += 1;
    // walk the value: interpolations are skipped as units (their content may hold quotes), the value ends at its quote
    for (; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === '$' && body[i + 1] === '{') {
        const { content, end } = readInterpolation(body, i);
        out.push({ text: norm(body.slice(m.index, end)), content, guarded: GUARDED.test(content) });
        i = end - 1;
      } else if (ch === '`' || (q ? ch === q : /[\s>]/.test(ch))) break;
    }
  }
  if (IMAGE_SET.test(body)) out.push({ text: 'image-set(', content: '', guarded: false });
  return out;
}

export function unguardedSinks(src) {
  const left = new Map(FIXED.map(([t, n]) => [t, n]));
  const out = [];
  for (const c of constructs(src)) {
    if (c.guarded) continue;
    if (left.get(c.text) > 0) { left.set(c.text, left.get(c.text) - 1); continue; }
    out.push(c.text.slice(0, 160));
  }
  return out;
}

const SRC = readFileSync(new URL('../card-render.mjs', import.meta.url), 'utf8');

test('sinks: every URL-bearing construct in card-render.mjs is guarded or listed as fixed', () => {
  assert.deepEqual(unguardedSinks(SRC), []);
});

test('sinks: the scan has something to scan, and every FIXED entry still exists exactly as often as listed (a stale entry is a hole)', () => {
  const all = constructs(SRC);
  assert.ok(all.length >= 20, `saw ${all.length} constructs`);
  assert.ok(all.filter((c) => c.guarded).length >= 8);
  for (const [text, n] of FIXED) assert.equal(all.filter((c) => !c.guarded && c.text === text).length, n, `FIXED entry out of step with the renderer: ${text}`);
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

test('sinks: the guard is live — a bare src="${x}" on a NEW line is reported, in any case and with spaces around `=`', () => {
  const planted = SRC + '\nconst leak = (x) => `<img src="${x}">`;\nconst leak2 = (x) => `<IMG SRC = "${x}">`;\n';
  const found = unguardedSinks(planted).length - unguardedSinks(SRC).length;
  assert.equal(found, 2, JSON.stringify(unguardedSinks(planted)));
});

test('sinks: the guard is live — a second sink APPENDED to an existing fixed line is reported (the old whole-line match excused it)', () => {
  const marker = 'href="${next}"';
  const at = SRC.indexOf(marker);
  assert.ok(at > 0, 'the slider navigation line is still there');
  const lineEnd = SRC.indexOf('\n', at);
  const planted = SRC.slice(0, lineEnd) + '<img src="${x}">' + SRC.slice(lineEnd);
  assert.deepEqual(unguardedSinks(planted), ['src="${x}'], 'exactly the appended construct');
  assert.deepEqual(unguardedSinks(SRC), []);
});

test('sinks: the guard sees the other URL-bearing spellings — srcset, action, formaction, data-src, xlink:href, @import, image-set(, background shorthand', () => {
  for (const frag of ['<img srcset="${x} 2x">', '<form action="${x}">', '<button formaction="${x}">', '<i data-src="${x}">', '<use xlink:href="${x}">', '@import "${x}";', 'background:#fff url(\'${x}\')', 'background-image:${x}', 'image-set(a 1x)']) {
    const planted = SRC + '\nconst leak = `' + frag + '`;\n';
    assert.ok(unguardedSinks(planted).length > unguardedSinks(SRC).length, `not reported: ${frag}`);
  }
  // and a guarded one in the same spellings is accepted
  const ok = SRC + '\nconst fine = (ctx, x) => `<img srcset="${esc(attrUrl(ctx, x))}"><i style="background:url(\'${esc(cssAttrUrl(ctx, x))}\')">`;\n';
  assert.equal(unguardedSinks(ok).length, unguardedSinks(SRC).length);
});

test('sinks: r6#2 whitespace or a newline between the quote and `${` does not hide a sink (the browser trims it and fetches)', () => {
  for (const frag of ['<img src=" ${x}">', '<img src="\n${x}">', '<img src=\'\t ${x}\'>', '<a href=" https://a.example/${x}">']) {
    const planted = SRC + '\nconst leak = (x) => `' + frag + '`;\n';
    assert.deepEqual(unguardedSinks(planted).slice(unguardedSinks(SRC).length).length, 1, `not reported exactly once: ${frag}`);
  }
  // several interpolations in one value are each judged
  const two = SRC + '\nconst two = (ctx, x, y) => `<a href="${esc(attrUrl(ctx, x))}${y}">`;\n';
  assert.equal(unguardedSinks(two).length, 1);
  // and a guarded value behind leading whitespace is accepted
  const ok = SRC + '\nconst ok = (ctx, x) => `<img src=" ${esc(attrUrl(ctx, x))}">`;\n';
  assert.deepEqual(unguardedSinks(ok), []);
});

test('sinks: two constructs on one line are judged one by one', () => {
  const planted = SRC + '\nconst two = (ctx, x) => `<a href="${esc(attrUrl(ctx, x))}"><img src="${x}">`;\n';
  assert.deepEqual(unguardedSinks(planted), ['src="${x}']);
});
