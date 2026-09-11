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

// P3-2 (review round 1): `new Date('2024-07-13')` is UTC midnight, so formatting it in a
// west-of-UTC zone (e.g. America/Los_Angeles) reads back as the previous day — a pre-existing gap
// this suite's date literals would otherwise hit for any contributor whose machine (or CI runner)
// is not UTC. Pinned here, in this process only (each suite file is its own `node` invocation —
// see scripts/test.sh), rather than switching every literal to a datetime with a fixed offset.
process.env.TZ = 'UTC';

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
  // P3-1 (review round 1): the three assertions above compare fmtDate against Intl's OWN output,
  // which proves fmtDate called Intl correctly but not that this runner's ICU data actually HAS
  // Japanese — a small-ICU or system-ICU build missing `ja` silently answers in English and this
  // test would still be green. Pin one literal so a build lacking full ICU fails loudly here
  // instead of shipping English dates on a Japanese page.
  assert.equal(fmtDate(DATE, undefined, 'ja-JP'), '2024年7月13日', 'ICU probe: this runner must have Japanese locale data');
});

test('no format AND no locale known → the historic en-US literal, byte-identical', () => {
  assert.equal(fmtDate(DATE, undefined), 'July 13, 2024');
  assert.equal(fmtDate(DATE), 'July 13, 2024');
});

test('cjk is accepted as an alias of cjk-full', () => {
  assert.equal(fmtDate(DATE, 'cjk'), fmtDate(DATE, 'cjk-full'));
  assert.equal(fmtDate(DATE, 'cjk'), '2024 年 7 月 13 日');
  // the alias resolves before the CJK-locale gate below, so the two stay equal on every lang —
  // including a non-CJK one, where both fall back to that locale's own default together.
  assert.equal(fmtDate(DATE, 'cjk', 'en-US'), fmtDate(DATE, 'cjk-full', 'en-US'));
});

test('P2-1 (ruling 2026-09-11): an explicit CJK format applies to CJK page locales, not every locale', () => {
  // ja-JP + cjk-full → CJK, unchanged.
  assert.equal(fmtDate(DATE, 'cjk-full', 'ja-JP'), '2024 年 7 月 13 日');
  // en-US + cjk-full → this page's OWN locale default, never the CJK literal.
  assert.equal(fmtDate(DATE, 'cjk-full', 'en-US'), 'July 13, 2024');
  // zh-TW / ko-KR are CJK page locales too.
  assert.equal(fmtDate(DATE, 'cjk-badge', 'zh-TW'), '2024 年 7 月 13 日');
  assert.equal(fmtDate(DATE, 'cjk-md', 'ko-KR'), '7月13日');
  // ymd-slash is script-neutral and always applies, CJK page locale or not.
  assert.equal(fmtDate('2026-05-20', 'ymd-slash', 'zh-TW'), '2026/05/20');
  assert.equal(fmtDate('2026-05-20', 'ymd-slash', 'en-US'), '2026/05/20');
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

test('P3-5: every KNOWN_DATE_FORMATS value renders without warning', () => {
  // KNOWN_DATE_FORMATS (blog.mjs) is a hand-copied list next to the switch it names, kept only for
  // the warning text — nothing else checked the two agree. A value dropped from the switch but
  // left in the list would still warn here on every real one, which is the one drift that matters
  // (the list naming a format that no longer renders); a value added to the switch but left off
  // the list only makes the warning text stale, not the guarantee this test makes.
  for (const known of ['ymd-slash', 'cjk', 'cjk-full', 'cjk-badge', 'cjk-md']) {
    const calls = withCapturedWarnings(() => fmtDate(DATE, known, 'ja-JP'));
    assert.equal(calls.length, 0, `"${known}" is a KNOWN format and must not warn`);
  }
});

test('every existing explicit blog-date-format renders byte-identical to before', () => {
  // no lang given at all → no page locale to gate a CJK format on, so it still always applies,
  // exactly as before this format gained locale-awareness.
  assert.equal(fmtDate('2026-05-20', 'ymd-slash'), '2026/05/20');
  assert.equal(fmtDate('2025-11-11', 'cjk-full'), '2025 年 11 月 11 日');
  assert.equal(fmtDate('2025-11-11', 'cjk-badge'), '2025 年 11 月 11 日');
  assert.equal(fmtDate('2026-04-08', 'cjk-md'), '4月8日');
  // ymd-slash is script-neutral and never gated, on any lang.
  assert.equal(fmtDate('2026-05-20', 'ymd-slash', 'ja-JP'), '2026/05/20');
});

test('an unparseable date string is returned as-is, regardless of lang', () => {
  assert.equal(fmtDate('nonsense', undefined, 'ja-JP'), 'nonsense');
});

test('P1-1 (review round 1): an invalid BCP-47 lang tag falls back to en-US instead of crashing the build', () => {
  // `Intl.DateTimeFormat` throws RangeError on a tag it cannot parse (underscores instead of
  // hyphens, a bare Japanese word, a space) — this must never propagate out of fmtDate.
  for (const badTag of ['ja_JP', 'zh_TW', 'en US', '日本語', 'not-a-locale-!!']) {
    assert.doesNotThrow(() => fmtDate(DATE, undefined, badTag), `fmtDate must not throw for lang=${JSON.stringify(badTag)}`);
    assert.equal(fmtDate(DATE, undefined, badTag), 'July 13, 2024', `bad tag ${JSON.stringify(badTag)} falls back to the historic en-US output`);
  }
  // an empty tag is falsy, so it already takes the "no locale known" path — pinned here too since
  // it is the review's other named case.
  assert.doesNotThrow(() => fmtDate(DATE, undefined, ''));
  assert.equal(fmtDate(DATE, undefined, ''), 'July 13, 2024');
  // the guard also protects a CJK format's locale-default fallback (a non-CJK bad tag).
  assert.doesNotThrow(() => fmtDate(DATE, 'cjk-full', 'en_US'));
  assert.equal(fmtDate(DATE, 'cjk-full', 'en_US'), 'July 13, 2024');
});

console.log(`\n${passed} passed`);
