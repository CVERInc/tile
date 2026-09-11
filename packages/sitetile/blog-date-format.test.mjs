// fmtDate must speak the PAGE's own language, not the site's default one.
//   run: node packages/sitetile/blog-date-format.test.mjs   (wired into scripts/test.sh)
//
// THE GAP (github.com/CVERInc/tile#34, a live Lingo + Blog site): fmtDate(s, format) took no
// locale at all, so its "no format / unrecognised format" branch was a hardcoded
// `d.toLocaleDateString('en-US', …)` — every post on every locale of a multilingual site read the
// same English date, and a site whose `blog-date-format: cjk` looked right and did nothing,
// because `cjk` was never one of the recognised values and the miss was silent.
//
// fmtDate now takes the PAGE's own locale (the Lingo variant actually being rendered) as its third
// argument and formats the default branch with it via Intl; `cjk` is accepted as an alias of
// `cjk-full`; an unrecognised value still renders (the locale default, never a blank date) but
// warns once per build, naming the values it does recognise.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// same seam blog-unlisted.test.mjs and blog-locale-archives.test.mjs already teach the resolver.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const { fmtDate } = await import('./astro/src/lib/blog.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

function withCapturedWarnings(fn) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(' '));
  try { fn(); } finally { console.warn = original; }
  return calls;
}

const DATE = '2024-07-13';
const INTL_OPTS = { year: 'numeric', month: 'long', day: 'numeric' };
// Expected strings come from Intl itself, computed here with the SAME api fmtDate's default
// branch uses — this pins BEHAVIOUR, not a hand-copied table of locale data that could drift
// from what the ICU build under test actually produces.
const intlExpected = (bcp47) => new Intl.DateTimeFormat(bcp47, INTL_OPTS).format(new Date(DATE));

test('no format set → the PAGE locale (the Lingo variant being rendered), not the site default', () => {
  assert.equal(fmtDate(DATE, undefined, 'ja-JP'), intlExpected('ja'));
  assert.equal(fmtDate(DATE, undefined, 'zh-TW'), intlExpected('zh-Hant'));
  assert.equal(fmtDate(DATE, undefined, 'en-US'), intlExpected('en'));
});

test('no format AND no locale known → the historic en-US literal, byte-identical', () => {
  assert.equal(fmtDate(DATE, undefined), 'July 13, 2024');
  assert.equal(fmtDate(DATE), 'July 13, 2024');
});

test('cjk is accepted as an alias of cjk-full', () => {
  assert.equal(fmtDate(DATE, 'cjk'), fmtDate(DATE, 'cjk-full'));
  assert.equal(fmtDate(DATE, 'cjk'), '2024 年 7 月 13 日');
  // a named format is not a locale fallback — it wins regardless of lang.
  assert.equal(fmtDate(DATE, 'cjk', 'en-US'), fmtDate(DATE, 'cjk-full', 'en-US'));
});

test('an unrecognised blog-date-format renders the locale default, and warns once per build — naming the allowed values', () => {
  const calls = withCapturedWarnings(() => {
    fmtDate(DATE, 'cjk-legacy-typo', 'ja-JP'); // post 1 of a build sharing one bad site config
    fmtDate(DATE, 'cjk-legacy-typo', 'ja-JP'); // post 2
    fmtDate(DATE, 'cjk-legacy-typo', 'ja-JP'); // post 3
  });
  assert.equal(calls.length, 1, 'one warning for the whole build, not one per post');
  assert.match(calls[0], /cjk-legacy-typo/, 'names the value the site actually set');
  for (const known of ['ymd-slash', 'cjk', 'cjk-full', 'cjk-badge', 'cjk-md']) {
    assert.ok(calls[0].includes(known), `warning text must name the allowed value "${known}"`);
  }
  assert.equal(fmtDate(DATE, 'cjk-legacy-typo', 'ja-JP'), intlExpected('ja'),
    'the post itself still renders the locale default — an unrecognised config never blanks a date');
});

test('every existing explicit blog-date-format renders byte-identical to before', () => {
  assert.equal(fmtDate('2026-05-20', 'ymd-slash'), '2026/05/20');
  assert.equal(fmtDate('2025-11-11', 'cjk-full'), '2025 年 11 月 11 日');
  assert.equal(fmtDate('2025-11-11', 'cjk-badge'), '2025 年 11 月 11 日');
  assert.equal(fmtDate('2026-04-08', 'cjk-md'), '4月8日');
  // an explicit format never consults lang.
  assert.equal(fmtDate('2026-05-20', 'ymd-slash', 'ja-JP'), '2026/05/20');
});

test('an unparseable date string is returned as-is, regardless of lang', () => {
  assert.equal(fmtDate('nonsense', undefined, 'ja-JP'), 'nonsense');
});

console.log(`\n${passed} passed`);
